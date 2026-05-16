#!/usr/bin/env node
/**
 * Backfill-mirror — one-shot script that re-attests an existing on-chain
 * Provenant inference to the Sepolia ProvenantReader so `isMirrored()` flips
 * to `true`. Use when the live query flow never mirrored a given bundle
 * (e.g. backend `.env` was missing `SEPOLIA_RPC_URL` at the time the query
 * ran), and you just need ONE mirrored bundle for the demo verifier.
 *
 * Usage:
 *   node scripts/backfill-mirror.mjs                # defaults: tokenId=12, index=0
 *   node scripts/backfill-mirror.mjs 12 0           # explicit tokenId + inference index
 *
 * Env vars (read from backend/.env or process env):
 *   SERVER_PRIVATE_KEY        — REQUIRED. Must equal the Reader's bound teeAttestationSigner.
 *   SEPOLIA_RPC_URL           — optional. Defaults to publicnode.
 *   PROVENANT_READER_ADDRESS  — optional. Defaults to the deployed Sepolia address.
 *   ZG_RPC_URL                — optional. Defaults to https://evmrpc.0g.ai.
 *   PROVENANT_ADDRESS         — optional. Defaults to the deployed 0G address.
 *
 * Security notes (per the secure-coding-enforcer policy):
 *   - SERVER_PRIVATE_KEY is loaded from env only; never echoed or logged.
 *   - The 0G→Sepolia mirror digest is domain-separated by chainId + reader address.
 *   - All chain RPC calls use TLS-verified HTTPS endpoints; ethers v6 verifies TLS.
 *   - The script aborts loudly if the signer wallet address doesn't match the Reader's
 *     bound teeAttestationSigner (would otherwise produce a wasted-gas revert on submit).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  JsonRpcProvider,
  Wallet,
  Interface,
  AbiCoder,
  keccak256,
  getBytes,
  id as ethersId,
  Contract,
} from "ethers";

// ── Constants ─────────────────────────────────────────────────────────────

const DEFAULTS = {
  ZG_RPC_URL: "https://evmrpc.0g.ai",
  SEPOLIA_RPC_URL: "https://ethereum-sepolia-rpc.publicnode.com",
  PROVENANT_ADDRESS: "0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5",
  PROVENANT_READER_ADDRESS: "0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5",
};
const ZG_CHAIN_ID = 16661;
const SEPOLIA_CHAIN_ID = 11155111;

// ── Tiny .env loader (avoids dotenv dep) ──────────────────────────────────

function loadDotEnv(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes (single or double).
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(__dirname, "..", ".env"));

// ── Config + validation ──────────────────────────────────────────────────

const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY ?? "";
if (!/^0x[0-9a-fA-F]{64}$/.test(SERVER_PRIVATE_KEY)) {
  console.error("✗ SERVER_PRIVATE_KEY is missing or malformed in backend/.env");
  console.error("  Set it to a 0x-prefixed 32-byte hex private key.");
  process.exit(1);
}

const ZG_RPC_URL = process.env.ZG_RPC_URL || DEFAULTS.ZG_RPC_URL;
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || DEFAULTS.SEPOLIA_RPC_URL;
const PROVENANT_ADDRESS = process.env.PROVENANT_ADDRESS || DEFAULTS.PROVENANT_ADDRESS;
const PROVENANT_READER_ADDRESS =
  process.env.PROVENANT_READER_ADDRESS || DEFAULTS.PROVENANT_READER_ADDRESS;

const [argTokenId = "12", argIndex = "0"] = process.argv.slice(2);
let tokenId, index;
try {
  tokenId = BigInt(argTokenId);
  index = BigInt(argIndex);
  if (tokenId < 0n || index < 0n) throw new Error("must be non-negative");
} catch (err) {
  console.error("✗ tokenId / index must be non-negative integers — got:", argTokenId, argIndex);
  process.exit(1);
}

// ── ABI fragments (minimal — only what we call) ──────────────────────────

const PROVENANT_ABI = [
  "function inferenceCountOf(uint256 tokenId) view returns (uint256)",
  "function inferenceAt(uint256 tokenId, uint256 index) view returns (tuple(bytes32 questionHash, bytes32 bundleHash, uint64 timestamp))",
  "function corpusOf(uint256 tokenId) view returns (tuple(bytes32 rootBlobHash, address teeAttestationSigner))",
  "event InferenceLogged(uint256 indexed tokenId, bytes32 indexed bundleHash, bytes32 questionHash, uint64 timestamp)",
];
const READER_ABI = [
  "function teeAttestationSigner() view returns (address)",
  "function isMirrored(bytes32 bundleHash) view returns (bool)",
  "function mirror(bytes32 bundleHash, bytes32 originTxHash, uint256 originChainId, uint64 enclaveTimestamp, bytes teeSignature) external",
  "error AlreadyMirrored()",
  "error InvalidInput()",
  "error InvalidSignature()",
];

// ── Helpers ──────────────────────────────────────────────────────────────

function signMirrorDigest(wallet, args) {
  // Must match ProvenantReader.sol's digest exactly:
  //   keccak256(abi.encode(bundleHash, originTxHash, originChainId, enclaveTimestamp, block.chainid, address(this)))
  // wrapped in the EIP-191 ethSignedMessageHash prefix (MessageHashUtils.toEthSignedMessageHash).
  const inner = AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes32", "uint256", "uint64", "uint256", "address"],
    [
      args.bundleHash,
      args.originTxHash,
      args.originChainId,
      args.enclaveTimestamp,
      SEPOLIA_CHAIN_ID,
      args.readerAddress,
    ],
  );
  const digest = keccak256(inner);
  // `signMessage(getBytes(digest))` produces the ethSignedMessageHash form expected by
  // OpenZeppelin's MessageHashUtils.toEthSignedMessageHash on the Reader.
  return wallet.signMessage(getBytes(digest));
}

async function findOriginTxHash(provider, tokenId, bundleHash) {
  // Filter past `InferenceLogged` logs by tokenId + bundleHash. Both are indexed,
  // so this is an O(1) topic match — we don't need to iterate.
  const eventSig = ethersId(
    "InferenceLogged(uint256,bytes32,bytes32,uint64)",
  );
  const topics = [
    eventSig,
    "0x" + tokenId.toString(16).padStart(64, "0"),
    bundleHash,
  ];
  // 0G's RPC enforces a max block range per `eth_getLogs`. Walk back in chunks.
  const latest = await provider.getBlockNumber();
  const CHUNK = 9000; // safe under most public-RPC limits
  for (let to = latest; to > 0; to -= CHUNK) {
    const from = Math.max(0, to - CHUNK + 1);
    let logs;
    try {
      logs = await provider.getLogs({
        address: PROVENANT_ADDRESS,
        topics,
        fromBlock: from,
        toBlock: to,
      });
    } catch (err) {
      // Some 0G RPCs are pickier — fall back to a smaller chunk.
      to = Math.min(to, from + 4500 - 1);
      continue;
    }
    if (logs && logs.length > 0) {
      return logs[0].transactionHash;
    }
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("Meru · backfill-mirror");
  console.log("  tokenId =", tokenId.toString(), "· index =", index.toString());
  console.log("  0G      =", ZG_RPC_URL);
  console.log("  Sepolia =", SEPOLIA_RPC_URL);
  console.log("  Reader  =", PROVENANT_READER_ADDRESS);
  console.log();

  const ogProvider = new JsonRpcProvider(ZG_RPC_URL);
  const sepProvider = new JsonRpcProvider(SEPOLIA_RPC_URL);
  const wallet = new Wallet(SERVER_PRIVATE_KEY, sepProvider);

  const provenant = new Contract(PROVENANT_ADDRESS, PROVENANT_ABI, ogProvider);
  const reader = new Contract(PROVENANT_READER_ADDRESS, READER_ABI, wallet);

  // 1. Confirm signer matches Reader's bound teeAttestationSigner.
  let boundSigner;
  try {
    boundSigner = await reader.teeAttestationSigner();
  } catch (err) {
    console.error("✗ Could not read teeAttestationSigner() on Sepolia. RPC or address wrong?");
    console.error("  ", err.shortMessage || err.message);
    process.exit(2);
  }
  if (boundSigner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error("✗ Signer mismatch.");
    console.error("  Reader expects:", boundSigner);
    console.error("  Your wallet is:", wallet.address);
    console.error("  Set SERVER_PRIVATE_KEY to the key whose address matches the Reader.");
    process.exit(3);
  }
  console.log("✓ Signer ok — your wallet matches Reader.teeAttestationSigner");

  // 2. Read the inference from 0G.
  const count = await provenant.inferenceCountOf(tokenId);
  if (BigInt(count) <= index) {
    console.error(`✗ tokenId=${tokenId} has ${count} inferences; index ${index} is out of range.`);
    process.exit(4);
  }
  const inf = await provenant.inferenceAt(tokenId, index);
  const bundleHash = inf.bundleHash;
  const questionHash = inf.questionHash;
  const enclaveTimestamp = Number(inf.timestamp);
  console.log("✓ Read inference:");
  console.log("    bundleHash      =", bundleHash);
  console.log("    questionHash    =", questionHash);
  console.log("    enclaveTimestamp=", enclaveTimestamp, "(" + new Date(enclaveTimestamp * 1000).toISOString() + ")");

  // 3. Check if already mirrored — short-circuit if so.
  const already = await reader.isMirrored(bundleHash);
  if (already) {
    console.log("✓ Already mirrored. Nothing to do.");
    console.log();
    console.log("=== USE THESE IN THE VERIFIER ===");
    console.log("Token ID:    " + tokenId);
    console.log("Bundle hash:", bundleHash);
    console.log("===");
    return;
  }

  // 4. Find the originTxHash by querying past InferenceLogged events on 0G.
  console.log("· Searching 0G for the InferenceLogged tx hash…");
  const originTxHash = await findOriginTxHash(ogProvider, tokenId, bundleHash);
  if (!originTxHash) {
    console.error("✗ Could not find the InferenceLogged event on 0G. Check tokenId / RPC.");
    process.exit(5);
  }
  console.log("✓ originTxHash =", originTxHash);

  // 5. Sign the mirror digest.
  const teeSignature = await signMirrorDigest(wallet, {
    bundleHash,
    originTxHash,
    originChainId: ZG_CHAIN_ID,
    enclaveTimestamp,
    readerAddress: PROVENANT_READER_ADDRESS,
  });

  // 6. Confirm signer has Sepolia ETH for gas.
  const balance = await sepProvider.getBalance(wallet.address);
  if (balance === 0n) {
    console.error("✗ Signer", wallet.address, "has 0 Sepolia ETH — can't pay gas.");
    console.error("  Get some from a Sepolia faucet, then re-run:");
    console.error("    https://www.alchemy.com/faucets/ethereum-sepolia");
    console.error("    https://cloud.google.com/application/web3/faucet/ethereum/sepolia");
    process.exit(6);
  }
  console.log("✓ Sepolia balance:", balance.toString(), "wei");

  // 7. Submit the mirror transaction.
  console.log("· Submitting mirror() on Sepolia…");
  const tx = await reader.mirror(
    bundleHash,
    originTxHash,
    ZG_CHAIN_ID,
    enclaveTimestamp,
    teeSignature,
  );
  console.log("  tx submitted:", tx.hash);
  const receipt = await tx.wait(1);
  console.log("✓ Mirrored at block", receipt.blockNumber, "· gas used", receipt.gasUsed.toString());

  // 8. Verify state on Sepolia.
  const mirroredNow = await reader.isMirrored(bundleHash);
  if (!mirroredNow) {
    console.error("✗ Post-tx check: isMirrored is still false. Receipt:", receipt);
    process.exit(7);
  }
  console.log("✓ isMirrored(bundleHash) = true on Sepolia");
  console.log();
  console.log("=== USE THESE IN THE VERIFIER ===");
  console.log("Token ID:    " + tokenId);
  console.log("Bundle hash:", bundleHash);
  console.log("===");
}

main().catch((err) => {
  console.error("✗ Unexpected error:");
  console.error("  ", err.shortMessage || err.message || String(err));
  if (err.data) console.error("  data:", err.data);
  process.exit(99);
});
