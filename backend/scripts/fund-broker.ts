/**
 * One-time setup for real 0G Sealed Inference.
 *
 *   cd backend && npx tsx scripts/fund-broker.ts
 *
 * What it does (in order, idempotent):
 *   1. Loads SERVER_PRIVATE_KEY + OG_RPC_URL + OG_INFERENCE_PROVIDER_ADDRESS from .env.
 *   2. Initialises the broker against the auto-detected network (Aristotle 16661
 *      or Galileo 16602).
 *   3. Checks whether a ledger already exists for the server wallet.
 *      - If yes: prints the current balance and skips `addLedger`.
 *      - If no:  calls `addLedger(LEDGER_INITIAL_OG)` — costs LEDGER_INITIAL_OG
 *                from the server wallet (escrowed; can be refunded via `refund`).
 *   4. Acknowledges the provider's TEE signer (no-op if already acknowledged).
 *   5. Confirms `getServiceMetadata(provider)` resolves a real endpoint.
 *
 * Safe to re-run. Never logs the private key.
 */
import "dotenv/config";
import { JsonRpcProvider, Wallet, isHexString } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

const LEDGER_INITIAL_OG = 3.0;

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} missing — set it in backend/.env`);
  return v;
}

async function main(): Promise<void> {
  const rpcUrl = process.env.OG_RPC_URL ?? "https://evmrpc.0g.ai";
  const rawPk = requireEnv("SERVER_PRIVATE_KEY");
  const providerAddr = requireEnv("OG_INFERENCE_PROVIDER_ADDRESS");

  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(rawPk)) {
    throw new Error("SERVER_PRIVATE_KEY malformed");
  }
  const pk = rawPk.startsWith("0x") ? rawPk : `0x${rawPk}`;
  if (!isHexString(pk, 32)) throw new Error("private key shape check failed");
  if (!/^0x[0-9a-fA-F]{40}$/.test(providerAddr)) {
    throw new Error("OG_INFERENCE_PROVIDER_ADDRESS malformed");
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const net = await provider.getNetwork();
  const wallet = new Wallet(pk, provider);
  const bal = await provider.getBalance(wallet.address);
  // Never log the private key itself; address + balance only.
  console.log("RPC:           ", rpcUrl);
  console.log("Chain ID:      ", net.chainId.toString());
  console.log("Wallet:        ", wallet.address);
  console.log("Balance:       ", (Number(bal) / 1e18).toFixed(6), "OG");
  console.log("Provider:      ", providerAddr);
  console.log();

  console.log("→ Initialising broker...");
  const broker = await createZGComputeNetworkBroker(wallet);
  console.log("✅ broker ready");

  // ── Step 1: ledger ───────────────────────────────────────────────
  console.log("\n→ Checking ledger state...");
  let ledgerExists = false;
  try {
    const ledger = await broker.ledger.getLedger();
    ledgerExists = true;
    const totalOg = Number(ledger.totalBalance) / 1e18;
    const availOg = Number(ledger.totalBalance - (ledger.locked ?? 0n)) / 1e18;
    console.log(
      `✅ ledger exists: totalBalance=${totalOg.toFixed(6)} OG, available=${availOg.toFixed(6)} OG`
    );
  } catch (err) {
    // "Ledger not found" is the expected first-run case. Don't surface raw
    // SDK error strings to the operator — log a generic note + classify.
    const msg = String((err as Error)?.message ?? "");
    if (/not exist|not found|no ledger/i.test(msg)) {
      console.log("ℹ️  no ledger yet — will create one");
    } else {
      console.error("❌ unexpected getLedger error:", msg);
      process.exit(1);
    }
  }

  if (!ledgerExists) {
    console.log(`→ Creating ledger with ${LEDGER_INITIAL_OG} OG...`);
    if (Number(bal) / 1e18 < LEDGER_INITIAL_OG + 0.05) {
      throw new Error(
        `insufficient_balance — need ≥${LEDGER_INITIAL_OG + 0.05} OG to fund ledger + gas`
      );
    }
    await broker.ledger.addLedger(LEDGER_INITIAL_OG);
    console.log("✅ ledger created + funded");
  }

  // ── Step 2a: initialise the per-provider sub-account ─────────────
  // The provider sub-account is what the contract debits per inference call;
  // it must exist before TEE-signer acknowledgement. transferFund creates it
  // if missing and moves `amount` neuron (wei) from the ledger into it.
  console.log("\n→ Checking provider sub-account...");
  const SUBACCOUNT_INITIAL_NEURON = 1_000_000_000_000_000_000n; // 1 OG
  try {
    const acct = await broker.inference.getAccount(providerAddr);
    const balOg = Number(acct.balance) / 1e18;
    console.log(`✅ sub-account exists: balance=${balOg.toFixed(6)} OG`);
  } catch (err) {
    const msg = String((err as Error)?.message ?? "");
    if (/not found|not exist|sub-account/i.test(msg)) {
      console.log("→ creating provider sub-account with 1 OG...");
      await broker.ledger.transferFund(
        providerAddr,
        "inference",
        SUBACCOUNT_INITIAL_NEURON
      );
      console.log("✅ sub-account funded");
    } else {
      console.error("❌ unexpected getAccount error:", msg);
      process.exit(1);
    }
  }

  // ── Step 2b: acknowledge the provider's TEE signer ───────────────
  console.log("\n→ Checking provider TEE-signer acknowledgement...");
  try {
    const already = await broker.inference.acknowledged(providerAddr);
    if (already) {
      console.log("✅ already acknowledged");
    } else {
      console.log("→ acknowledging provider TEE signer...");
      await broker.inference.acknowledgeProviderSigner(providerAddr);
      console.log("✅ acknowledged");
    }
  } catch (err) {
    const msg = String((err as Error)?.message ?? "");
    console.error("❌ acknowledge failed:", msg);
    process.exit(1);
  }

  // ── Step 3: verify provider is reachable ─────────────────────────
  console.log("\n→ Resolving provider service metadata...");
  const meta = await broker.inference.getServiceMetadata(providerAddr);
  console.log("✅ provider live");
  console.log("    endpoint:  ", meta.endpoint);
  console.log("    model:     ", meta.model);

  console.log("\n🎉 Setup complete. Restart the backend; seal.ts will now use the real broker path.");
}

main().catch((err) => {
  // Generic operator-facing error; never echo raw stacks (may contain pk-adjacent state).
  console.error("fund-broker failed:", (err as Error).message);
  process.exit(1);
});
