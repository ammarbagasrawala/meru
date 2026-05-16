# End-to-end Encrypted Inference — Architecture, Gap Analysis, and Roadmap

**Status:** Architectural design and gap analysis.
**Scope:** What it would take to make Provenant's encrypted-intents path truly end-to-end — plaintext never leaves the user's browser, only the inference enclave can decrypt.
**Audience:** Reviewers, mentors, future contributors, and the 0G platform team.

---

## TL;DR

What's running today in Provenant:

- X25519 → ECDH → HKDF-SHA-256 → AES-256-GCM encrypted intents from browser to backend.
- Chain-bound + protocol-tagged commit-reveal envelopes that the in-protocol contract enforces.
- Real Sealed Inference against an on-chain-registered Phala TEE provider via the 0G compute broker SDK.

The gap: the **receiving end** of the encrypted-intents wire is the **Provenant backend**, not the inference enclave. The backend can decrypt and therefore is part of the trust boundary. To eliminate the backend from the trust boundary, the inference provider has to publish an attested enclave-owned key — and the 0G compute broker does not currently expose that field.

This document explains the protocol that would close the gap, why every step is necessary, the specific upstream features that are missing, and a realistic implementation path.

---

## 1 — Threat model and goal

Goal: a user with a sensitive document (a customer's bank statement, a patient's chart, a draft legal contract) should be able to ask an AI a question about it and get an answer such that:

1. The plaintext question never appears on any wire, disk, or process memory outside the inference enclave.
2. The plaintext document, once decrypted for inference, never appears outside the inference enclave.
3. The trust boundary is "Intel/AMD/Phala silicon attestation + a specific binary measurement" — not "the operator who runs the backend."
4. There is still a public, on-chain audit trail of (a) what corpus the question was bound to, (b) the bundle hash of the answer, (c) the timestamp.

The audit-trail requirements are already met by the current Provenant contract. This document is about extending (1)–(3) from "browser to backend" to "browser to enclave."

---

## 2 — The handshake (what real E2E looks like)

```
┌─────────┐          ┌────────────┐         ┌──────────────────┐
│ Browser │          │  Backend   │         │  Phala enclave   │
│         │          │  (relay)   │         │  (inference TEE) │
└────┬────┘          └──────┬─────┘         └────────┬─────────┘
     │                      │                        │
     │   GET /tee-pubkey    │   GET /pubkey          │
     │ ────────────────────►│ ──────────────────────►│ ── generated inside enclave
     │                      │                        │    at boot, never leaves
     │                      │ ◄──────────────────────│
     │ ◄────────────────────│  { pubkey, dcap_quote }│
     │                                                │
     │ 1. Verify dcap_quote against Intel/AMD root    │
     │ 2. Check MRENCLAVE matches the expected build  │
     │ 3. Check report_data == sha256(pubkey)         │
     │    ← these three checks make the pubkey        │
     │      provably from this specific enclave       │
     │                                                │
     │ ephPriv, ephPub ← X25519 keypair (fresh)       │
     │ shared    ← X25519(ephPriv, enclavePub)        │
     │ aesKey    ← HKDF-SHA256(shared, "provenant-v1")│
     │ iv        ← CSPRNG(12)                         │
     │ ct        ← AES-256-GCM(aesKey, iv, question)  │
     │                                                │
     │  POST /sealed-inference                        │
     │   { ct, ephPub, iv, tokenId }                  │
     │ ─────────────────────►│ ─────────────────────► │
     │                       │                        │
     │                                                ▼
     │                                       inside the TEE only:
     │                                       shared   ← X25519(longPriv, ephPub)
     │                                       aesKey   ← HKDF-SHA256(shared, "provenant-v1")
     │                                       question ← AES-256-GCM⁻¹(aesKey, iv, ct)
     │                                       answer   ← model(question, corpus_context)
     │                                       resp_ct  ← AES-256-GCM(aesKey, iv2, answer)
     │                                       sig      ← TEEsigner.sign(hash(resp_ct))
     │                                                │
     │ ◄────────────────────│ ◄──────────────────────│
     │  { resp_ct, iv2, sig, chatID }                 │
     │                                                │
     │ answer ← AES-256-GCM⁻¹(aesKey, iv2, resp_ct)   │
     │ verify(sig, on-chain teeSignerAddress)         │
     │                                                │
```

The neat property: the backend sees only ciphertext both ways. It can refuse to relay (denial of service), but it cannot read.

---

## 3 — Why every step is necessary

### 3.1 Why the enclave generates the keypair *inside* the enclave

If the keypair were generated outside the enclave (e.g., by a deployment script that then provisions it into the enclave), the operator who ran the script would know the private key. That defeats the goal: the operator becomes part of the trust boundary again.

The fix: at boot, the enclave runs `crypto.randomBytes(32)` inside its address space and the private key never crosses the boundary. Phala dstack's KMS adds determinism — it derives the keypair from `HKDF(seal_key, MRENCLAVE || app_id)`, so a redeploy of the same binary produces the same key, but only inside an enclave with that exact MRENCLAVE.

### 3.2 Why attestation is required for the pubkey

Without attestation, the backend operator could MITM the handshake:

```
Browser GET /tee-pubkey
   │
   ▼
Backend intercepts → returns the backend's own pubkey
   │
   ▼
Browser encrypts to attacker's pubkey
   │
   ▼
Backend decrypts, reads plaintext, re-encrypts to the real enclave pubkey, forwards
```

The browser has no way to distinguish a real enclave-owned pubkey from a substitution. The whole protocol collapses.

The fix: the enclave commits to the pubkey by computing `report_data = sha256(pubkey)` and asking the hardware to produce a quote. The quote is signed by the Intel/AMD root key. The browser verifies:

1. The quote signature chains to Intel/AMD/Phala's root.
2. The MRENCLAVE inside the quote matches the expected binary hash (this is the "what code is running" check).
3. The `report_data` field inside the quote equals `sha256(received_pubkey)`.

If all three pass, the browser knows: "this pubkey was produced by *this specific binary* running inside *a genuine Intel/AMD enclave*." Substitution is now detectable.

### 3.3 Why HKDF and AES-GCM, not just X25519 → AES

`X25519(ephPriv, enclavePub)` produces a 32-byte shared secret that's *uniform but not domain-separated*. Using it directly as an AES key is brittle:

- If the same shared secret is reused across protocol versions, an attacker who breaks v1 can break v2.
- It's not bound to a context string, so a cross-protocol replay (e.g., using a Provenant session secret in a different X25519 context) might succeed.

HKDF-SHA-256 with `info = "provenant-v1"` fixes both:

- Cross-version reuse fails because v2 uses `info = "provenant-v2"`.
- The output is provably indistinguishable from random under a standard PRF assumption.

AES-256-GCM is the AEAD: it gives integrity and confidentiality in one primitive. Critically, the IV must be unique per (key, message). The browser uses `CSPRNG(12)`; the enclave uses a different IV (`iv2`) for the response.

### 3.4 Why the response is also encrypted

If the enclave returned plaintext, the backend would see the answer even if it never saw the question. For a user asking "based on this medical chart, should I be worried?" the answer is as sensitive as the question. The same AES-GCM key encrypts both directions; only the IV changes.

---

## 4 — What's blocking this today on 0G + Phala

The protocol above is straightforward. The blocker is that **Phala's dstack-pha-prod providers registered on the 0G compute network expose only the OpenAI-compatible `/v1/proxy/chat/completions` endpoint**.

Concretely:

| Required for E2E | Available today on 0G broker SDK |
|---|---|
| `GET /tee-pubkey` returning `{ pubkey, attestation_quote }` | ❌ Not exposed. Providers only expose OpenAI-compatible chat-completions. |
| `broker.inference.getServiceMetadata(provider)` returns an enclave pubkey | ❌ Returns `{ endpoint, model }` only. |
| `broker.inference.getRequestHeaders(provider, content)` accepts ciphertext | ⚠️ Signs a billing proof over `content`; encryption isn't part of the abstraction. |
| Phala dstack KMS-derived per-app X25519 keys | ✅ The runtime has them (Phala calls them "AppKeys"), bound to MRENCLAVE — but not surfaced through the OpenAI proxy. |
| On-chain `serviceType: "sealed-inference"` | ❌ Current service types are `chatbot`, `text-to-image`, etc. No service type expects an encrypted body. |
| Client-side DCAP attestation verification (browser) | ⚠️ Libraries exist (`@phala/dcap-qvl-web`), but no Provenant integration yet. |

The dstack runtime has the cryptographic primitives. The 0G broker has the billing and discovery primitives. The two haven't been bridged.

---

## 5 — Two implementation paths

### Path A — Custom dstack app, registered as a 0G provider

Deploy a small Node or Python service inside Phala dstack that exposes the E2E interface, then register it on the 0G compute network so the broker SDK can discover and bill it.

**dstack-side service (pseudocode):**

```ts
// At boot, inside the enclave
const longPriv = dstack.kms.deriveKey("provenant-v1");        // MRENCLAVE-bound
const longPub  = x25519.publicKey(longPriv);
const quote    = dstack.attestation.getQuote({
  report_data: sha256(longPub),                                // pubkey commitment
});

app.get("/tee-pubkey", (_, res) => {
  res.json({ pubkey: hex(longPub), attestation_quote: hex(quote) });
});

app.post("/sealed-inference", async (req, res) => {
  const { ct, ephPub, iv, tokenId } = req.body;
  const shared  = x25519.sharedSecret(longPriv, hex2bytes(ephPub));
  const aesKey  = hkdf("sha256", shared, "", "provenant-v1", 32);
  const question = aesGcmDecrypt(aesKey, iv, ct);

  // Run inference inside the same enclave (or proxy to a paired enclave
  // worker over an attested channel). The plaintext only exists in
  // enclave memory.
  const answer = await runModel(question);

  const iv2     = csprng(12);
  const resp_ct = aesGcmEncrypt(aesKey, iv2, answer);
  const sig     = teeSignerKey.sign(sha256(resp_ct));

  res.json({ resp_ct: hex(resp_ct), iv2: hex(iv2), sig: hex(sig) });
});
```

**0G registration:**

```ts
// Register as a provider. The 0G broker contract doesn't yet have an
// "enclavePubkey" field on the service, so we encode the pubkey + quote
// URL into the existing `model` or `url` field as a structured string,
// or proxy it through a sidecar endpoint.
broker.inference.registerService({
  serviceType: "sealed-inference-v1",      // new convention
  url: "https://<dstack-host>",
  model: "openai/gpt-5.4-mini",
  inputPrice: 1600_000_000_000n,
  outputPrice: 9000_000_000_000n,
});
```

**Provenant frontend changes:**

```ts
// Fetch + verify pubkey once per session, cached
const { pubkey, attestation_quote } = await fetch(`${providerUrl}/tee-pubkey`).then(r => r.json());

// Verify DCAP quote in the browser
const dcap = await import("@phala/dcap-qvl-web");
const verification = await dcap.verify(attestation_quote, {
  expectedMrEnclave: KNOWN_PROVENANT_DSTACK_MRENCLAVE,  // checked into Provenant repo
  expectedReportData: sha256(pubkey),
});
if (!verification.ok) throw new Error("attestation_failed");

// Encrypt + send
const ephPair  = nacl.box.keyPair();
const sharedKey = nacl.box.before(hex2bytes(pubkey), ephPair.secretKey);
// (HKDF + AES-GCM as in the diagram)
```

**Provenant backend changes:**

The backend becomes a thin relay. `seal.ts` does not need plaintext anymore; it forwards the ciphertext to the dstack provider, takes back the encrypted response, and gives it to the frontend untouched. The on-chain bundle hash is computed over the *ciphertext* (which is what the backend can see) — or, optionally, the frontend signs a separate plaintext-hash commitment that gets revealed only if the user wants public audit.

**Estimate (focused work, no debugging adventures):**

- dstack-side service + attestation glue: ~6 h
- 0G provider registration on mainnet + funding: ~3 h
- Frontend pubkey fetch + DCAP verify + encrypt/decrypt: ~3 h
- Backend relay route + audit-bundle handling over ciphertext: ~2 h
- E2E testing, MRENCLAVE pinning, error cases: ~2 h
- **Total: ~16 h focused, realistically 24 h with surprises.**

Doable as a post-hackathon weekend. Not realistic in the 36 hours before the submission deadline alongside the demo video.

### Path B — Push 0G upstream

The cleaner long-term answer is for 0G to standardise a `confidential-inference` service type in the broker contract with a first-class `enclavePubkey` + `attestationUri` field. Any provider opting in gets discoverable via the broker SDK, with a uniform encrypt-to-enclave flow. This is a 0G platform-feature ask, not a Provenant-side change.

What Provenant could contribute toward this:

- An RFC-style spec for the `sealed-inference-v1` service type — request/response shapes, attestation requirements, suggested HKDF context strings.
- A reference dstack implementation (Path A above).
- A reference client integration (Provenant's frontend).

Filing this as an issue against the 0G compute SDK repo with a working PoC attached would be a credible upstream contribution.

---

## 6 — Honest hackathon framing

Given that Path A isn't realistic before submission, the README should say exactly what is and isn't real today. Suggested copy:

> **Encrypted intents — what's real today:** X25519 → ECDH → HKDF-SHA-256 → AES-256-GCM encrypted intents wire from browser to backend, with chain-bound + protocol-tagged commitments. Browser-to-backend channel is end-to-end encrypted with a key the backend cannot derive without holding the corpus secret.
>
> **What's scaffolded:** The receiving end is the Provenant backend, not the inference enclave. To close the gap, the inference provider must publish an attested enclave pubkey — currently not exposed through the 0G compute broker. Path: deploy a custom dstack app that exposes `GET /tee-pubkey` (DCAP-attested) and `POST /sealed-inference` (ciphertext in / ciphertext out), register it as a `sealed-inference-v1` provider on 0G. The Provenant client already speaks the encryption protocol; only the receiver needs to switch.
>
> **Why this matters:** Without this, the trust boundary is "the backend operator." With it, the trust boundary is "Intel/AMD silicon attestation + Phala's attested binary measurement." That's the credible-neutrality property that lets a regulated bank run audited AI without trusting a vendor.

This is a stronger pitch than a half-working real version, because it shows the protocol is fully understood and points at the precise upstream feature gap.

---

## 7 — Open design questions for v2

- **Bundle hash over ciphertext or plaintext?** If the audit trail hashes ciphertext, an auditor needs the AES key to verify the answer matches. If it hashes plaintext, the backend needs to know the plaintext (defeating the goal) — unless the enclave is the one that publishes the hash. The cleaner answer: the enclave publishes both `H(ciphertext)` (verifiable by anyone) and a signed commitment `H(plaintext)` (verifiable by anyone who later sees the plaintext, e.g., during a regulator subpoena).
- **Corpus decryption inside the enclave.** The corpus is encrypted at rest on 0G Storage with an HKDF-derived key. To use it as inference context, either the user uploads the corpus key alongside the question, or the enclave fetches the corpus through the broker's authenticated channel and decrypts using a key derived from its own attestation. Either path is workable; the user-uploads-key path is simpler.
- **Multi-turn sessions.** A single shared AES key per session, or per-turn ephemeral keys? Per-turn is more conservative (forward secrecy) but adds latency. Per-session with periodic ratcheting is the usual middle ground.
- **Provider TEE-signer rotation.** If the enclave's TEE signer changes (binary upgrade), every previously-signed audit log entry should still verify under the old key. The on-chain `teeSignerAddress` should therefore be a record of (signer, valid-from, valid-until) tuples, not a single address.

---

## 8 — Glossary

- **TEE (Trusted Execution Environment):** hardware-isolated execution context (Intel SGX, Intel TDX, AMD SEV-SNP, ARM CCA). Code and data inside are inaccessible to the host OS, hypervisor, or root user.
- **MRENCLAVE / RTMR / measurement:** a hash of the binary loaded into the enclave. Different binaries → different measurements. Same binary → same measurement, deterministically.
- **Attestation quote:** a hardware-signed assertion of (MRENCLAVE, MRSIGNER, report_data, …). Verifiable against the chip vendor's root certificate without contacting the chip.
- **DCAP (Data Center Attestation Primitives):** Intel's data-center-friendly attestation flow. Phala uses a comparable flow for dstack.
- **dstack:** Phala Network's confidential-compute runtime. Provides KMS-derived per-app keys, attestation quotes, and a managed enclave deployment surface.
- **HKDF (Hash-based Key Derivation Function):** turns a uniform-but-arbitrary shared secret into a fixed-size key suitable for AEAD. `HKDF(salt, ikm, info, length)` — the `info` parameter is the domain separator.
- **AEAD (Authenticated Encryption with Associated Data):** an encryption mode that provides both confidentiality and integrity in a single primitive. AES-GCM and ChaCha20-Poly1305 are the standard choices.

---

*Document version: 1.0 — written during the 0G APAC Hackathon Track 5 submission window. The author is the Provenant team.*
