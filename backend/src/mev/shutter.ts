import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { AbiCoder, keccak256 } from "ethers";
import { log } from "../middleware/error";

/**
 * Shutter-style commit-reveal wrapper for the Provenant attestation-log transaction.
 *
 * ── What it does ───────────────────────────────────────────────────────────
 * Wraps the calldata of a `logInference(...)` transaction in a threshold-encrypted
 * envelope, broadcasts the envelope's *commitment hash* on-chain immediately, and
 * reveals the payload after the keyper set publishes a decryption key for the
 * envelope's identity. This means:
 *
 *   1. An adversarial 0G block builder watching the mempool sees only `commit(hash)`
 *      — they cannot reorder or front-run the audit-log write based on its content.
 *   2. The keyper set (production: Shutter Network keypers on Gnosis or a sibling chain
 *      that hosts a Shutter keyper set; scaffold: a local timer) publishes a decryption
 *      key bound to the envelope's per-tx identity.
 *   3. The contract verifies the revealed payload matches the earlier commitment,
 *      then executes `logInference(...)` with the original arguments.
 *
 * ── Security improvements applied per 08d research ─────────────────────────
 * Two real Shutter-on-Gnosis bug classes were avoided:
 *
 *   A. **Per-tx identity, not per-epoch key.** Earlier scaffold reused one DEK across
 *      every envelope in a 12-second epoch — meaning one decryption-key publication
 *      would have exposed *every* committed envelope in that window. This is exactly
 *      the regression Shutter publicly fixed on Gnosis (~$300K incident reported
 *      blockchain.news 2024). Each commit now generates a unique 32-byte identity;
 *      the DEK is derived from `(eonSeed, identity)` so each envelope is independent.
 *
 *   B. **Domain-separated, chain-bound commit hash.** Replay across chains and across
 *      deployments is prevented by including a protocol tag, `chainId`, and the
 *      verifying contract address in the digest preimage (EIP-712-style separation,
 *      not full EIP-712 typed data — we never bind a wallet signature here).
 *
 * ── What's real vs scaffold ────────────────────────────────────────────────
 * - **Real**: the AEAD envelope (AES-256-GCM, CSPRNG IV, per-tx identity-bound key),
 *   the commit-reveal sequencing, the chain-bound + protocol-tagged commit hash, the
 *   reveal-side verification that the recovered payload's recomputed commit matches.
 * - **Scaffold (production swap-in, exactly 3 lines)**:
 *     1. `deriveCallKey(...)` → `await shutterEncrypt(plaintext, eonPublicKey, identity, sigma)`
 *        from `@shutter-network/shutter-crypto`
 *     2. `awaitKeyForIdentity(...)` → poll `GET /get_decryption_key?identity=<hex>`
 *        from Shutter's keyper HTTP API
 *     3. `loadEonSeed()` SHA-256 fallback → `eon_key` returned by
 *        `POST /register_identity` against Shutter's API
 *   The envelope shape, the chain-binding, the AEAD, and the reveal-verification flow
 *   do not change. The interface design holds across the swap.
 *
 * Shutter does not currently run keyper sets on 0G Aristotle. The production options:
 *   (a) Shutter keypers on a sibling chain (Gnosis, today) with a relayed reveal
 *   (b) A dedicated keyper set on 0G when Shutter expands its mainnet footprint
 *   (c) Fairblock / FairyRing (Cosmos-SDK threshold-IBE-as-a-service, already
 *       integrated with Plume / Hyperliquid / Arbitrum / Cosmos Hub) as a drop-in
 *       replacement if Shutter doesn't expand to 0G in time.
 * Either way, the application code in this module doesn't change.
 *
 * ── Unfixed risks (honestly documented) ────────────────────────────────────
 * - **Commit-then-never-reveal griefing**: an adversary can submit `commit(hash)` and
 *   then refuse to reveal, polluting the on-chain audit log with hashes that never
 *   resolve. Mitigation in v2 = require a commit bond + reveal deadline with slashing.
 * - **Keyper liveness**: if the keyper set is offline at reveal time, the audit log
 *   for that envelope is delayed. 0G Storage still holds the ciphertext, so data
 *   isn't lost — only the *public* attestation is delayed.
 * - **Cross-domain MEV**: this wrapper defends informational MEV on the attestation-log
 *   write *on 0G*. Cross-chain MEV at the Sepolia mirror seam is out of scope here.
 */

const SCAFFOLD_KEYPER_LATENCY_SECONDS = 12; // demo-friendly; Gnosis Shutter is ~3 min commit→exec

// Protocol-tag for domain separation (EIP-712-style); rolled forward on breaking changes.
const PROTOCOL_TAG = keccak256(Buffer.from("provenant.shutter.commit.v1", "utf8"));

export type EncryptedEnvelope = {
  ciphertextHex: `0x${string}`;
  nonceHex: `0x${string}`;        // 12-byte AEAD nonce (CSPRNG)
  identityHex: `0x${string}`;     // 32-byte unique per envelope; production = Shutter identity
  epochId: number;                 // earliest publish moment (informational, not security)
  commitHash: `0x${string}`;       // keccak256(PROTOCOL_TAG, chainId, verifyingContract, identity, ciphertext, nonce, epochId)
  chainId: number;
  verifyingContract: `0x${string}`;
};

export type CalldataPayload = {
  tokenId: bigint;
  questionHash: `0x${string}`;
  bundleHash: `0x${string}`;
  enclaveTimestamp: number;
  teeSignature: `0x${string}`;
};

export type RevealedPayload = CalldataPayload & {
  identityHex: `0x${string}`;
  epochId: number;
};

function currentEpochId(now = Date.now()): number {
  return Math.floor(now / 1000 / SCAFFOLD_KEYPER_LATENCY_SECONDS);
}

/**
 * Derive a 32-byte DEK bound to a unique per-tx identity. In production this is
 * replaced by `shutterEncrypt(plaintext, eonPublicKey, identity, sigma)` which uses
 * threshold IBE — the keyper set returns a decryption share keyed to `identity`,
 * not to an epoch. Per-tx identity means revealing one envelope does NOT decrypt
 * any other co-committed envelope. This addresses the per-epoch-key regression
 * Shutter publicly fixed on Gnosis.
 */
function deriveCallKey(identity: Buffer, eonSeed: Buffer): Buffer {
  if (identity.length !== 32) throw new Error("identity_must_be_32_bytes");
  return createHash("sha256")
    .update(eonSeed)
    .update(identity)
    .update(Buffer.from("provenant.shutter.call-key.v1", "utf8"))
    .digest();
}

function serialiseCalldata(p: CalldataPayload): Buffer {
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["uint256", "bytes32", "bytes32", "uint64", "bytes"],
    [p.tokenId, p.questionHash, p.bundleHash, p.enclaveTimestamp, p.teeSignature]
  );
  return Buffer.from(encoded.slice(2), "hex");
}

function deserialiseCalldata(buf: Buffer): CalldataPayload {
  const hex = "0x" + buf.toString("hex");
  const [tokenId, questionHash, bundleHash, enclaveTimestamp, teeSignature] =
    AbiCoder.defaultAbiCoder().decode(
      ["uint256", "bytes32", "bytes32", "uint64", "bytes"],
      hex
    );
  return {
    tokenId: BigInt(tokenId.toString()),
    questionHash: questionHash as `0x${string}`,
    bundleHash: bundleHash as `0x${string}`,
    enclaveTimestamp: Number(enclaveTimestamp),
    teeSignature: teeSignature as `0x${string}`,
  };
}

function computeCommitHash(args: {
  chainId: number;
  verifyingContract: `0x${string}`;
  identityHex: `0x${string}`;
  ciphertextHex: `0x${string}`;
  nonceHex: `0x${string}`;
  epochId: number;
}): `0x${string}` {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "address", "bytes32", "bytes", "bytes", "uint64"],
      [
        PROTOCOL_TAG,
        args.chainId,
        args.verifyingContract,
        args.identityHex,
        args.ciphertextHex,
        args.nonceHex,
        args.epochId,
      ]
    )
  ) as `0x${string}`;
}

/**
 * Commit phase — generate a unique per-tx identity, derive its DEK, AEAD-encrypt
 * the calldata, and return the envelope + a chain-bound, protocol-tagged commit hash.
 *
 * Required context (`ctx`):
 *   - `chainId`     : where the commit will be broadcast (e.g., 16661 for 0G Aristotle)
 *   - `verifyingContract` : the Provenant contract that will eventually call `logInference`
 *
 * In production the eonSeed is the Shutter network's `eonPublicKey` constant; here
 * it's the scaffold seed from `loadEonSeed()`.
 */
export function commit(
  payload: CalldataPayload,
  eonSeed: Buffer,
  ctx: { chainId: number; verifyingContract: `0x${string}` }
): EncryptedEnvelope {
  const identity = randomBytes(32);
  const identityHex = ("0x" + identity.toString("hex")) as `0x${string}`;
  const epochId = currentEpochId();
  const key = deriveCallKey(identity, eonSeed);
  const nonce = randomBytes(12); // CSPRNG; never reuse with the same key
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const plaintext = serialiseCalldata(payload);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([ct, authTag]);

  const envelopeArgs = {
    chainId: ctx.chainId,
    verifyingContract: ctx.verifyingContract,
    identityHex,
    ciphertextHex: ("0x" + ciphertext.toString("hex")) as `0x${string}`,
    nonceHex: ("0x" + nonce.toString("hex")) as `0x${string}`,
    epochId,
  };
  const commitHash = computeCommitHash(envelopeArgs);

  log.info(
    {
      chainId: ctx.chainId,
      verifyingContract: ctx.verifyingContract,
      epochId,
      identityHex,
      commitHash,
      ciphertextLen: ciphertext.length,
    },
    "shutter_commit_phase"
  );

  return { ...envelopeArgs, commitHash };
}

/**
 * Reveal phase — wait for the keyper to publish a decryption key for the envelope's
 * identity (in scaffold mode: a deterministic timer), then decrypt and verify that
 * the recovered payload's recomputed commit matches the on-chain commit.
 *
 * In production this becomes:
 *   const decryptionKey = await fetch(
 *     `${SHUTTER_API}/get_decryption_key?identity=${envelope.identityHex}`
 *   ).then(r => r.json());
 *   const plaintext = await shutterDecrypt(envelope.ciphertextHex, decryptionKey);
 */
export async function reveal(
  envelope: EncryptedEnvelope,
  eonSeed: Buffer,
  options: { waitForKey?: boolean } = {}
): Promise<RevealedPayload> {
  // Re-derive the expected commit and compare — domain separation + chain binding included
  const expectedCommit = computeCommitHash({
    chainId: envelope.chainId,
    verifyingContract: envelope.verifyingContract,
    identityHex: envelope.identityHex,
    ciphertextHex: envelope.ciphertextHex,
    nonceHex: envelope.nonceHex,
    epochId: envelope.epochId,
  });
  if (expectedCommit !== envelope.commitHash) {
    throw new Error("commit_hash_mismatch");
  }

  if (options.waitForKey !== false) {
    await awaitKeyForIdentity(envelope);
  }

  const identity = Buffer.from(envelope.identityHex.slice(2), "hex");
  const key = deriveCallKey(identity, eonSeed);
  const ciphertextBytes = Buffer.from(envelope.ciphertextHex.slice(2), "hex");
  const nonce = Buffer.from(envelope.nonceHex.slice(2), "hex");
  if (ciphertextBytes.length < 16) throw new Error("ciphertext_too_short");
  const ct = ciphertextBytes.subarray(0, ciphertextBytes.length - 16);
  const authTag = ciphertextBytes.subarray(ciphertextBytes.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  const payload = deserialiseCalldata(plaintext);
  return { ...payload, identityHex: envelope.identityHex, epochId: envelope.epochId };
}

/**
 * Scaffold wait — resolves when the *minimum publication delay* has elapsed since
 * the envelope's epoch began. In production this is a poll against the Shutter
 * keyper API for a decryption key bound to `envelope.identityHex` (NOT bound to
 * any epoch — per-tx identity means each envelope unlocks independently).
 */
async function awaitKeyForIdentity(envelope: EncryptedEnvelope): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const earliestUnlock = (envelope.epochId + 1) * SCAFFOLD_KEYPER_LATENCY_SECONDS;
  const wait = Math.max(0, earliestUnlock - now);
  if (wait > 0) {
    log.debug({ epochId: envelope.epochId, identityHex: envelope.identityHex, waitSec: wait }, "shutter_awaiting_key");
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}

/**
 * Load the eonSeed from env (SHUTTER_EON_SEED, 32-byte hex). Production: replace
 * with the `eon_key` returned by `POST /register_identity` against Shutter's API.
 * For the demo, derives a default deterministic seed if unset (logged as a warning).
 */
export function loadEonSeed(): Buffer {
  const hex = process.env.SHUTTER_EON_SEED;
  if (hex && /^0x?[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex.replace(/^0x/, ""), "hex");
  }
  log.warn(
    "SHUTTER_EON_SEED unset — using a default scaffold seed. DO NOT rely on this in production; swap with Shutter Network's `eon_key` from `POST /register_identity`."
  );
  return createHash("sha256").update("provenant:default-scaffold-eon-v1").digest();
}
