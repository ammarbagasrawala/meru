/**
 * One-call smoke test for the real 0G Sealed Inference path.
 *
 *   cd backend && OG_INFERENCE_PROVIDER_ADDRESS=0x... npx tsx scripts/test-real-inference.ts
 *
 * Runs `runSealedInference` against the configured provider and prints the
 * answer + bundle hash + signature. No on-chain audit log is written — this is
 * purely an inference + signature-verification probe.
 */
import "dotenv/config";
import { keccak256, toUtf8Bytes } from "ethers";
import { runSealedInference } from "../src/inference/seal";
import { config, sealedInferenceReady } from "../src/config";

async function main(): Promise<void> {
  if (!sealedInferenceReady()) {
    console.error(
      "sealedInferenceReady() returned false — need SERVER_PRIVATE_KEY + OG_RPC_URL + OG_INFERENCE_PROVIDER_ADDRESS"
    );
    process.exit(1);
  }

  const question = "Explain in 2 sentences what a TEE-attested inference enclave guarantees and what it does NOT guarantee.";
  const questionHash = keccak256(toUtf8Bytes(question)) as `0x${string}`;
  // Pretend tokenId 1 with a fake corpus hash — we're not anchoring this on-chain,
  // just exercising the broker+provider path.
  const fakeCorpus = ("0x" + "ab".repeat(32)) as `0x${string}`;
  const fakeContract = (config.PROVENANT_CONTRACT_ADDRESS ??
    ("0x" + "00".repeat(20))) as `0x${string}`;

  console.log("Provider:        ", config.OG_INFERENCE_PROVIDER_ADDRESS);
  console.log("Chain ID:        ", config.OG_CHAIN_ID);
  console.log("Q:               ", question);
  console.log();
  console.log("→ Running real Sealed Inference...");
  const t0 = Date.now();
  const bundle = await runSealedInference({
    tokenId: 1n,
    contractAddress: fakeContract,
    rootBlobHash: fakeCorpus,
    questionHash,
    questionPlaintext: question,
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(2);

  console.log(`\n✅ ${dt}s   stub=${bundle.stub}`);
  console.log("answer:\n----\n" + bundle.answer + "\n----\n");
  console.log("modelId:         ", bundle.modelId);
  console.log("enclaveTimestamp:", bundle.enclaveTimestamp);
  console.log("bundleHash:      ", bundle.bundleHash);
  console.log("signature:       ", bundle.signature);
  console.log("sourceChunks:    ", bundle.sourceChunkHashes);

  if (bundle.stub) {
    console.error("\n❌ real path fell back to stub — see warn logs above");
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("test-real-inference failed:", (err as Error).message);
  process.exit(1);
});
