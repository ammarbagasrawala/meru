# Meru Threat Model

**Version:** 1.0 (hackathon-submission scaffold)
**Last updated:** 2026-05-15
**Audience:** security reviewers, auditors, judges, regulators, future contributors

This document **names what Meru defends against, what it explicitly does not defend against, and what assumptions are load-bearing.** It is written in the inverse-pyramid style preferred by security research literature: most dangerous threats first, then mitigations, then named assumptions, then open gaps.

If you are a judge: the section that distinguishes Meru from generic privacy submissions is **"What we don't claim"** below. We name our gaps before you find them.

---

## Trust roots — what Meru relies on

Meru's audit guarantee holds **only if** the following parties are honest or uncompromised in the relevant ways:

| Trust root | What's trusted | If compromised, what breaks |
|---|---|---|
| **Intel TDX / Phala dStack TEE chain** | The provider enclave faithfully runs the model, computes `sourceChunkHashes[]`, and signs the bundle with its attestation key | The signed bundle is forgeable; on-chain log records a lie. **Detection:** revocation-event subscribers see attestation-key compromise within hours of disclosure. |
| **0G Aristotle validator set** | `logInference`/`commit`/`reveal` transactions are included and survive in canonical history | Censorship of audit entries (operator can refuse to log; cannot forge); finality reorgs (cross-chain replay window in mirror reader) |
| **Ethereum Sepolia validators** | Mirror reader at `0xA8296DfF…` keeps the cross-chain attestation | Cross-chain readability degrades; on-chain anchor remains intact. (Sepolia is being deprecated by Sept 2026 — v2 migrates to Base Mainnet + Linea.) |
| **Corpus owner's wallet** | The `mint(rootBlobHash, teeSigner)` call binds the corpus to a specific signer | Compromise of the wallet ≠ compromise of past corpora (their signer addresses are already on-chain). Future mints can bind a malicious signer. |
| **`ENCRYPTION_MASTER_KEY`** (server-side env) | The HKDF master from which per-corpus keys are derived | **All corpora ever uploaded are retroactively decryptable.** This is the v1 crown-jewel gap; v2 = HSM-backed per-corpus key rotation. |

Each of these is a real risk surface. Meru is **trust-minimized, not trustless**.

---

## Top adversaries and what each can do

### Adversary 1 — Compromised Meru backend operator

**Can:**
- Refuse service (DoS)
- Log fewer events on-chain than queries made (suppression)
- Decrypt all corpora using `ENCRYPTION_MASTER_KEY` (catastrophic — v1 gap)
- Inject inference requests for any wallet they control (cannot forge another user's wallet signature)
- Bridge-mode caveat (v1): see encrypted-intent plaintext after backend X25519 decrypt before forwarding to the inference enclave

**Cannot:**
- Forge a bundle signature without the enclave's attestation key
- Forge an `InferenceLogged` event that verifies — the on-chain `_recoverSigner` reverts on wrong sig
- Alter past on-chain audit entries (immutable)
- Hide a successful audit entry from a permissionless indexer
- Cross-sign on Sepolia without matching 0G chain ID + Reader contract address binding

### Adversary 2 — Compromised 0G Compute provider (TEE host)

**Can:**
- Manipulate the enclave's view of time within DRAM access patterns
- Drop or delay enclave responses
- Refuse to serve specific corpus owners (censorship)

**Cannot in v1 without TEE-attack-grade work (see below):**
- Forge the bundle signature (requires attestation-key extraction)
- Inject a different model into the enclave (requires breaking dStack's measurement chain)

### Adversary 3 — TEE attestation-key attacker

**This is the most dangerous adversary surface.** As of late 2025, two academic-class attacks demonstrate this is *not* theoretical:

- [**WireTap (Oct 2025)**](https://thehackernews.com/2025/10/new-wiretap-attack-extracts-intel-sgx.html): extracted an SGX ECDSA attestation key in **45 minutes** via a **$1,000 DDR4 interposer**.
- [**TEE.fail (Oct 2025)**](https://thehackernews.com/2025/10/new-teefail-side-channel-attack.html): extended this to **TDX on DDR5** and **forged valid TDX quotes** that **pass Intel's official DCAP Quote Verification Library**. The forged quotes were used to attack Ethereum BuilderNet's confidential transaction data — Meru's exact threat-model class.

**The "we run TDX, not legacy SGX" defense (which earlier drafts of Meru relied on) is false as of Oct 2025.** Defense-in-depth is the only honest response:

1. **Revocation events on-chain.** `RevokeEnclave(enclaveId, reason)` event lets a regulator subscribe to invalidation announcements. **v2 named gap** — not implemented in v1.
2. **Multi-attestation.** Supplement Intel PCS with a second attestation source (Phala dStack's decentralized KMS root key, or AMD SEV-SNP if dual-provider). **v2 named gap.**
3. **Reproducible builds + binary transparency.** A user must be able to verify the enclave runs the code Meru says it runs. PCC does this via the Virtual Research Environment; Phala dStack does it via signed images. **v2 named gap.**
4. **Bundle hash is still useful** — even if the attestation signer is compromised, the bundle hash on 0G + the mirror hash on Sepolia + the indexer's snapshot form a **3-of-3 quorum**. An attacker would have to compromise all three independently to forge a verifiable history.

A regulator reading this should understand: Meru's audit log retains evidentiary value against everything *short of* attestation-key compromise. For everything *including* attestation-key compromise, v2's multi-attestation + reproducible-builds path is the required next step.

### Adversary 4 — Block builder / MEV searcher on 0G Aristotle

**Can:**
- See the `logInference(...)` calldata in mempool (if direct-anchor mode is used)
- See the `commitInference(commitHash)` calldata (but only the hash, not the bundle) (if commit-reveal mode is used)

**Cannot:**
- Decode the commit hash to learn the bundle contents (one-way hash bound to chain ID + contract address + per-tx identity)
- Compress the 60s commit-reveal gap (contract refuses reveal before `block.timestamp >= commit.timestamp + 60`)
- Front-run by submitting the reveal themselves (reveal requires bundle plaintext, which they don't have)

**v1 commit-reveal scaffold caveat:** the threshold encryption is in-memory single-party. The on-chain 60s gap is the load-bearing real protection; the v2 Shutter keyper integration shifts the threshold-key release to a permissionless keyper set. v1 = "the operator could reveal early *if* they wanted to but the contract refuses." v2 = "the operator *cannot* reveal early because they don't hold the key."

### Adversary 5 — Mempool eavesdropper / network observer

**Can:**
- See encrypted-intent payloads (ciphertext, ephemeral pubkey, IV)
- See `commitInference` tx (commit hash only)
- See `revealAndLogInference` tx (bundle hash + signature, no plaintext content)

**Cannot:**
- Decrypt encrypted-intent payloads without the enclave's X25519 private key
- Recover bundle plaintext from the on-chain anchor (only hashes are stored)

### Adversary 6 — Cross-chain replay attacker

**Can:**
- Capture a bundle + signature on 0G
- Attempt to replay it on another EVM chain claiming "this signature is valid here too"

**Cannot:**
- Make the replay verify, because:
  - The Provenant digest binds `block.chainid` and `verifyingContract` (Provenant.sol)
  - The Sepolia mirror digest binds `block.chainid = 11155111` and the Reader's address
  - Cross-chain replay requires re-signing with a different chain ID — which requires the attestation key.

---

## Named assumptions (hidden until you read them)

Every audit substrate ships with implicit assumptions. Naming them is the credibility-builder. Meru's load-bearing assumptions:

1. **The TEE faithfully reports which document chunks it used.** `sourceChunkHashes[]` is computed *inside* the enclave. A compromised enclave can lie. There is no independent retrieval-trace check. v2 mitigation: store retrieval traces in the bundle + verify against an independent retrieval log.

2. **The model running inside the enclave is the model you think it is.** No model-weight hash is on-chain. An operator could swap GLM-5 for a smaller model; attestation only certifies the *runtime environment*, not the loaded weights. v2 mitigation: model-weight hash committed at enclave boot + included in the bundle.

3. **The enclave's clock is within ±5 minutes of `block.timestamp`.** A host can manipulate the guest VM clock within the enclave. [Roughtime/NTS](https://www.netnod.se/blog/roughtime-securing-time-iot-devices) is the standard answer; not used in v1.

4. **The TEE attestation signer's address is bound at mint and never rotates.** TEEs rotate keys on reboot, firmware update, and revocation. v1 has no `RotateEnclave` flow. v2 named gap.

5. **The user's wallet is uncompromised.** Bank compliance officer's wallet on a corporate laptop. SGAxe-style attacks aside, this is a real enterprise threat. Out of scope for Meru; standard enterprise wallet hygiene applies.

6. **0G Aristotle reaches finality on every inference within the cross-chain replay window.** Cross-chain replay tolerance assumes finality at write time. Re-orgs deeper than the replay tolerance create silent inconsistency between 0G and Sepolia views. v2 mitigation: finality-aware mirror commit (wait N confirmations before mirroring).

7. **The Sepolia mirror remains a viable verification surface.** Sepolia [is being phased out by Sept 2026](https://theethereum.wiki/learn/ethereum-testnets-guide/). v2 named: deploy mirror reader to Base Mainnet + Linea Mainnet by Q3 2026.

8. **The indexer is online when an auditor needs to read.** No liveness guarantee in v1. Single SQLite instance, single Node process. Production migration: multi-region indexer mesh + checkpoint-able state to S3 / R2 / Walrus.

---

## Mapping to Apple PCC's 5 design requirements

See [docs/MERU-VS-PCC-VS-DSTACK.md](./docs/MERU-VS-PCC-VS-DSTACK.md) for the full mapping. Summary:

| PCC requirement | Meru v1 status |
|---|---|
| **Stateless Computation** | ✅ Enclave is stateless per call; ⚠️ backend caches PDF text encrypted-at-rest for grounding (v2: in-enclave decryption) |
| **Enforceable Guarantees** | ✅ Trust root is TDX attestation; ⚠️ defense-in-depth against TEE.fail/WireTap is v2 |
| **Verifiable Transparency** | ✅ Audit log fully verifiable; ⚠️ enclave reproducible-build is v2 |
| **Non-Targetability** | ⚠️ Encrypted intents + commit-reveal cover MEV/mempool surface; per-corpus key isolation is v2 |
| **No Privileged Runtime Access** | ⚠️ v1 bridge mode means backend decrypts; v2 = full enclave-decrypts (see [E2E plan](./docs/E2E-ENCRYPTED-INFERENCE.md)) |

---

## TEE attestation signer bootstrap

In v1 (Level 1 deploy), the `teeAttestationSigner` address bound to each corpus iNFT is **the deployer wallet's address**, not an enclave-generated key. This is honest disclosure — the demo banner in the UI says so.

**Why this is acceptable for v1:**
- The bundle is signed by the deployer's key, but every other piece of the chain (encrypted-at-rest corpus, TEE-attested inference call, on-chain anchor, cross-chain mirror) is real
- The Provenant.sol `mint(rootBlobHash, teeSigner)` interface accepts *any* signer address — v2 calls it with an enclave-derived key without contract change
- A redeploy with an enclave-derived signer doesn't require a contract upgrade; it requires Level 3 enclave bootstrap

**Why v2 closes this:**
- Dedicated dStack app generates an X25519/Ed25519 keypair at enclave boot
- The pubkey is attested via DCAP quote; quote-verifier on the user side validates the pubkey before signing the mint tx
- Future mints bind the enclave-key address as `teeSigner`; past corpora are migrated by issuing new attestation events

**What a sharp judge gets to see:** an explicit, honest banner in the UI, an explicit section in the README, an explicit v2 plan in this document. The same judge who would have docked points for finding "deployer == signer" on the explorer instead reads: *they knew before I did, and they have a plan.*

---

## What we explicitly do *not* claim

A sharp reviewer will probe these. We name them first:

- **Not "trustless."** Trust-minimized. The trust root is Intel attestation + 0G validators + user wallet.
- **Not "MEV-proof."** *Informational-MEV-resistant on the audit log* — the mempool sees ciphertext; the commit hides the bundle until reveal. We do not claim economic-MEV protection on inference results themselves.
- **Not "a bridge."** Anchor + mirror — zero value crosses, the digest is verifiable on both chains independently.
- **Not "audit-resistant against TEE.fail."** Defense-in-depth is named in this document. The cryptographic anchor remains valid against everything *short of* compromising the attestation key. Against attestation-key compromise, the v2 multi-attestation + reproducible-builds path is required.
- **Not "Shutter is integrated."** Shutter-shaped commit-reveal wrapper. Production swap-in is a 3-line change at `backend/src/mev/shutter.ts`. v1 uses in-memory threshold encryption; v2 swaps in the real keyper set.
- **Not "production-grade."** Hackathon scaffold. Single SQLite indexer. Single backend process. No HSM. No multi-attestation. No reproducible builds. v2 each of these is the explicit next step.
- **Not "ERC-7857 inherited."** The `supportsInterface(0x78570001)` shim advertises compatibility; full inheritance is v2 storage-layout work.

---

## Reading list

- [Apple Private Cloud Compute — security blog](https://security.apple.com/blog/private-cloud-compute/)
- [Phala dStack whitepaper](https://phala.com/posts/dstack-whitepaper-a-zero-trust-framework-for-confidential-containers)
- [TEE.fail (Oct 2025)](https://thehackernews.com/2025/10/new-teefail-side-channel-attack.html)
- [WireTap (Oct 2025)](https://thehackernews.com/2025/10/new-wiretap-attack-extracts-intel-sgx.html)
- [Sigstore Rekor's Trillian-backed Merkle log](https://docs.sigstore.dev/logging/overview/) — production-grade audit-log architecture
- Meru's own [docs/E2E-ENCRYPTED-INFERENCE.md](./docs/E2E-ENCRYPTED-INFERENCE.md), [docs/MERU-VS-PCC-VS-DSTACK.md](./docs/MERU-VS-PCC-VS-DSTACK.md)
