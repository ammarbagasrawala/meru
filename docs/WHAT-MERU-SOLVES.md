# What Meru Solves

## Short version

Meru is the **audit and provenance layer for confidential AI**.

It is not mainly trying to be:
- the smartest chatbot,
- the best model,
- or a generic AI app.

It is trying to solve a harder infrastructure problem:

> **If an organization uses AI on sensitive documents, how can it later prove what happened without asking anyone to “just trust us”?**

That is Meru's real job.

---

## In plain English

Imagine a bank, hospital, law firm, or government office using AI on private records.

The hard problem is not just:
- “Can AI answer the question?”

The hard problem is:
- Which documents did it use?
- Which policy version was in force?
- Where did the inference run?
- Was the environment approved?
- Was the audit trail edited later?
- Can an auditor verify the same thing independently?

Meru is the layer that tries to answer those questions.

A simple mental model:

1. Sensitive documents go into a sealed system.
2. AI runs in an approved confidential environment.
3. The result gets a receipt.
4. That receipt is anchored somewhere tamper-evident.
5. Later, a third party can check what happened.

So Meru is best understood as:
- a **receipt layer**,
- a **provenance layer**,
- and a **decision-lineage layer**

for AI that touches sensitive data.

---

## What problem exists today

Most organizations can show that an AI answer happened.

They usually cannot prove, later:
- what exact evidence it used,
- whether it ran in an approved secure environment,
- whether the logs were rewritten,
- whether the same answer can be verified outside the vendor dashboard,
- or which downstream business decision relied on it.

That creates a trust gap.

When audit, security, legal, or a regulator asks:

> “Show me why this AI-assisted decision was made.”

most teams end up with:
- screenshots,
- backend logs,
- vague memory,
- and “this should have been the policy version.”

That is weak.

Meru is trying to replace that with:
- cryptographic receipts,
- corpus binding,
- environment binding,
- timestamped audit anchoring,
- and independent verification.

---

## What Meru is really verifying

Meru is **not** proving that the model is always correct.

Meru is trying to prove the **process around the answer**.

The valuable checks are:
- what data the run was bound to,
- what model/runtime produced it,
- where it ran,
- when it ran,
- whether the receipt was altered later,
- and whether a third party can verify the same trail.

That is much more realistic and useful than pretending to prove the AI's inner reasoning.

---

## Why that matters in the real world

## 1. It makes AI use defensible
Without Meru, a team often ends up saying:

> “The AI recommended this, and we have internal logs somewhere.”

With Meru, they can say:

> “This recommendation was tied to this corpus, this environment, this timestamp, and this immutable receipt.”

That turns AI usage from an informal assistant into a governed decision-support process.

## 2. It helps with disputes and appeals
If a customer, internal audit team, or regulator asks:
- Why was this account frozen?
- Why was this case escalated?
- Why was this report flagged?

Meru helps reconstruct the decision lineage.

It does not guarantee the decision was morally or legally correct.
It helps prove the decision came from a controlled, reviewable process.

## 3. It helps contain incidents
If a model version, policy bundle, or runtime later turns out to be faulty, Meru should make it possible to isolate:
- which decisions used that model,
- which cases touched that environment,
- which corpus version was involved,
- and which outputs need re-review.

That is not just audit value.
That is **incident containment value**.

## 4. It reduces quiet rewriting of history
After something goes wrong, organizations often “remember” events differently.

Meru is valuable because it tries to lock key facts in time:
- what data was used,
- what environment ran it,
- what receipt existed then,
- and what the recorded state was at that moment.

---

## The productionized vision

In a fully productionized Meru flow:

1. Documents are encrypted in the browser before upload.
2. They are stored encrypted in `0G Storage`.
3. The question is encrypted directly to an attested enclave-owned key.
4. The enclave retrieves the approved corpus version, runs inference, and signs a receipt.
5. Meru anchors that receipt on `0G Chain`.
6. Meru mirrors or exposes the receipt in auditor-friendly form for independent verification.
7. Compliance, audit, and security teams can later verify the decision lineage.

At that point, Meru becomes something like:
- a black-box recorder for AI-assisted decisions,
- or a tamper-evident chain-of-custody layer for private AI.

---

## The best one-line explanation

> **Meru makes AI-assisted decisions auditable, challengeable, and defensible after the fact.**

---

## What Meru is not

Meru is not mainly solving:
- “make the best chat UI”
- “prove the answer is always correct”
- “eliminate all trust with pure cryptography”
- “be a general-purpose token bridge”

Meru is solving:
- private AI usage,
- with provenance,
- with tamper-evident receipts,
- in a way that regulated organizations can actually govern.

---

## Current repo vs target system

This document describes the product thesis and the productionized destination.

The current repo is a meaningful prototype of that idea, but it is not yet the full end-state. In particular, the production target assumes stronger properties than the current codebase implements today, such as:
- browser-side upload encryption,
- enclave-owned query decryption keys,
- stronger document-set versioning,
- and signer lifecycle controls.

Those are roadmap-hardening steps, not details to hand-wave away.

---

## Related docs
- [`./COMPLIANCE-VERIFICATION-FLOW.md`](./COMPLIANCE-VERIFICATION-FLOW.md) — what a compliance officer actually verifies
- [`./E2E-ENCRYPTED-INFERENCE.md`](./E2E-ENCRYPTED-INFERENCE.md) — what true enclave-only query confidentiality would require
- [`./WHY-MERU.md`](./WHY-MERU.md) — name and positioning rationale
