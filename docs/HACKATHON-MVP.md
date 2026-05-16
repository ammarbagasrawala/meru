# Meru — Hackathon MVP

### What was actually shipped in 5 days, and where it goes next

**This document is the companion to [`PRODUCTION-VISION.md`](./PRODUCTION-VISION.md).** That doc describes the production-target system Meru is designed to *become*. This doc describes the deliberate 5-day slice of that system that was shipped for the 0G APAC Hackathon Track 5 submission — what's real, what's scaffold, and how the simple chat UI extends to the full agentic future.

The honest framing across both docs: **the hackathon MVP is a *wedge*, not the product.** The wedge proves the cryptographic chain works end-to-end against real 0G mainnet. The production vision shows what the wedge becomes when scaled, hardened, and composed.

---

## §1 — The 5-day mandate

**The constraint:** one solo builder, full-time job, ~30-35 productive hours over the submission window, $5-15 USD of mainnet OG tokens for gas.

**The mandate:** ship a working vertical slice that hits **all three 0G primitives** (Storage + Compute + Chain), covers **all three Track 5 sub-themes** credibly, deploys on **0G Aristotle mainnet** (not testnet), and survives a sceptical judge's 30-second sniff test.

**What we deliberately chose not to build** (per the master plan §2.3 + the production gap map):

- Multi-tenant RBAC / org scopes
- HSM / KMS / signer rotation lifecycle
- Browser-side document encryption (deferred to v2 per the threat model)
- Enclave-owned X25519 key handshake (the "true" E2E story, deferred to v2)
- Full ERC-7857 storage-layout inheritance (only the supportsInterface shim shipped)
- Real Shutter keyper integration (in-memory threshold scaffold instead)
- Multi-region indexer mesh
- Durable workflow orchestration (Temporal/Inngest)
- Reproducible builds / binary transparency
- Compliance evidence-export bundles

Each of these is explicitly named in [`THREAT-MODEL.md`](../THREAT-MODEL.md) and the [`Production Gap Map`](<see internal review notes — kept local>). The discipline is "ship the wedge cleanly; label every gap; ship nothing dishonest."

---

## §2 — What's actually real (the load-bearing artifacts)

### §2.1 — On-chain artifacts (verifiable in 30 seconds)

| Artifact | Where | Verification |
|---|---|---|
| `Provenant.sol` deployed | 0G Aristotle mainnet (chain 16661) | [`chainscan.0g.ai/address/0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5`](https://chainscan.0g.ai/address/0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5) — 7,378 bytes of verified bytecode |
| `ProvenantReader.sol` deployed | Sepolia (chain 11155111) | [`sepolia.etherscan.io/address/0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5`](https://sepolia.etherscan.io/address/0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5) |
| Real `CorpusMinted` events | 0G Aristotle | Multiple iNFT mints visible on chainscan |
| Real `InferenceLogged` events | 0G Aristotle | Real audit entries from end-to-end queries |
| Real `InferenceCommitted` + `InferenceRevealed` event pairs | 0G Aristotle | Two-tx commit-reveal cycle with 60-second on-chain enforced gap |
| Real Sepolia mirror txs | Sepolia | `mirror()` calls re-attesting the bundle hash on Ethereum |
| One-command mainnet smoke | `cd backend && npm run smoke` | 8/8 ✅ — verified live during submission window |

**The smoke is the killer.** Any judge runs one command and confirms all the above in under 5 seconds:

```bash
$ npm run smoke
RPC:       https://evmrpc.0g.ai
Contract:  0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5

✅  RPC reachable + chain id matches
    chainId=16661 (0G Aristotle mainnet)
✅  Contract has deployed bytecode
    7378 bytes of bytecode at 0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5
✅  Supports ERC-721 (0x80ac58cd)
✅  Advertises ERC-7857 iNFT compatibility (0x78570001 shim)
✅  ERC-721 name() + symbol() callable: name="Provenant", symbol="PVN"
✅  corpusOf(1) returns a real entry — rootBlobHash=0xb8179d7f…, signer=0x01E246e7…
✅  inferenceCountOf(1) returns a count: 4
✅  inferenceAt(1, 0) — bundleHash=0x52fa16d7…, ts=2026-05-14

🎉  All checks passed — Provenant.sol is live and answering.
```

### §2.2 — Real Sealed Inference (the cryptographic chain)

- **Broker SDK**: `@0gfoundation/0g-compute-ts-sdk@^0.8.3` (the canonical package; the older `@0glabs/0g-serving-broker` has stale defaults)
- **Live provider**: `0x25F8f01cA76060ea40895472b1b79f76613Ca497` — a Phala TEE chatbot at `dstack-pha-prod5.phala.network` running `openai/gpt-5.4-mini`
- **Round-trip latency**: ~24 seconds per query end-to-end through the TEE
- **Signature verification**: every response runs through `broker.inference.processResponse(...)` which verifies the provider's chat signature against the on-chain `teeSignerAddress`
- **Honest hard-fail**: when `processResponse` returns `null` (no verification handle from provider), the inference is **rejected** by default. `MERU_ALLOW_UNVERIFIED=1` opt-in required to accept unverifiable responses
- **Honest stub gate**: if the broker call fails for any reason and falls back to a deterministic stub, the response carries `stub: true` and **on-chain anchoring is skipped** — the real chain never gets polluted with placeholder data

End-to-end real-broker test ([`backend/scripts/test-real-inference.ts`](../backend/scripts/test-real-inference.ts)) shipped + passing.

### §2.3 — Real PDF text grounding

The MVP does *not* implement full RAG (chunk + embed + retrieve) — but the model is genuinely grounded against the uploaded document for the demo flow:

- `pdf-parse` extracts text at upload time
- Extracted text is cached encrypted-at-rest in `backend/data/corpus-text-cache.json.enc` (AES-256-GCM with HKDF-derived subkey of the master)
- At query time, the cached text is prepended to the system prompt so the model answers strictly from document content
- For a 2-line bank statement PDF this produces correct answers; for a 100-page contract this would need real RAG (v2)

This is the "minimum viable grounding" for an honest demo. Real retrieval-trace evidence (the "which exact chunks were used" proof) is v2 work — flagged explicitly in [`THREAT-MODEL.md`](../THREAT-MODEL.md).

### §2.4 — Standalone verifier

[`provenant/verifier/index.html`](../verifier/index.html) — a single static HTML file, ~600 lines of vanilla JS, **no SDK, no Meru backend in the loop.** Reads 0G Aristotle RPC + Sepolia RPC directly. Paste a `tokenId` + `bundleHash` and it verifies the audit entry against the live chains.

The "you don't have to trust us" moment. Survives even if every Meru server is offline.

### §2.5 — Permissionless indexer

Standalone Node.js package at [`provenant/indexer/`](../indexer/). Subscribes to `InferenceLogged` events on 0G Aristotle. Exposes:

- **JSON-RPC 2.0** — `provenant_getInferences`, `provenant_status`, `provenant_getInferenceByBundle`
- **WebSocket subscriptions** for live event streams
- **Multi-destination relayer** (off-by-default `indexerSignFallback` with `[KELPDAO-ANTIPATTERN]` warning)

Anyone can run a copy. The TEE signature on each bundle keeps every indexer honest.

### §2.6 — Encrypted-intents path (browser-to-backend bridge mode)

- Frontend X25519 → ECDH → HKDF-SHA-256 → AES-256-GCM encrypted intents
- Backend has the matching X25519 private key and decrypts the ciphertext before forwarding plaintext to the TEE
- **Honestly labelled as "bridge mode"** in the UI and README — the backend is inside the v1 trust boundary; v2 moves decryption into the enclave (see [`E2E-ENCRYPTED-INFERENCE.md`](./E2E-ENCRYPTED-INFERENCE.md))

### §2.7 — UI

- Next.js 16 + React 19 + Tailwind v4 + viem + wagmi v2
- Light-mode-only "AI notary" aesthetic — Apple/Stripe/Linear register, intentionally not "crypto-app"
- Mountain glyph as the brand mark (Mount Meru reference)
- Demo-mode banner explicitly disclosing the Level-1 TEE attestation signer placeholder
- Inverse-pyramid trust strip: status sentence + contract address chip, no marketing pills
- PipelineTracker that only ticks on real backend signals (the contract-enforced 60s commit-reveal window), never on fake setInterval cadence

### §2.8 — Code quality

- **15 Hardhat contract tests passing** (mint, log, commit, reveal, replay protection, signature verification, single-use commit, reveal-too-early refusal, etc.)
- **5 backend MEV tests passing**
- **Slither audit**: 49 informational, **0 high, 0 medium** against `Provenant.sol` and `ProvenantReader.sol`
- **Both projects typecheck clean** — backend (TS strict) and frontend (Next.js 16 strict mode)
- **No `console.log` in production paths**, no `Math.random`, no hand-rolled crypto, no hardcoded secrets

---

## §3 — What's deliberately scaffold (the labelled v2 gaps)

Per [`THREAT-MODEL.md`](../THREAT-MODEL.md) and the [`Production Gap Map`](<see internal review notes — kept local>):

| Scaffold | Why deferred | v2 plan |
|---|---|---|
| TEE attestation signer = deployer wallet (Level-1 placeholder) | Requires custom dStack app deployment (~16-24h focused work) | Enclave generates X25519 keypair at boot via dStack KMS; pubkey attested via DCAP quote |
| Encrypted intents terminate at the backend (bridge mode) | Requires enclave-owned key + DCAP browser verification | Move decryption inside the enclave; backend becomes transport relay |
| Document encryption is server-side | Requires browser-side key management UX + key persistence | Browser-side encryption with user wallet-derived keys |
| Commit-reveal threshold encryption is in-memory single-party | Real Shutter keyper integration (~8-12h) | Swap `deriveCallKey` / `awaitKeyForIdentity` to Shutter API (3-line change documented inline) |
| ERC-7857 shim only (not full inheritance) | Storage-layout refactor + redeploy risk | Inherit full iNFT pattern; consider soulbound variant for compliance |
| Single-process indexer, SQLite | Production needs Postgres + Redis + multi-region | Migrate when traffic justifies |
| No `RevokeEnclave` / `EnrollEnclave` contract events | Would need contract redeploy | Add as part of the v2 signer-governance work |
| `sourceChunkHashes` = corpus blob fingerprints, not per-chunk retrieval proofs | Real RAG requires retrieval-trace bookkeeping inside the enclave | When retrieval moves into the enclave, commit each chunk individually |
| 61-second synchronous HTTP wait on commit-reveal queries | Production needs durable workflow (Temporal/Inngest) | Async job model with status webhooks |
| No KMS / HSM separation for signer + gas + encryption keys | Single `.env` is dev-appropriate | AWS KMS / HashiCorp Vault in production |
| No multi-tenant RBAC | Single-team demo | Per-org scopes + audit role separation |

**This is roughly half of what the [`Production Gap Map`](<see internal review notes — kept local>) catalogs.** None of these are dishonest engineering — each is a platform-feature dependency or a roadmap item, named explicitly with a v2 plan.

---

## §4 — The extensibility narrative

### §4.1 — The chat UI is a wedge, not the product

Meru's frontend ships as a ChatGPT-style chat interface because:

1. **It's the lowest-cognitive-load demo for non-crypto judges.** A regulator who has never used a wallet can understand "upload a document, ask a question, see the receipt."
2. **It's the smallest UI surface that exercises every primitive end-to-end** — upload (Storage), question (Compute), answer (Chain anchor + Sepolia mirror).
3. **It's deliberately a single thread.** No multi-conversation memory. No agent loops. No tool calls.

This is the wedge. The same audit primitive underneath extends to dramatically richer surfaces.

### §4.2 — How the chat extends to agentic AI

The signed-bundle audit primitive in Meru is **agnostic to the AI interaction shape.** It can wrap:

```
Chat turn (today)           Agentic step (v2)              Full agent loop (v3)
─────────────────           ──────────────────              ───────────────────
question                    {tool_call, args}              {goal, plan, tools[],
  ↓                            ↓                            memory_state,
TEE inference               TEE inference                    n_steps_taken}
  ↓                            ↓                                ↓
answer                      tool_result                    composite trace
  ↓                            ↓                                ↓
signed bundle               signed bundle                  signed bundle per step
  ↓                            ↓                                ↓
on-chain anchor             on-chain anchor                Merkle-batched anchor
```

The signed-bundle format `(answer, sourceChunkHashes[], modelId, enclaveTimestamp, signature)` is generic — `answer` is just a string, `sourceChunkHashes[]` is just an array of commitments, `modelId` identifies the actor. Substitute:

- `answer` → `tool_invocation_result` for tool calls
- `sourceChunkHashes[]` → `tool_input_commitment, prior_state_commitment` for agent steps
- `modelId` → `agent_id : tool_name` for multi-tool agents

The audit substrate doesn't change. Only the surface that produces audit-worthy events.

### §4.3 — Concrete extensions (v2-v4 surface area)

**v2 — Tools and memory:**

- **Tool-augmented AI:** wrap any tool call (`fetch`, `database_query`, `payment_authorize`, `file_write`) with the Meru audit primitive. The tool input + output + tool identity get committed in the bundle. **Auditor sees: "the agent called `payment_authorize($10K to vendor X)` at timestamp T, signed by enclave E."**
- **Verifiable memory:** agent's memory state (vector DB rows, key facts, conversation history) is committed at every checkpoint to 0G Storage and anchored on 0G Chain. **Auditor sees: "the agent's understanding at step N was this exact memory snapshot, and step N+1 was based on it."**
- **MCP server integration:** [Model Context Protocol](https://modelcontextprotocol.io) servers can be wrapped so every MCP tool call emits a Meru receipt. The MCP transport layer becomes audit-instrumented by default.

**v3 — Multi-agent and multi-tenant:**

- **Multi-agent provenance:** an orchestrator agent dispatching to N specialist agents — each specialist's inference gets its own signed bundle; the orchestrator's "I chose specialist X for step Y because Z" decision gets its own bundle. **Auditor sees the full DAG of agent decisions.**
- **Per-tenant audit views:** enterprise deployments where each org's audit log is RBAC-scoped, but the underlying chain events are public. Tenants get private views; auditors get global views.
- **Cross-org audit:** when agent A from org X talks to agent B from org Y, both orgs see the relevant slice of the audit trail. The audit substrate is the inter-org trust layer.

**v4 — Protocol layer:**

- **AI Receipt Marketplace:** indexers earn per-query fees for serving audit data to auditors. Aligns indexer economics with auditor demand without re-centralizing the trust model.
- **Audit Substrate v1.0 spec** as a 0G ecosystem standard: any 0G app emitting AI-inference events uses the same wire format. Meru becomes the protocol; many apps become the surface.
- **Cross-substrate composability:** Meru receipts referenced by DePIN protocols (proof of physical-world action), agentic finance protocols (proof of strategy decision), identity protocols (proof of credential issuance). The audit primitive becomes a substrate for other substrates.

### §4.4 — Why the chat wedge is the right starting point

Three reasons judges should read the chat UI as a *deliberate scoping choice*, not a *limitation*:

1. **It's the surface where the audit primitive is most legible to a non-technical buyer.** A bank compliance officer evaluating Meru sees "upload, ask, receipt." If the demo led with multi-agent orchestration, the audit primitive would be invisible.
2. **It's the surface where the cryptographic chain is most testable.** One question → one bundle → one anchor → one mirror → one verifier check. Every layer is exercised in 30 seconds.
3. **It scales out, not up.** Going from chat to agentic is adding tool-call commitments and orchestrator step commitments — additive complexity, not architectural change. The contract doesn't change. The bundle format doesn't change. The verifier widget doesn't change. Only the producers of audit-worthy events expand.

This is the "wedge to product" sequence Apple PCC took (single chat UI → all of Siri → all of Apple Intelligence). Meru's sequence: chat → agentic AI → all of confidential AI on regulated data.

---

## §5 — The numbers

### §5.1 — What was built

| Metric | Count |
|---|---|
| 0G primitives load-bearing | 3 (Storage + Compute + Chain) |
| Mainnet contracts deployed | 2 (`Provenant.sol` on 0G, `ProvenantReader.sol` on Sepolia) |
| Real on-chain audit events | Multiple per corpus (verifiable on chainscan) |
| Hardhat contract tests | 15 passing |
| Backend MEV tests | 5 passing |
| Slither high/medium findings | 0 / 0 |
| Source files (Meru-authored, excluding `node_modules`) | ~50 across `backend/`, `frontend/`, `contracts/`, `indexer/`, `verifier/` |
| Research + reference docs | 35+ markdown files in `provenant/docs/` + parent dirs |
| Build time | 5 days, solo, alongside full-time job |
| Mainnet OG spent | ~4-5 OG total (deploy + ledger + sub-account + queries) |

### §5.2 — What's in the repo

```
provenant/
├── README.md                          # Inverse-pyramid, PCC-framed, trust-boundary-explicit
├── THREAT-MODEL.md                    # Named assumptions, TEE.fail/WireTap, what we don't claim
├── RUN.md                             # Single-page operations guide
├── TRACK-5-COVERAGE.md                # The 3-sub-theme coverage statement
├── contracts/
│   ├── Provenant.sol                  # ERC-721 + audit + commit-reveal + ERC-7857 shim
│   ├── ProvenantReader.sol            # Sepolia mirror with chain-bound digest
│   ├── SLITHER-AUDIT.md
│   └── test/                          # 15 Hardhat tests
├── backend/
│   ├── src/
│   │   ├── inference/seal.ts          # Real broker SDK integration with verification gate
│   │   ├── routes/{upload,query,audit}.ts
│   │   ├── crypto/{keys,decryptQuery}.ts
│   │   ├── corpus/{textCache,extractText}.ts
│   │   └── mev/shutter.ts             # Commit-reveal envelope + production-swap notes
│   └── scripts/
│       ├── mainnet-smoke.ts           # 8/8 ✅ — npm run smoke
│       ├── probe-inference.ts         # List 0G providers (read-only)
│       ├── fund-broker.ts             # Idempotent ledger setup
│       └── test-real-inference.ts     # End-to-end smoke
├── frontend/
│   ├── src/app/                       # Next.js routes (home, corpus, audit)
│   ├── src/components/                # PipelineTracker, DemoModeBanner, ProvenanceModal, etc.
│   └── public/verifier/index.html     # Mirror copy of the verifier widget
├── indexer/                           # Standalone JSON-RPC + WS indexer
├── verifier/index.html                # Standalone bundle verifier — no backend
├── docs/
│   ├── MERU-VS-PCC-VS-DSTACK.md       # The 5-PCC-requirement comparison
│   ├── E2E-ENCRYPTED-INFERENCE.md     # v2 enclave-handshake protocol
│   ├── INTEGRATING-0G-SEALED-INFERENCE.md  # Broker SDK integration recipe
│   ├── WHY-MERU.md                    # Naming rationale
│   ├── COMPLIANCE-VERIFICATION-FLOW.md
│   ├── WHAT-MERU-SOLVES.md
│   ├── PRODUCTION-VISION.md
│   └── HACKATHON-MVP.md
└── demo-assets/banking-statement.pdf
```

### §5.3 — Demo flow

The 2:30 demo video walks through, in order:

1. **0:00-0:15** — Persona pain (compliance officer + 97% IBM stat)
2. **0:15-0:35** — Upload PDF; show encryption + 0G Storage upload + mint tx on chainscan
3. **0:35-1:00** — Ask grounded question; real Sealed Inference answers with correct numbers from the doc
4. **1:00-1:30** — Show MEV commit-reveal cycle; two distinct on-chain transactions visible
5. **1:30-1:55** — Auditor view in another tab → **switch to standalone verifier widget** → paste bundle hash → ✓ verified **without touching Meru's backend**
6. **1:55-2:30** — Close on the "audit substrate" framing + PCC reference + v2 roadmap

The standalone-verifier moment at ~1:30 is the demo's punchline. That's the "you don't have to trust us" beat.

---

## §6 — Path from MVP to production

### §6.1 — What v2 (limited beta, Q3 2026) adds

Targets from [`PRODUCTION-VISION.md §8.1`](./PRODUCTION-VISION.md):

- Enclave-owned X25519 keypair via dStack KMS
- Real Shutter keyper integration (3-line swap-in already scaffolded)
- Browser-side document encryption
- Versioned corpus manifests on-chain
- Mainnet mirror to Base + Linea + Ethereum
- `RevokeEnclave` + `EnrollEnclave` events on the contract
- Per-chunk retrieval proofs inside the enclave

Effort estimate: **~6-8 weeks focused work** for one engineer; one platform-feature dependency (custom dStack app) that's well-scoped per [`E2E-ENCRYPTED-INFERENCE.md`](./E2E-ENCRYPTED-INFERENCE.md).

### §6.2 — What v3 (production, Q1 2027) adds

- HSM/KMS-backed key management
- Multi-attestation quorum (AMD SEV-SNP + Intel TDX)
- Reproducible-build pipeline + binary transparency
- Multi-tenant RBAC + org scopes
- Durable workflow orchestration (Temporal/Inngest)
- Compliance evidence-export bundles
- Multi-region indexer mesh with DR

Effort estimate: **~6 months with a 2-3 engineer team**, gated by enterprise design-partner conversations to lock requirements.

### §6.3 — The minimum viable path to first $1M ARR

Three customers × $250K-$350K ACV. Profile: regulated AI vendors who themselves sell into banks / healthcare. Phase plan:

1. **Q3 2026 — v2 limited beta** with 3 design partners (Indian fintech AI vendors aligned with DPDPA Nov 2026 deadline). Free during beta; conversion to paid at GA.
2. **Q4 2026 — v3 GA** with the design partners as case studies + cold-outbound to the Tier-1 buyer list documented in [`PRODUCTION-VISION.md §2.4`](./PRODUCTION-VISION.md). Target: 5 paying customers by end of Q4.
3. **Q1 2027 — protocol-tier launch** — Audit Substrate v1.0 spec published, partner with 0G ecosystem apps to adopt the wire format. Indexer-economics narrative for the protocol-fee thesis.

---

## §7 — Summary table — MVP vs. production

| Capability | MVP (v1, shipped) | Production (v3 target) |
|---|---|---|
| Trust boundary | Includes the backend | Backend = transport only; trust = TEE attestation + chain |
| Encryption | AES-256-GCM server-side + AES-GCM browser-side for intents (bridge mode) | Browser-side for both docs and queries; enclave-decrypts |
| Signer | Deployer wallet (Level-1 placeholder) | dStack-KMS-derived enclave key + on-chain enrolment events |
| Multi-attestation | Single TEE quote | Quorum of N independent vendor attestations |
| MEV gate | On-chain 60s window (real) + in-memory threshold (scaffold) | On-chain 60s gate + Shutter keyper integration |
| Cross-chain | Anchor (0G) + mirror (Sepolia) | Anchor (0G) + N mirrors (Base + Linea + Ethereum + …) |
| Audit retrieval | Backend `/api/audit` + permissionless indexer | Multi-region indexer mesh + Brevis ZK proofs of cross-chain consistency |
| RAG / retrieval proof | Whole-doc grounding via prompt-stuffing | Per-chunk commitments inside the enclave |
| Key management | `.env` master + per-corpus HKDF | HSM-backed per-corpus rotation + revocation |
| Workflow | Inline async/await; 61s synchronous wait | Durable jobs (Temporal/Inngest) with status webhooks |
| Tenancy | Single namespace | Multi-tenant RBAC with org scopes |
| Compliance export | None | Machine-readable evidence bundles + control inventory |
| ERC-7857 | `supportsInterface(0x78570001)` shim | Full inheritance + soulbound variant |
| Documentation | 35+ markdown files | Same + formal API spec + customer-facing playbooks |

---

## §8 — Why this MVP is the right scope for judging

Three reasons the 5-day slice is the right thing to evaluate:

1. **Every claim is verifiable.** Run `npm run smoke`. Open chainscan. Click the verifier widget. Read the threat model. No marketing claim survives in the docs that the code doesn't back up.

2. **Every gap is named.** [`THREAT-MODEL.md`](../THREAT-MODEL.md) catalogs what v1 doesn't claim. The [`Production Gap Map`](<see internal review notes — kept local>) catalogs what production-grade means. The "what we don't claim" list in the README is **as load-bearing** as the "what we do claim" list. Sharp judges respect this more than overclaim.

3. **The extension story is concrete.** Everything in [`PRODUCTION-VISION.md`](./PRODUCTION-VISION.md) §8 is a specific engineering plan with specific effort estimates and specific platform dependencies — not "we'll figure it out post-funding." The wedge → product path is mapped.

The combination — **a verifiable wedge + honest gaps + a credible roadmap** — is what makes the 5-day MVP a defensible submission and a fundable thesis.

---

## §9 — Cross-references

- Production target: [`PRODUCTION-VISION.md`](./PRODUCTION-VISION.md)
- Threat model: [`provenant/THREAT-MODEL.md`](../THREAT-MODEL.md)
- PCC comparison: [`provenant/docs/MERU-VS-PCC-VS-DSTACK.md`](./MERU-VS-PCC-VS-DSTACK.md)
- v2 E2E encryption plan: [`provenant/docs/E2E-ENCRYPTED-INFERENCE.md`](./E2E-ENCRYPTED-INFERENCE.md)
- 0G Sealed Inference integration: [`provenant/docs/INTEGRATING-0G-SEALED-INFERENCE.md`](./INTEGRATING-0G-SEALED-INFERENCE.md)
- Naming rationale: [`provenant/docs/WHY-MERU.md`](./WHY-MERU.md)
- (Internal review notes consolidated separately.)
- (Internal master plan consolidated separately.)

- One-page operations guide: [`provenant/RUN.md`](../RUN.md)

---

*Document version: 1.0 — 2026-05-16. Companion to [`PRODUCTION-VISION.md`](./PRODUCTION-VISION.md). Audience: judges, mentors, and anyone evaluating the wedge-to-product trajectory.*
