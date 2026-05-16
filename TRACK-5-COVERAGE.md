# Track 5 — Privacy & Sovereign Infrastructure

## Sub-theme coverage statement

> Per the official 0G APAC Hackathon problem statement, Track 5 names three technical sub-themes:
>
> *"Developing privacy-preserving protocols, cross-chain fragmentation solutions, and MEV-resistant infrastructure."*
>
> This document states **what Meru ships in the 5-day MVP, what the production-target system extends to, and where every scaffold honestly sits in between.** It is the load-bearing document for judges who want vision-vs-reality clarity in one read.

---

## Reading guide

This file pairs with two companion docs:

- 📐 [**`docs/PRODUCTION-VISION.md`**](./docs/PRODUCTION-VISION.md) — the full production-target architecture, market thesis, sequence diagrams, and stack. *"What Meru is being built toward."*
- 🛠 [**`docs/HACKATHON-MVP.md`**](./docs/HACKATHON-MVP.md) — the 5-day slice that's actually live on 0G Aristotle mainnet. *"What we shipped."*

Every sub-theme section below has three blocks:

- **🟢 Production vision** — what the full system delivers (from PRODUCTION-VISION.md)
- **🛠 MVP shipped** — what the 5-day repo demonstrably runs (from HACKATHON-MVP.md)
- **🟡 Scaffold → v2** — the honestly-labelled gap between the two

The point of this format: a judge can read the production vision, see the live-mainnet MVP, and verify the gap is documented rather than hidden.

---

## Sub-theme 1 — Privacy-preserving protocols

### 🟢 Production vision

The full system is **the open-source / decentralized / on-chain-anchored equivalent of [Apple Private Cloud Compute](https://security.apple.com/blog/private-cloud-compute/) for regulated industries.** PCC's five design requirements map directly:

| PCC requirement | Meru production target |
|---|---|
| **Stateless Computation** | Enclave is stateless per call; corpus decryption happens inside the enclave at query time. No plaintext persists on backend or compute hosts. |
| **Enforceable Guarantees** | Multi-attestation quorum (Intel TDX + AMD SEV-SNP) + reproducible builds + on-chain `RevokeEnclave` events on disclosure. |
| **Verifiable Transparency** | Anchor on 0G Chain + mirror on Base/Linea/Ethereum + permissionless indexer mesh + standalone verifier. Trust collapses to chain reads. |
| **Non-Targetability** | Encrypted intents → enclave-owned X25519 key + commit-reveal MEV gate + per-corpus HSM-backed key isolation. |
| **No Privileged Runtime Access** | Backend is transport-only; signing keys live inside the enclave; auditor can verify without operator cooperation. |

Full mapping in [`docs/MERU-VS-PCC-VS-DSTACK.md`](./docs/MERU-VS-PCC-VS-DSTACK.md). The architectural primitive is the **signed-bundle wire format** `(answer, sourceChunkHashes[], modelId, enclaveTimestamp, signature)` — proposed as **Audit Substrate v1.0** for any 0G app needing verifiable AI inference receipts.

### 🛠 MVP shipped (live on 0G Aristotle mainnet)

| Component | Where | Status |
|---|---|---|
| **Audit Anchor Protocol** | [`contracts/Provenant.sol`](./contracts/contracts/Provenant.sol) deployed at [`0xA8296DfF…30C5`](https://chainscan.0g.ai/address/0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5) (7,378 bytes verified bytecode) | ✅ Real mainnet artifact |
| **Sealed-Inference SDK** | [`backend/src/inference/seal.ts`](./backend/src/inference/seal.ts) — wires `@0gfoundation/0g-compute-ts-sdk@^0.8.3` to a real Phala TEE provider (`gpt-5.4-mini` on `dstack-pha-prod5.phala.network`); verifies the provider's chat signature via `processResponse` against the on-chain `teeSignerAddress` | ✅ Real TEE-attested inference |
| **Encrypted-at-rest corpus** | [`backend/src/storage/encryptUpload.ts`](./backend/src/storage/encryptUpload.ts) + [`crypto/keys.ts`](./backend/src/crypto/keys.ts) — AES-256-GCM, CSPRNG 12-byte IV, HKDF-SHA-256-derived per-corpus keys; ciphertext uploaded to 0G Storage | ✅ Real |
| **On-chain audit log** | `Provenant.sol::logInference` emits `InferenceLogged(tokenId, bundleHash, questionHash, timestamp)`. Replay-protected via `block.chainid + verifyingContract` in the digest | ✅ Real |
| **Defence-in-depth threat model** | [`THREAT-MODEL.md`](./THREAT-MODEL.md) acknowledges TEE.fail / WireTap (Oct 2025) and frames TDX defense as defense-in-depth, not denial | ✅ Documented |
| **Honest claim discipline** | `seal.ts` hard-fails when `processResponse` returns `null` (no `ZG-Res-Key`). `query.ts` refuses on-chain anchoring when `bundle.stub === true`. No silent verification downgrade. | ✅ Code-level honesty gates |

One-command verification: `cd backend && npm run smoke` — 8 checks, all green against live mainnet.

### 🟡 Scaffold → v2 (named honestly, not hidden)

| Today (MVP) | Tomorrow (v2 production) | What unlocks the swap |
|---|---|---|
| Backend has the X25519 private key (bridge mode) | Enclave generates X25519 keypair at boot via Phala dStack KMS; pubkey attested via DCAP quote | Custom dStack app + browser-side DCAP verifier; plan in [`docs/E2E-ENCRYPTED-INFERENCE.md`](./docs/E2E-ENCRYPTED-INFERENCE.md) |
| Document encryption is server-side | Browser-side encryption with user-wallet-derived keys | Browser-side key management UX + key persistence story |
| Single `ENCRYPTION_MASTER_KEY` HKDF root | HSM-backed per-corpus rotation + key shredding for right-to-erasure | AWS KMS / HashiCorp Vault + per-tenant scopes |
| `sourceChunkHashes[]` are corpus blob fingerprints | Per-chunk retrieval-trace commitments computed inside the enclave | Real RAG runs inside the enclave with chunk commitments |
| Single TEE attestation signer | Multi-attestation quorum (Intel TDX + AMD SEV-SNP) + on-chain `RevokeEnclave` / `EnrollEnclave` events | Second-vendor attestation + signer-governance contract |
| TEE signer == deployer wallet (Level-1 placeholder) | Enclave-generated key bound at mint, registered on-chain | Dependent on the dStack app above |

---

## Sub-theme 2 — Cross-chain fragmentation solutions

### 🟢 Production vision

Cross-chain *audit readability* (not liquidity) is the load-bearing claim. The full system anchors every Provenant bundle on 0G Aristotle and re-attests it on **N independent EVM chains** (Base Mainnet + Linea + Ethereum L1) — **without a bridge, without a validator quorum, without funds in flight**.

Why this matters:

- Auditors who read Ethereum (not 0G) can verify Meru audit logs without trusting our backend, without running a 0G node
- The same TEE attestation signer signs a chain-bound digest on each destination — single signer identity, multiple independent witnesses
- Bridges have lost **$1.23B+ since 2022** (Wormhole, Ronin, Nomad, Multichain, KelpDAO). Meru's anchor + mirror has **zero value crossing**; the relayer's role is publish-only

V3 production roadmap layers:
1. **Permissionless indexer mesh** — multi-region nodes; checkpoint-able state to S3/R2/Walrus
2. **Brevis ZK proof-of-consensus** — replaces the relayer with a ZK proof of 0G block headers; cross-chain proofing becomes trust-free
3. **Multi-mirror quorum** — any audit log requires re-attestation on ≥ 2 of 3 destination chains before being considered "anchored"

### 🛠 MVP shipped

| Component | Where | Status |
|---|---|---|
| **`ProvenantReader.sol` on Sepolia** | Deployed at [`0xA8296DfF…30C5`](https://sepolia.etherscan.io/address/0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5) | ✅ Real cross-chain mirror |
| **Mirror digest format** | Chain-bound: `keccak256(bundleHash, originTxHash, originChainId, ts, mirrorChainId, readerAddress)` with EIP-191 prefix. Re-signed by the configured signer for the destination chain. | ✅ Real |
| **Permissionless indexer** | Standalone Node.js package at [`indexer/`](./indexer/) with JSON-RPC 2.0 (`provenant_getInferences`, `provenant_status`, `provenant_getInferenceByBundle`) + REST + WebSocket push | ✅ Real |
| **Multi-destination relayer** | `INDEXER_MIRROR_TARGETS` env accepts `chainId:rpc:reader:pk` tuples; each destination is independent | ✅ Real (scaffolded; one destination active in v1) |
| **KelpDAO-anti-pattern hardening** | `indexerSignFallback` is **off by default** with a `[KELPDAO-ANTIPATTERN]` warning in code. Default behaviour mirrors the TEE-attested signature already on the bundle. | ✅ Hardened |
| **Standalone verifier widget** | [`verifier/index.html`](./verifier/index.html) — single static HTML, no Meru backend in the loop. Queries 0G Aristotle RPC + Sepolia RPC directly. | ✅ Real |
| **Auditor view in UI** | `/audit/[tokenId]` toggles between Backend (Express) and Indexer (JSON-RPC) sources; same wire format both ways | ✅ Real |

### 🟡 Scaffold → v2

| Today | Tomorrow | What unlocks |
|---|---|---|
| Sepolia mirror (deprecating Sept 2026) | Mainnet mirror to Base + Linea + Ethereum L1 | Production deploys + ProvenantReader redeploys |
| Single indexer instance (SQLite) | Multi-region indexer mesh (Postgres + Redis + S3/R2 checkpoint) | Production ops infra |
| Relayer-style mirroring | Brevis ZK proof of cross-chain consistency | 16-24h ZK circuit work; documented in [`docs/PRODUCTION-VISION.md §8.2`](./docs/PRODUCTION-VISION.md) |
| `relay_with_signature` mode requires the TEE sig | Extend `InferenceLogged` event to carry the TEE signature inline | Contract redeploy with new event topic |

---

## Sub-theme 3 — MEV-resistant infrastructure

### 🟢 Production vision

Meru defends against **informational MEV on the audit-log layer** — a generalisation of classical DEX MEV to "any state-transition reorderability" (per [Flashbots' formalisation paper](https://writings.flashbots.net/formalization-mev)). Two complementary primitives:

**Encrypted intents**
- Browser-side X25519 keypair generation → ECDH against the enclave's attested public key → HKDF-SHA-256 → AES-256-GCM
- Browser sends ciphertext; mempool / backend / network observers see only ciphertext
- Only the enclave can decrypt — production target removes the backend from the trust boundary entirely

**On-chain commit-reveal**
- `commitInference(commitHash)` posts an opaque 32-byte hash on 0G Aristotle; commit hash is chain-bound + protocol-tagged
- Contract enforces `REVEAL_DELAY = 60 seconds` — `revealAndLogInference(...)` reverts if `block.timestamp < commit.timestamp + 60`
- A block builder cannot bundle commit + reveal in the same block (the chain refuses)
- Production: threshold-keyper integration via Shutter Network keyper API releases the decryption key only after the window, removing the operator's ability to reveal early

Architectural parallel: CoW Protocol's batch auctions + Flashbots SUAVE + Shutter Network all use the same primitive (encrypted intents + ordering separation). Different domain (audit logs vs DEX swaps), same architectural pattern.

### 🛠 MVP shipped

| Component | Where | Status |
|---|---|---|
| **Browser-side encrypted intents** | [`frontend/src/lib/encryptQuery.ts`](./frontend/src/lib/encryptQuery.ts) — `@noble/curves` X25519 + `@noble/ciphers` AES-GCM + `@noble/hashes` HKDF | ✅ Real wire-format-defining browser crypto |
| **Backend X25519 decryption** | [`backend/src/crypto/decryptQuery.ts`](./backend/src/crypto/decryptQuery.ts) — bridge mode for v1 (backend decrypts before forwarding to TEE). Labelled honestly in UI + README. | ✅ Real (bridge mode) |
| **Commit-reveal envelope** | [`backend/src/mev/shutter.ts`](./backend/src/mev/shutter.ts) — chain-bound + protocol-tagged commit hash with per-tx identity (avoids Shutter's Gnosis per-epoch regression) | ✅ Real |
| **On-chain commit-reveal gates** | `Provenant.sol::commitInference` + `revealAndLogInference` with `REVEAL_DELAY = 60 seconds` contract-enforced gate. Single-use commit slot (`delete` on reveal). | ✅ Real, deployed |
| **Hardhat tests** | 5 commit-reveal tests pass (commit registers / rejects double / rejects zero / rejects without-commit / rejects too-early). Total contract tests: **15 passing** | ✅ |
| **Backend MEV tests** | 5 shutter.ts tests pass — round-trip soundness, chain-binding, AEAD integrity, per-tx identity uniqueness | ✅ |
| **Wired into the inference flow** | `POST /api/query` with `mev: "commit-reveal"` triggers the two-tx cycle; commit hash + reveal tx hash surfaced in the response and the UI's PipelineTracker holds on commit for the contract-enforced 60s window | ✅ |

### 🟡 Scaffold → v2

| Today | Tomorrow | What unlocks |
|---|---|---|
| In-memory threshold encryption (single-party local timer) | Real Shutter Network keyper API integration | 3-line swap-in documented in `shutter.ts` head-comment: `deriveCallKey` → `shutterEncrypt`, `awaitKeyForIdentity` → `GET /get_decryption_key`, `loadEonSeed` → `eon_key` from `POST /register_identity`. Alt: Fairblock/FairyRing on Cosmos. |
| Commit-then-never-reveal griefing is unmitigated | Commit bond + slashable reveal deadline | Contract upgrade + economic-game design |
| Backrunning the reveal is residual risk (information becomes public by design) | FOCIL-style ordered inclusion lists + batched reveals to dilute the signal | Protocol-level work; Vitalik-endorsed Feb 2026 |
| Encrypted intents terminate at backend (bridge) | Enclave-owned decryption — backend never sees plaintext | Same dStack-app work that closes sub-theme 1 |

---

## Mainnet artifacts (eligibility-critical)

A judge can verify the entire claim chain in under five minutes:

| Artifact | Where | Verification |
|---|---|---|
| `Provenant.sol` deployed | 0G Aristotle (chain 16661) | [`chainscan.0g.ai/address/0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5`](https://chainscan.0g.ai/address/0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5) — 7,378 bytes verified bytecode |
| `ProvenantReader.sol` deployed | Sepolia (chain 11155111) | [`sepolia.etherscan.io/address/0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5`](https://sepolia.etherscan.io/address/0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5) |
| Real `CorpusMinted` + `InferenceLogged` events | 0G Aristotle | Multiple corpus mints + multi-event audit history on the contract page |
| Real `InferenceCommitted` + `InferenceRevealed` pairs | 0G Aristotle | Visible commit-reveal cycle with ≥ 60-second on-chain gap |
| Sepolia mirror txs | Sepolia | Real `mirror()` re-attestation calls |
| One-command verification | `cd backend && npm run smoke` | 8/8 ✅ across RPC reachability, bytecode, ERC-721 + ERC-7857 shim, `corpusOf`, `inferenceCountOf`, `inferenceAt` |
| Standalone verifier | [`verifier/index.html`](./verifier/index.html) | Open in any browser, paste tokenId + bundleHash, ✓ verified against 0G + Sepolia directly |

---

## What Meru explicitly does NOT claim

Sharp-judge filter. We name our limits so a probing question doesn't surprise us:

| ❌ Not claimed | Why |
|---|---|
| "Plaintext never reaches the server" | False in v1 bridge mode — backend decrypts encrypted intents before forwarding to the TEE |
| "Only the TEE can decrypt" | True for storage at rest, false for the bridge-mode intent path |
| "Cryptographic proof of zero leakage" | Replaced with "tamper-evident provenance and explicit trust-boundary disclosure" |
| "Same TEE signer re-attests on Sepolia" | Same *configured signer identity* re-attests; production should move signing into enclave-owned keys |
| "Source chunks" as retrieval proof | v1 `sourceChunkHashes[]` = corpus blob fingerprints, not per-chunk retrieval evidence |
| "RevokeEnclave / key-rotation on-chain" | Language only — not implemented in contract code today |
| "MEV-proof" | We make *informational MEV expensive on the intent path*, not eliminate MEV |
| "Trust-free cross-chain" | Anchor + mirror is trust-*minimised* (no bridge, no validator quorum), not trust-free. Trust-free requires Brevis-class ZK proofs (v2) |
| "Production Shutter is integrated" | Shutter-shaped wrapper. Real keyper integration is the documented 3-line swap |
| "Trustless" | Trust-minimised. Trust roots: Intel attestation + 0G validators + corpus owner's wallet |
| "A bridge" | Mirror is event re-attestation; no value crosses, no validator quorum, no slashing surface |

Full named-assumptions list in [`THREAT-MODEL.md`](./THREAT-MODEL.md).

---

## Cross-references

- 📐 [**`docs/PRODUCTION-VISION.md`**](./docs/PRODUCTION-VISION.md) — full Web 4.0 architecture, market thesis, sequence diagrams, stack layers
- 🛠 [**`docs/HACKATHON-MVP.md`**](./docs/HACKATHON-MVP.md) — 5-day MVP slice details + extensibility to agents/MCP/multi-agent
- 🛡 [**`THREAT-MODEL.md`**](./THREAT-MODEL.md) — adversaries, named assumptions, TEE.fail/WireTap, what we don't claim
- 🍎 [**`docs/MERU-VS-PCC-VS-DSTACK.md`**](./docs/MERU-VS-PCC-VS-DSTACK.md) — Apple PCC's 5 design requirements mapped against Meru and Phala dStack
- 🔐 [**`docs/E2E-ENCRYPTED-INFERENCE.md`**](./docs/E2E-ENCRYPTED-INFERENCE.md) — v2 enclave-owned encryption handshake protocol
- ⚙️ [**`docs/INTEGRATING-0G-SEALED-INFERENCE.md`**](./docs/INTEGRATING-0G-SEALED-INFERENCE.md) — broker SDK integration recipe (useful for any 0G builder)
- 📋 [**`README.md`**](./README.md) — entry point, mainnet addresses, demo URL, trust-boundary summary

---

*Aligned with `docs/PRODUCTION-VISION.md` (full architecture) and `docs/HACKATHON-MVP.md` (5-day shipped slice). Updated 2026-05-16.*
