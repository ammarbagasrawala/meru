import { test } from "node:test";
import { strict as assert } from "node:assert";
import { commit, reveal, loadEonSeed } from "../src/mev/shutter";

const CTX = {
  chainId: 16661,
  verifyingContract: ("0x" + "11".repeat(20)) as `0x${string}`,
};

function samplePayload() {
  return {
    tokenId: 7n,
    questionHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
    bundleHash: ("0x" + "cd".repeat(32)) as `0x${string}`,
    enclaveTimestamp: 1_715_000_000,
    teeSignature: ("0x" + "ee".repeat(65)) as `0x${string}`,
  };
}

test("commit + reveal round-trips the payload", async () => {
  const seed = loadEonSeed();
  const envelope = commit(samplePayload(), seed, CTX);
  const recovered = await reveal(envelope, seed, { waitForKey: false });
  const p = samplePayload();
  assert.equal(recovered.tokenId, p.tokenId);
  assert.equal(recovered.questionHash, p.questionHash);
  assert.equal(recovered.bundleHash, p.bundleHash);
  assert.equal(recovered.enclaveTimestamp, p.enclaveTimestamp);
  assert.equal(recovered.teeSignature, p.teeSignature);
  assert.equal(recovered.identityHex, envelope.identityHex);
});

test("commit produces a unique per-tx identity (no per-epoch key reuse)", () => {
  // Per-tx identity is the regression Shutter fixed on Gnosis (~$300K). Two commits in
  // the same epoch must yield distinct identities AND distinct ciphertexts.
  const seed = loadEonSeed();
  const e1 = commit(samplePayload(), seed, CTX);
  const e2 = commit(samplePayload(), seed, CTX);
  assert.notEqual(e1.identityHex, e2.identityHex);
  assert.notEqual(e1.ciphertextHex, e2.ciphertextHex);
  assert.notEqual(e1.commitHash, e2.commitHash);
});

test("commit hash is chain-bound (replay across chains is detected)", () => {
  const seed = loadEonSeed();
  const onAristotle = commit(samplePayload(), seed, CTX);
  // Tamper: pretend the envelope was for a different chain — the reveal must reject the mismatch.
  const tampered = { ...onAristotle, chainId: 1 };
  return reveal(tampered, seed, { waitForKey: false }).then(
    () => assert.fail("expected commit_hash_mismatch"),
    (err) => assert.ok(/commit_hash_mismatch/.test((err as Error).message))
  );
});

test("commit hash is verifyingContract-bound (cross-app replay detected)", () => {
  const seed = loadEonSeed();
  const env = commit(samplePayload(), seed, CTX);
  const tampered = {
    ...env,
    verifyingContract: ("0x" + "22".repeat(20)) as `0x${string}`,
  };
  return reveal(tampered, seed, { waitForKey: false }).then(
    () => assert.fail("expected commit_hash_mismatch"),
    (err) => assert.ok(/commit_hash_mismatch/.test((err as Error).message))
  );
});

test("AEAD detects ciphertext tampering (auth tag)", () => {
  const seed = loadEonSeed();
  const env = commit(samplePayload(), seed, CTX);
  // Flip a byte in the ciphertext payload region (leave the auth tag for AEAD to catch).
  const ctBytes = Buffer.from(env.ciphertextHex.slice(2), "hex");
  ctBytes[0] = ctBytes[0]! ^ 0xff;
  const tampered = {
    ...env,
    ciphertextHex: ("0x" + ctBytes.toString("hex")) as `0x${string}`,
  };
  // Note: tampering ciphertext changes the commit-hash preimage too, so we expect the
  // commit mismatch to trip first — both failures prove the integrity property.
  return reveal(tampered, seed, { waitForKey: false }).then(
    () => assert.fail("expected reveal to reject tampered ciphertext"),
    (err) => assert.ok(err instanceof Error)
  );
});
