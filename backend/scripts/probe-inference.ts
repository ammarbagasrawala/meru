/**
 * Probe whether 0G Sealed Inference (broker SDK) has any registered providers
 * on the configured network. Run with:
 *
 *   cd backend && tsx scripts/probe-inference.ts            # → uses OG_RPC_URL from .env
 *   cd backend && OG_RPC_URL=https://evmrpc-testnet.0g.ai tsx scripts/probe-inference.ts  # → forces Galileo
 *
 * What it does:
 *   1. Connects a JsonRpcProvider to the configured chain (Aristotle or Galileo).
 *   2. Spins up a Wallet from SERVER_PRIVATE_KEY (read-only operations — no funds spent).
 *   3. Initialises the 0G compute broker with the SDK's default contract addresses
 *      (those defaults are mainnet — if Galileo has different ledger/inference CAs,
 *      this probe will surface the "no contract at X" error early).
 *   4. Calls broker.inference.listService() and prints every registered provider.
 *
 * Read-only. Does NOT deposit any OG. Safe to run repeatedly.
 */
import "dotenv/config";
import { JsonRpcProvider, Wallet, isHexString } from "ethers";
import {
  createZGComputeNetworkBroker,
  CONTRACT_ADDRESSES,
  getNetworkType,
} from "@0gfoundation/0g-compute-ts-sdk";

const RPC_URL = process.env.OG_RPC_URL ?? "https://evmrpc.0g.ai";
const PK = process.env.SERVER_PRIVATE_KEY;

async function main(): Promise<void> {
  if (!PK || !/^(0x)?[0-9a-fA-F]{64}$/.test(PK)) {
    throw new Error(
      "SERVER_PRIVATE_KEY missing or malformed. Set it in backend/.env first."
    );
  }
  const pk = PK.startsWith("0x") ? PK : `0x${PK}`;
  if (!isHexString(pk, 32)) throw new Error("private key shape check failed");

  const provider = new JsonRpcProvider(RPC_URL);
  const net = await provider.getNetwork();
  console.log("RPC:               ", RPC_URL);
  console.log("Chain ID:          ", net.chainId.toString());
  console.log(
    "Chain name guess:  ",
    net.chainId === 16661n
      ? "0G Aristotle mainnet"
      : net.chainId === 16602n
      ? "0G Galileo testnet"
      : "(unknown)"
  );

  const wallet = new Wallet(pk, provider);
  const bal = await provider.getBalance(wallet.address);
  console.log("Wallet:            ", wallet.address);
  console.log("Balance:           ", (Number(bal) / 1e18).toFixed(6), "OG");
  const netType = getNetworkType(net.chainId);
  const addrs = (CONTRACT_ADDRESSES as Record<string, { ledger: string; inference: string; fineTuning: string }>)[netType];
  console.log("Network type:      ", netType);
  if (addrs) {
    console.log("  ledger:          ", addrs.ledger);
    console.log("  inference:       ", addrs.inference);
    console.log("  fineTuning:      ", addrs.fineTuning);
  }
  console.log();
  console.log("→ Initialising broker (auto-detects network)...");

  let broker;
  try {
    broker = await createZGComputeNetworkBroker(wallet);
  } catch (err) {
    console.error(
      "❌ Broker init failed. Most likely the default ledger/inference contract " +
        "addresses (0x0c0D02e4… / 0x46e8a02d…) don't exist on this chain.\n" +
        "→ This means Sealed Inference is mainnet-only via the SDK's defaults.\n" +
        "→ Galileo testnet needs explicit contract overrides — check docs.0g.ai or 0G Discord.\n"
    );
    console.error("Underlying error:", (err as Error).message);
    process.exit(1);
  }

  console.log("✅ Broker initialised.");
  console.log();
  console.log("→ Listing inference providers...");

  let services;
  try {
    services = await broker.inference.listService();
  } catch (err) {
    console.error("❌ listService() failed:", (err as Error).message);
    process.exit(1);
  }

  if (!services || services.length === 0) {
    console.log("⚠️  No providers registered on this network.");
    console.log(
      "   → If this is Galileo (16602): Sealed Inference is likely mainnet-only.\n" +
        "   → If this is Aristotle (16661): unexpected — providers should exist; check 0G status.\n"
    );
    process.exit(0);
  }

  console.log(`✅ ${services.length} provider(s) registered:\n`);
  for (const [i, s] of services.entries()) {
    console.log(`  [${i + 1}] provider=${s.provider}`);
    console.log(`      serviceType=${s.serviceType}`);
    console.log(`      url=${s.url}`);
    console.log(`      model=${s.model}`);
    console.log(`      inputPrice=${s.inputPrice} outputPrice=${s.outputPrice}`);
    console.log();
  }

  console.log("Next step: pick a provider, fund the broker (3+ OG), and wire seal.ts.");
}

main().catch((err) => {
  console.error("probe crashed:", err);
  process.exit(1);
});
