# Compliance Verification Flow

## Short version

A compliance officer does **not** use Meru to prove that the AI was magically right.

They use Meru to verify:
- what evidence the AI was allowed to use,
- where the run happened,
- what version of the governed materials were in force,
- and whether the audit trail was changed after the fact.

Meru verifies the **decision process**, not the model's soul.

---

## The core question

In a real organization, the important question is usually not:

> “Did the AI produce an answer?”

The important question is:

> “Can we defend how this AI-assisted decision happened?”

That is the compliance workflow Meru is aiming to support.

---

## What the flow looks like in production

## Step 1 — Open an approved corpus
A compliance officer opens a governed case workspace.

That workspace should already be tied to:
- the relevant customer or case file,
- the approved policy documents,
- the active policy version,
- the authorized users,
- and the retention / access policy.

Example corpus:
- customer file `884`
- AML policy `v12.3`
- escalation SOP `v4`

## Step 2 — Ask a question
The officer asks:

> “Does this customer require enhanced due diligence under the current policy?”

The question is sent into the confidential inference flow.

## Step 3 — Get an answer plus a receipt
Meru returns:
- the answer itself,
- and a verification receipt.

The answer is what the human reads.
The receipt is what compliance, audit, and security care about.

## Step 4 — Click `Verify`
This is the most important part.

The officer opens the verification view and sees a simple summary like:
- corpus used
- corpus version
- model used
- environment identity
- timestamp
- audit anchor
- verification status

In a stronger enterprise deployment, they could then expand the technical details if needed.

---

## What the officer is actually verifying

## 1. “Did it use the right documents?”
The officer checks:
- which corpus was bound to the run,
- which policy version was active,
- and ideally which exact documents or chunks were retrieved.

This answers:

> “Was the AI grounded in the approved evidence, or was it working off something else?”

## 2. “Did it run in the approved environment?”
The officer checks:
- the runtime / enclave identity,
- the attestation signer or approved environment id,
- whether that signer was valid at the time.

This answers:

> “Did this run in the secure environment our organization approved?”

## 3. “Was the receipt altered later?”
The officer checks:
- bundle hash,
- timestamp,
- chain anchor,
- mirror / independent audit surface,
- signature validity.

This answers:

> “Is this the original receipt, or did someone rewrite the story after the incident?”

## 4. “Can another party verify the same thing?”
The officer checks whether the same audit trail can be verified:
- from the internal system,
- from the public audit surface,
- or from an external verifier / indexer.

This answers:

> “Is this only true inside our dashboard, or can an auditor verify it independently?”

---

## Why this matters in depth

## 1. It makes decisions defensible
Without Meru, an organization often ends up saying:

> “The analyst used AI, and we think this is what happened.”

That is weak.

With Meru, the organization can say:

> “This decision relied on this corpus version, this policy state, this model/runtime, and this timestamped receipt.”

That is much more defensible.

## 2. It helps with disputes and appeals
Later, a customer, auditor, or regulator might ask:
- Why was the account frozen?
- Why was this transaction escalated?
- Why did this analyst reach that recommendation?

Meru should make it possible to reconstruct the decision lineage.

Again, the point is not “the AI was infallible.”
The point is “the organization can show the controlled process behind the decision.”

## 3. It helps isolate bad model or policy incidents
Suppose later you learn that:
- a model version was flawed,
- a policy bundle was outdated,
- a runtime was compromised,
- or retrieval pulled the wrong evidence set.

Without a strong receipt trail, the organization may have to re-review everything.

With Meru, it should be possible to isolate:
- which decisions used that model,
- which cases used that policy version,
- which outputs touched that environment,
- and which receipts need manual review.

That gives Meru real operational depth.

## 4. It changes user behavior
If analysts know that every AI-assisted decision leaves a verifiable trail, they are less likely to:
- use unapproved documents,
- rely on the wrong policy version,
- hide AI involvement in a sensitive workflow,
- or overstate what the system actually said.

So Meru is not only a verification system.
It is also a governance control.

---

## Concrete example: AML / sanctions review

A compliance analyst asks:

> “Should this account be escalated for enhanced due diligence?”

A strong Meru receipt should let the institution later show:
- which case file was in scope,
- which AML policy version applied,
- which model/runtime produced the recommendation,
- when the run happened,
- whether a human accepted or overrode it,
- and that the recorded trail was not modified later.

That is what turns AI from an informal assistant into a governed workflow tool.

---

## What Meru must record to be truly valuable

Meru becomes much more valuable when the receipt includes or links to:
- corpus version
- policy version
- model version
- runtime identity
- retrieval evidence
- human review action
- final business action
- immutable audit anchor

If Meru only proves:
- “an answer happened”

then it is shallow.

If Meru proves:
- “this governed evidence, approved environment, and recorded workflow produced this recommendation”

then it is deep.

---

## What Meru does not prove by itself

Meru does not automatically prove:
- that the answer was legally correct,
- that the policy itself was good,
- that the human made the best final decision,
- or that the model's reasoning was flawless.

It proves something different and still extremely important:

> **this AI-assisted decision came out of a traceable, reviewable, and tamper-evident process**

That is the compliance value.

---

## The best one-line explanation

> **A compliance officer uses Meru to verify that an AI-assisted decision has a trustworthy evidence trail, not just a chat response.**

---

## Related docs
- [`./WHAT-MERU-SOLVES.md`](./WHAT-MERU-SOLVES.md) — plain-English product explanation
- [`./E2E-ENCRYPTED-INFERENCE.md`](./E2E-ENCRYPTED-INFERENCE.md) — enclave-only confidentiality roadmap
- [`./PITCH-DECK.md`](./PITCH-DECK.md) — judge-facing narrative and Q&A framing
