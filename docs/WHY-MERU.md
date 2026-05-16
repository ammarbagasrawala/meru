# Why the project is named Meru

**Renamed from "Provenant" on 2026-05-15** during the final hackathon submission window. The on-chain artifacts, npm package namespaces, and wire-format strings remain under the prior working name; the product name and all user-facing surfaces are now "Meru."

---

## Overview

The project name **Meru** was chosen to represent the idea of a **central trust anchor for confidential AI systems.**

Meru is inspired by *Mount Meru*, a cosmological concept shared across multiple Asian traditions where it represents:

- the center of structure,
- permanence,
- order,
- and the axis around which systems are organized.

This symbolism aligns directly with the project's core thesis:

> AI systems handling sensitive data should produce verifiable, immutable proofs that independent parties can trust.

Meru is positioned as:

- a trust layer,
- a provenance layer,
- and an audit substrate for confidential AI.

---

## Why the name fits the product

### 1. Meru represents a stable center

The platform's role is not to "be the AI."

Its role is to:

- anchor truth,
- preserve auditability,
- and make AI execution independently verifiable.

Just as Mount Meru symbolizes a fixed center in cosmology, Meru acts as the:

- cryptographic center,
- provenance anchor,
- and immutable reference point

for AI inference activity.

### 2. The name feels infrastructure-grade

The product is fundamentally:

- protocol-like,
- trust-oriented,
- and infrastructure-heavy.

"Meru" sounds:

- foundational,
- durable,
- and system-level —

which is more aligned with:

- sovereign infrastructure,
- cryptographic verification,
- and blockchain-based provenance

than a conventional SaaS-style AI name.

### 3. APAC-relevant without being region-locked

The hackathon is APAC-focused, so the name needed:

- subtle Asian resonance,
- global pronounceability,
- and low cultural friction.

Meru works well because:

- it is recognizable in South and East Asian contexts,
- but still sounds modern and internationally usable.

It avoids:

- overtly local branding,
- heavy religious signaling,
- and generic crypto naming clichés.

### 4. Trust and permanence are core emotional signals

The product promise is:

> "These AI receipts cannot be forged, edited, or silently rewritten."

The name therefore needed to communicate:

- permanence,
- calmness,
- credibility,
- and long-term trust.

"Meru" has a grounded and stable sound that reinforces this positioning subconsciously.

### 5. The name scales beyond the hackathon

The name is extensible enough to support:

- protocol expansion,
- open-source infrastructure,
- enterprise tooling,
- and future modules.

Examples:

- Meru Verify
- Meru Receipts
- Meru SDK
- Meru Attest
- Meru Indexer

This gives the project room to evolve without requiring a rebrand.

---

## Pronunciation

> **MEH-roo**

Two syllables:

- "Meh"
- "roo"

Simple to pronounce globally and easy for judges, users, and developers to remember.

---

## Final positioning

### Name

**Meru**

### Meaning

> A stable centre of truth and verification.

### Product interpretation

> Meru is the trust layer for confidential AI — generating cryptographic receipts proving how AI handled private data.

---

## What still says "Provenant"

These are intentional and non-blocking — they are stable contracts that v2 will migrate carefully:

| Surface | Why it stays |
|---|---|
| Smart contract `Provenant.sol` deployed at `0xA8296DfF…30C5` on 0G Aristotle mainnet | Renaming requires redeploying to a new address; the deployed contract is the eligibility-critical submission artifact. |
| ABI function names (`mintCorpus`, `logInference`, `commitInference`, `revealAndLogInference`) and event names (`CorpusMinted`, `InferenceLogged`, `InferenceCommitted`) | Baked into deployed bytecode; renaming forces redeploy + clients to switch ABI. |
| npm package namespaces — `@provenant/backend`, `@provenant/frontend`, `@provenant/indexer` | Imports across the monorepo; safe to migrate in v2 with a coordinated bump. |
| JSON-RPC method namespace — `provenant_getInferences`, `provenant_status` | Public indexer API contract. Other indexers and dashboards may already be hitting these. v2 can add `meru_*` aliases. |
| HKDF context string — `"provenant:v1:query-key"` in encrypted-intents | If renamed without backend coordination, frontend ciphertext won't decrypt. Coordinate the rename atomically in v2. |
| sessionStorage / localStorage keys — `provenant:corpora:v1`, `provenant:last-upload:*` | Browser-local; renaming silently invalidates the user's local corpus list. v2 includes a one-time migration script. |
| Custom DOM event — `provenant:corpora-changed` | Cross-component signal; rename when v2 ships. |

## What now says "Meru"

- Page title and meta description
- Sidebar wordmark + Mountain glyph (replacing the "P" letter avatar)
- All H1 / H2 headlines on home, corpus chat, and audit pages
- The chat assistant avatar — Mountain glyph in a sage circle
- Error messages, aria-labels, and user-facing copy that referenced the product
- This README and all front-of-house documentation
