# Integrating 0G Sealed Inference — Meru's reference implementation

End-to-end recipe for wiring the **0G Compute Network's Sealed Inference** broker into a Node/TS backend, the way Meru does it. Every snippet below is shipped in this repo and survives a `npm run smoke` against 0G Aristotle mainnet.

> **Why this doc exists.** When we started, the canonical SDK package name was unclear (the popular `@0glabs/0g-serving-broker` ships stale defaults that point at undeployed contract addresses on mainnet). This doc captures the *working* path so the next 0G builder doesn't lose 4 hours rediscovering it.

---

## TL;DR

```ts
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { Wallet, JsonRpcProvider } from "ethers";

const wallet = new Wallet(SERVER_PRIVATE_KEY, new JsonRpcProvider("https://evmrpc.0g.ai"));
const broker = await createZGComputeNetworkBroker(wallet);

// One-time setup
await broker.ledger.addLedger(3.0);                                          // escrow 3 OG
await broker.ledger.transferFund(providerAddr, "inference", 1_000_000_000_000_000_000n); // 1 OG sub-account
await broker.inference.acknowledgeProviderSigner(providerAddr);              // bind to TEE signer

// Per request
const { endpoint, model } = await broker.inference.getServiceMetadata(providerAddr);
const headers = await broker.inference.getRequestHeaders(providerAddr, userQuestion);
const resp = await fetch(`${endpoint}/chat/completions`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ model, messages: [{ role: "user", content: userQuestion }] }),
});
const chatID = resp.headers.get("ZG-Res-Key");
const json = await resp.json();
const answer = json.choices[0].message.content;

// Verify the TEE chat signature against the on-chain teeSignerAddress.
// Returns true (verified), false (tampered — refuse), or null (no chatID).
const verified = await broker.inference.processResponse(
  providerAddr,
  chatID ?? json.id,
  JSON.stringify(json.usage ?? {})
);
if (verified === false) throw new Error("tee_signature_invalid");
```

Five lines of one-time setup. Six lines per request. Real TEE signature verification baked in.

---

## §1 — Pick the right SDK

**Use:**
```bash
npm install @0gfoundation/0g-compute-ts-sdk@^0.8.3 ethers@6
```

**Don't use:**
- `@0glabs/0g-serving-broker@2.0.0` — its default contract addresses (`0x0c0D02e4…`, `0x46e8a02d…`, `0x35A5d96…`) have **no deployed bytecode** on either Aristotle mainnet or Galileo testnet. The package's npm-latest tag (`0.7.8`) just re-exports from `@0gfoundation/0g-compute-ts-sdk`.

The canonical SDK auto-detects the network from the signer's provider and uses the right contract addresses. Verified mainnet (chain 16661) deployed addresses:

| Contract | Address | Bytecode size |
|---|---|---|
| Ledger | `0x2dE54c845Cd948B72D2e32e39586fe89607074E3` | 502 bytes |
| Inference | `0x47340d900bdFec2BD393c626E12ea0656F938d84` | 502 bytes |
| Fine-tuning | `0x4e3474095518883744ddf135b7E0A23301c7F9c0` | 508 bytes |

Useful sanity check before going further:

```ts
import { CONTRACT_ADDRESSES, getNetworkType } from "@0gfoundation/0g-compute-ts-sdk";
const net = await provider.getNetwork();
console.log(CONTRACT_ADDRESSES[getNetworkType(net.chainId)]);
```

---

## §2 — Discover providers (no funds required)

`listService()` returns every provider registered with the on-chain inference contract. Run this *before* funding anything — pick a provider you trust, then fund.

```ts
const services = await broker.inference.listService();
for (const [i, s] of services.entries()) {
  console.log(`[${i}] ${s.provider}`);
  console.log(`    serviceType=${s.serviceType}`);
  console.log(`    url=${s.url}`);
  console.log(`    model=${s.model}`);
  console.log(`    inputPrice=${s.inputPrice} outputPrice=${s.outputPrice}`);
}
```

In Meru, this is `backend/scripts/probe-inference.ts`. It's read-only — safe to run repeatedly.

**Providers we found on mainnet at submission time** (representative sample):

| Provider | TEE-attested host | Model | Output $/M token |
|---|---|---|---|
| `0x25F8f01c…Ca497` | `dstack-pha-prod5.phala.network` (Phala TEE) | `openai/gpt-5.4-mini` | 9,000 gwei |
| `0x4870CbC4…a4E9` | `compute-network-20.integratenetwork.work` | `0GM-1.0-35B-A3B` | 1,720 gwei |
| `0x1B3AAef3…85EB0` | `compute-network-4.integratenetwork.work` | `deepseek/deepseek-chat-v3-0324` | 2,736 gwei |
| `0xE29a72c7…F974` | text-to-image | `z-image` | 3,000,000 gwei |

Meru uses the Phala TEE chatbot — `dstack-pha-prod` is verifiably a Phala dStack deployment, which dovetails with the "TEE-attested inference" narrative.

---

## §3 — One-time setup (three steps, IN THIS ORDER)

If you skip step 2, step 3 fails with *"Sub-account not found"*. The three are sequential, not parallel.

### 3.1 Create the ledger (escrow OG)

```ts
await broker.ledger.addLedger(3.0); // units: OG (not neuron)
```

This deploys a `LedgerAccount` for your wallet and escrows 3 OG. The ledger is the operator's pool from which per-provider sub-accounts are funded. **Refundable** via `broker.ledger.refund(amount)`.

### 3.2 Open the per-provider sub-account

```ts
const SUBACCOUNT_OG = 1_000_000_000_000_000_000n; // 1 OG, in neuron
await broker.ledger.transferFund(providerAddr, "inference", SUBACCOUNT_OG);
```

The sub-account is what the provider's inference contract debits per request. Without this, `acknowledgeProviderSigner` throws.

Auto-funding: optional but useful for long-lived servers.
```ts
await broker.inference.startAutoFunding(providerAddr, { interval: 30_000, bufferMultiplier: 2 });
```

### 3.3 Acknowledge the provider's TEE signer

```ts
const already = await broker.inference.acknowledged(providerAddr);
if (!already) {
  await broker.inference.acknowledgeProviderSigner(providerAddr);
}
```

This writes an on-chain ack that you've reviewed the provider's TEE signer address — the binding is what `processResponse` later uses to verify chat signatures.

**Meru's reference script** for all three steps (idempotent): `backend/scripts/fund-broker.ts`.

---

## §4 — Per-request flow

```ts
async function runRealBroker(req: { questionPlaintext: string; corpusText?: string }) {
  // 1. Service metadata — endpoint + model. Cached client-side after first call.
  const { endpoint, model } = await broker.inference.getServiceMetadata(providerAddr);

  // Defence in depth: refuse plain-http endpoints regardless of registry source.
  if (!/^https:\/\//i.test(endpoint)) throw new Error("provider_endpoint_not_https");

  // 2. Compose the prompt. System prompt grounds the model in the corpus.
  const systemPrompt =
    "You are an audited assistant operating inside a 0G Sealed Inference TEE.\n\n" +
    (req.corpusText
      ? `Document content: ${req.corpusText}`
      : "Corpus content not available in this session; say so if asked.");

  // 3. Billing-proof headers. These are the settlement proof the provider
  //    submits on-chain to be paid. Signing your wallet over the request body
  //    binds payment to this specific message.
  const headers = await broker.inference.getRequestHeaders(providerAddr, req.questionPlaintext);

  // 4. POST to the provider — OpenAI chat-completions compatible.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let resp: Response;
  try {
    resp = await fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: req.questionPlaintext },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error("sealed_inference_unavailable");

  // 5. ZG-Res-Key is the chat session ID — the verifier uses it to retrieve
  //    the provider's per-chat signature for processResponse() below.
  const chatID = resp.headers.get("ZG-Res-Key");
  const json = (await resp.json()) as {
    id?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: Record<string, unknown>;
  };
  const answer = json.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || answer.length === 0) {
    throw new Error("sealed_inference_invalid_response");
  }

  // 6. Verify the provider's TEE chat signature.
  //    Returns: true → signature verifies. false → tampered. null → no chatID.
  const verified = await broker.inference.processResponse(
    providerAddr,
    chatID ?? json.id,
    JSON.stringify(json.usage ?? {})
  );
  if (verified === false) {
    throw new Error("sealed_inference_signature_invalid"); // refuse to record
  }
  if (verified === null) {
    // Provider didn't return ZG-Res-Key. Log loudly; decide policy.
  }

  return { answer, modelId: `0g:${model}`, verified: verified === true };
}
```

**Meru's reference implementation:** [`backend/src/inference/seal.ts`](../backend/src/inference/seal.ts) — adds a graceful fallback to a deterministic stub if the broker call fails, so the demo never hard-breaks mid-recording.

---

## §5 — How the TEE verification chain actually works

This is the part judges should understand. The integrity story is:

```
                  on-chain                                  inside the TEE
                ─────────────                              ────────────────
  provider's   ┌──────────────────┐                       ┌──────────────────┐
  inference  ◄─┤ teeSignerAddress │                       │  enclave boots,  │
  contract     │  (bound at       │                       │  derives keypair │
               │   registration)  │                       │  via dStack KMS  │
               └────────┬─────────┘                       └─────────┬────────┘
                        │                                           │
                        │   sig over chat content + chatID          │
                        │ ─────────────────────────────────────────►│
                        │                                           │ ◄── client
                        │                                           │     verifies
                        │   processResponse(provider, chatID, usage)│     here
                        ▼                                           │
            recoverSigner(sig) == teeSignerAddress  ────────────────┘
                       │
                       ▼
                  true / false
```

If `processResponse` returns `false`, **the chat signature does not recover to the address you ack'd on-chain**. Either the provider was compromised, the response was MITM'd, or the chatID was wrong. In all three cases the only correct action is to refuse to anchor the response.

Meru takes this further: if `verified === false`, we never call `commitInference`/`logInference` on Provenant.sol. The on-chain audit trail never records a forged inference.

---

## §6 — Pricing economics

Per call cost (Phala gpt-5.4-mini, late 2025 prices):
- Input: 1,600 gwei/token
- Output: 9,000 gwei/token
- Average answer ~500 output tokens → ~4,500,000 gwei = 0.0045 OG per Q

At ~$2 per OG, that's roughly **$0.009 per audited inference**. Cheaper providers (slot 9, `0GM-1.0-35B-A3B`) drop this to ~$0.002. Either is well below the cost a regulated buyer would pay for cryptographic provenance.

The 3 OG initial ledger funding supports ~600-1500 inferences depending on provider, before requiring a `depositFund`. For the hackathon demo, 4 OG total spend (3 ledger + 1 sub-account) supports the entire submission window.

---

## §7 — End-to-end smoke test

Meru ships three diagnostic scripts under `backend/scripts/`:

```bash
# 1. Read-only — list every registered provider on the network
npx tsx scripts/probe-inference.ts

# 2. One-time setup — addLedger + transferFund + acknowledgeProviderSigner
OG_INFERENCE_PROVIDER_ADDRESS=0x25F8f01c... npx tsx scripts/fund-broker.ts

# 3. End-to-end — one real query through the broker, verifies signature, prints answer
npx tsx scripts/test-real-inference.ts
```

When `test-real-inference.ts` prints `stub=false` and a coherent answer in ~25 seconds, the integration is verified live against mainnet.

---

## §8 — Reading list

- 0G Compute SDK GitHub: <https://github.com/0glabs/0g-serving-broker> (source); npm package: `@0gfoundation/0g-compute-ts-sdk`
- 0G developer docs: <https://docs.0g.ai/developer-hub/building-on-0g/compute/sdk>
- Phala dStack whitepaper: <https://phala.com/posts/dstack-whitepaper-a-zero-trust-framework-for-confidential-containers>
- Meru's own reference code:
  - [`backend/src/inference/seal.ts`](../backend/src/inference/seal.ts) — production path
  - [`backend/scripts/fund-broker.ts`](../backend/scripts/fund-broker.ts) — idempotent setup
  - [`backend/scripts/probe-inference.ts`](../backend/scripts/probe-inference.ts) — provider discovery
  - [`backend/scripts/test-real-inference.ts`](../backend/scripts/test-real-inference.ts) — end-to-end smoke

---

## §9 — Common gotchas

| Symptom | Cause | Fix |
|---|---|---|
| `broker init failed; no contract at 0x0c0D02e4…` | Used the wrong SDK package (`@0glabs/0g-serving-broker`) | Switch to `@0gfoundation/0g-compute-ts-sdk@^0.8.3` |
| `Sub-account not found` on `acknowledgeProviderSigner` | Skipped `transferFund` | Run step 3.2 before step 3.3 |
| `processResponse` returns `null` always | Provider doesn't set `ZG-Res-Key` response header | Fall back to `completion.id` (`chatID ?? json.id`) |
| `processResponse` returns `false` | Genuine signature failure — provider compromised or response tampered | Refuse to record. Don't call `logInference`. Investigate provider. |
| First call takes 60+ seconds | Cold-start on the TEE host | Warm with a throwaway call before the demo |
| HTTP 402 from provider | Sub-account drained | Re-run `transferFund` or enable `startAutoFunding` |
