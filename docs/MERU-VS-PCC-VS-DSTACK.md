# Meru vs. Apple Private Cloud Compute vs. Phala dStack

A side-by-side comparison of three confidential-AI architectures, mapped against the **five PCC design requirements** Apple published in its [Private Cloud Compute security blog](https://security.apple.com/blog/private-cloud-compute/) (June 2024). PCC is the canonical reference architecture for confidential AI inference at scale; Meru and Phala dStack are the open-source alternatives.

The point of this document is not to claim feature parity with PCC. The point is to **name what PCC gets right, name what it gets wrong, and name where Meru fits in the architectural lineage** — so a sophisticated reviewer can place Meru in 30 seconds rather than 30 minutes.

---

## TL;DR

| | Apple PCC | Phala dStack | **Meru on 0G** |
|---|---|---|---|
| **Trust root** | Apple silicon + Apple infra | Intel TDX + Phala decentralised KMS | Intel TDX + 0G validators + auditor-side chain reads |
| **Vendors** | One (Apple) | One (Phala) per app, multi-tenant per cluster | Multi-vendor — any 0G Compute provider |
| **Tenants per enclave** | One Apple service per enclave | One app per dStack instance | One inference call per enclave invocation |
| **Source open?** | Partial (key components only) | Yes (kit, OS, reference apps) | Yes — Meru, indexer, contracts, reference UI |
| **Reproducible builds?** | Yes (Virtual Research Environment) | Yes (signed images + on-chain measurements) | **v2 (named gap)** |
| **Permissionless audit log?** | No (Apple keeps logs) | App-dependent | **Yes — on-chain, anchor + mirror** |
| **Cross-chain readable?** | N/A | N/A | **Yes — anchor on 0G, mirror to Sepolia, no bridge** |
| **MEV protection on log writes?** | N/A | N/A | **Yes — commit-reveal with on-chain 60s window** |
| **Encrypted intents (client→enclave)?** | Yes (Secure Enclave key exchange) | App-dependent | Yes — X25519 → AES-GCM in browser (v1: bridge mode; v2: full enclave-decrypts; see [E2E plan](./E2E-ENCRYPTED-INFERENCE.md)) |

PCC is the **gold standard** for single-vendor confidential AI. Phala dStack is the **decentralised primitive** that lets anyone build a PCC-equivalent. Meru is the **audit-substrate layer** that sits on top — making any TEE inference (Phala-dStack-based or otherwise) verifiable across chains by independent parties.

---

## The five PCC design requirements

Apple published these as the architectural contract Private Cloud Compute makes with users. Every confidential-AI system can be evaluated against them.

### 1. Stateless Computation

> *"Personal user data submitted to PCC must be used only for fulfilling that user's request, and no other purpose, and must not be retained after the request is fulfilled, even by Apple."* — Apple

| | PCC | dStack | Meru |
|---|---|---|---|
| Enclave-local state wiped after request? | ✅ | ✅ (per-request enclave instance) | ✅ (broker-side; enclave is stateless per call) |
| User data retained outside enclave? | No (per Apple) | App-dependent | **Encrypted-at-rest on 0G Storage** (only ciphertext outside the enclave) |
| Operator can re-use stored ciphertext for other queries? | N/A | App-dependent | **No** — per-corpus HKDF subkey + on-chain corpus iNFT owner bound to the user wallet |

**Meru gap, honest:** today the backend caches extracted PDF text encrypted-at-rest on disk for grounding (see `backend/src/corpus/textCache.ts`). Plaintext exists in backend RAM during a query. The v2 architecture moves decryption inside the inference enclave, removing the backend from the trust boundary entirely. [E2E plan ↗](./E2E-ENCRYPTED-INFERENCE.md)

### 2. Enforceable Guarantees

> *"Security and privacy guarantees are strongest when they are entirely technically enforceable, which means it must be possible to constrain and analyze all the components that critically contribute to the guarantees of the overall Private Cloud Compute system."* — Apple

| | PCC | dStack | Meru |
|---|---|---|---|
| Trust root is silicon attestation? | ✅ Apple silicon | ✅ Intel TDX | ✅ Intel TDX (via 0G Compute on Phala) |
| Guarantees enforced by policy, not technology? | Minimal | Minimal | Minimal — bundle signature verifies on-chain |
| Compromised attestation = silent failure? | Apple cert revocation | Phala KMS root rotation | **On-chain `RevokeEnclave` event (v2 named gap)** + dual-attestation roadmap |

**Trust-root reality, named explicitly:** the TEE attestation chain depends on Intel's Provisioning Certification Service (PCS). [WireTap (Oct 2025)](https://thehackernews.com/2025/10/new-wiretap-attack-extracts-intel-sgx.html) extracted an SGX ECDSA attestation key in 45 minutes via a $1,000 DDR4 interposer. [TEE.fail (Oct 2025)](https://thehackernews.com/2025/10/new-teefail-side-channel-attack.html) extended this to TDX on DDR5 and forged valid TDX quotes against Ethereum BuilderNet. Meru's defense is **defense-in-depth, not denial** — see [THREAT-MODEL.md](../THREAT-MODEL.md).

### 3. Verifiable Transparency

> *"Security researchers need to be able to verify, with a high degree of confidence, that our privacy and security guarantees for Private Cloud Compute match our public promises."* — Apple

This is the single biggest "audit substrate" gap any honest accounting of Meru has to acknowledge.

| | PCC | dStack | Meru |
|---|---|---|---|
| Cryptographic chain from client to enclave is verifiable | ✅ | ✅ | ✅ Bundle → signature → on-chain anchor → cross-chain mirror |
| **The enclave actually runs the code claimed** | ✅ Virtual Research Environment (binary transparency log) | ✅ Reproducible builds + on-chain measurements | **v2 named gap** — the enclave is a 0G black box; we cite [Phala dStack's reproducible-build pattern](https://phala.com/posts/dstack-whitepaper-a-zero-trust-framework-for-confidential-containers) as the migration path |
| **The model running inside is the model claimed** | App-controlled | App-controlled | **No model-weight hash on-chain (v2 named gap)** |
| Audit log itself is verifiable without trusting the operator | Apple keeps the log | App-dependent | ✅ **Anchored on 0G Chain, mirrored to Sepolia, indexed permissionlessly** |
| Third party can verify a bundle hash without the operator | No (Apple's logs) | App-dependent | ✅ **[`verifier/index.html`](../verifier/index.html)** — vanilla HTML, no backend |

**This is where Meru wins.** PCC's transparency is about the *enclave* being verifiable; Meru's transparency is about the *audit log* being verifiable. Different but complementary. A regulator can verify Meru's audit log directly against on-chain data with no operator cooperation.

### 4. Non-Targetability

> *"An attacker should not be able to attempt to compromise personal data that belongs to specific, targeted Private Cloud Compute users without attempting a broad compromise of the entire PCC system."* — Apple

| | PCC | dStack | Meru |
|---|---|---|---|
| Per-user routing is uncorrelated with content? | ✅ (oblivious HTTP) | App-dependent | **v2 named gap** — current routing is operator-known |
| Encrypted intents prevent mempool targeting? | N/A (Apple controls mempool-equivalent) | App-dependent | ✅ X25519 → AES-GCM (mempool sees only ciphertext) |
| Commit-reveal prevents block-builder targeting? | N/A | N/A | ✅ Commit-reveal with on-chain 60s window |
| Per-corpus keys isolate blast radius? | App-dependent | App-dependent | ⚠️ HKDF-derived per-corpus but **shares an `ENCRYPTION_MASTER_KEY`** — compromise of master key compromises all corpora (v1 acceptable; v2 = HSM-backed per-corpus rotation) |

### 5. No Privileged Runtime Access

> *"PCC must not provide Apple any mechanism that would allow privileged access to a user's data."* — Apple

| | PCC | dStack | Meru |
|---|---|---|---|
| Operator cannot read in-flight plaintext? | ✅ (Apple-attested) | ✅ (TDX-enforced) | ✅ in v2 (full enclave-decrypts); ⚠️ v1 bridge mode — backend decrypts encrypted intents for forwarding |
| Operator cannot retroactively decrypt at-rest data? | ✅ (per-user keys) | App-dependent | ⚠️ With master key, **operator can decrypt all corpora** — v2 HSM-backed rotation closes this |
| Operator cannot inject inference requests as a user? | Apple-attested | App-dependent | ✅ User's wallet signs the query; operator can't forge the signature |
| Operator cannot drop or reorder audit log entries silently? | Apple keeps the log | App-dependent | ✅ **Anchor + mirror + permissionless indexer.** A dishonest operator can refuse to log, but **cannot create a forged log that verifies** — the operator's signing key is bound on-chain, multi-indexer reads catch suppression. |

---

## What Meru actually adds on top of PCC + dStack

PCC is closed-source single-vendor. Phala dStack is the open-source primitive that lets anyone build a PCC-equivalent. Both stop at the enclave boundary — what happens *after* an inference completes is up to the application.

Meru is the missing layer above:

1. **Cross-tenant audit substrate.** Multiple apps running on multiple TEE backends can write to the *same* on-chain log format, indexed by the *same* permissionless indexer, verifiable by the *same* cross-chain reader. PCC is one app per Apple service; dStack is one app per cluster; Meru is N apps writing to one audit primitive.

2. **Auditor-side independence.** Apple's audit happens inside Apple. Meru's audit happens on-chain — any regulator with an Ethereum/Sepolia/0G read connection can independently verify a bundle hash against the corpus owner's signature, without the operator's cooperation, without running a 0G node.

3. **No bridge.** PCC and dStack don't have bridges because they don't need cross-chain reach. Meru's anchor-then-mirror pattern gives EVM-native auditors access to 0G-attested events without trusting a bridge contract — the digest is signed identically on both sides.

4. **MEV defense at the audit-log layer.** A novel composition: the inference content is hidden via encrypted intents (the request); the inference *fact* is hidden until reveal via on-chain commit-reveal (the log). PCC and dStack address request privacy; Meru addresses log privacy from front-runners too.

---

## What Meru explicitly does *not* claim

A sharp reviewer will probe these. Naming them first is the credibility-builder:

- **Not "trustless."** Trust-minimized. The trust root is "Intel attestation signers + 0G validator set + the corpus owner's wallet." Each can fail; we degrade gracefully.
- **Not "MEV-proof."** *Informational-MEV-resistant on the audit log* — the mempool sees ciphertext; the commit hides the bundle until reveal. We do not claim economic-MEV protection on inference results themselves.
- **Not "a bridge."** Anchor + mirror — zero value crosses, the digest is verifiable on both chains independently.
- **Not "audit-resistant against TEE.fail."** Defense-in-depth: physical attacks on TEE silicon are named in the threat model and require multi-attestation + reproducible builds (v2). The cryptographic anchor remains valid against everything *short of* compromising the attestation key.
- **Not "Shutter is integrated."** Shutter-shaped commit-reveal wrapper. Production swap-in for the Shutter Network keyper API is a 3-line change, documented inline at `backend/src/mev/shutter.ts`. v1 uses in-memory threshold encryption; v2 swaps in the real keyper set.

---

## Reading list

- [Apple Private Cloud Compute — security blog](https://security.apple.com/blog/private-cloud-compute/) (the canonical 5-requirement document)
- [Phala dStack whitepaper](https://phala.com/posts/dstack-whitepaper-a-zero-trust-framework-for-confidential-containers)
- [TEE.fail (Oct 2025)](https://thehackernews.com/2025/10/new-teefail-side-channel-attack.html) — TDX attestation forgery
- [WireTap (Oct 2025)](https://thehackernews.com/2025/10/new-wiretap-attack-extracts-intel-sgx.html) — SGX key extraction
- Meru's own [THREAT-MODEL.md](../THREAT-MODEL.md) and [E2E-ENCRYPTED-INFERENCE.md](./E2E-ENCRYPTED-INFERENCE.md)
