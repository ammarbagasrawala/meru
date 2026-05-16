import { aeadEncrypt, deriveCorpusKey, packBlob } from "../crypto/keys";
import { config, ogIntegrationReady } from "../config";
import { log } from "../middleware/error";

/**
 * Encrypt a customer document with AES-256-GCM (CSPRNG IV), upload the ciphertext
 * to 0G Storage, and return the root hash + 0G Chain tx hash.
 *
 * Until OG_STORAGE_INDEXER_URL + server credentials are wired up, this falls back
 * to a deterministic stub that returns a synthetic CID so the rest of the stack
 * (frontend, contracts, mirror) is testable end-to-end without 0G mainnet.
 */

const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);

export type UploadResult = {
  rootHash: `0x${string}`;
  storageTxHash: `0x${string}`;
  stub: boolean;
};

export async function encryptAndUpload(
  plaintext: Buffer,
  mime: string,
  corpusId: string
): Promise<UploadResult> {
  if (!ALLOWED_MIME.has(mime)) throw new Error("invalid_mime");
  if (plaintext.length === 0 || plaintext.length > MAX_DOC_BYTES) {
    throw new Error("invalid_size");
  }
  if (!config.ENCRYPTION_MASTER_KEY) {
    throw new Error("encryption_master_key_missing");
  }

  // Derive a per-corpus key from the env-loaded master via HKDF-SHA-256.
  const corpusKey = deriveCorpusKey(config.ENCRYPTION_MASTER_KEY, corpusId);
  const blob = packBlob(aeadEncrypt(corpusKey, plaintext));

  if (!ogIntegrationReady()) {
    // Stub path — used while waiting on 0G credentials. Produces a deterministic
    // hash from the ciphertext so the rest of the system has a consistent reference.
    const fakeRoot = `0x${blob
      .subarray(0, 32)
      .toString("hex")
      .padEnd(64, "0")}` as `0x${string}`;
    log.warn({ corpusId, ciphertextBytes: blob.length, fakeRoot }, "storage_stub_upload");
    return {
      rootHash: fakeRoot,
      storageTxHash: ("0x" + "11".repeat(32)) as `0x${string}`,
      stub: true,
    };
  }

  // Real path — wire up @0glabs/0g-ts-sdk here. Dynamic require so the rest of the
  // codebase compiles cleanly even before the SDK is installed and configured.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ZgFile, Indexer } = require("@0glabs/0g-ts-sdk");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { JsonRpcProvider, Wallet } = require("ethers"); // v6
  const provider = new JsonRpcProvider(config.OG_RPC_URL);
  const signer = new Wallet(
    config.SERVER_PRIVATE_KEY!.startsWith("0x")
      ? config.SERVER_PRIVATE_KEY!
      : `0x${config.SERVER_PRIVATE_KEY!}`,
    provider
  );

  const file = ZgFile.fromBuffer(blob);
  // Per the 04c gotcha — await merkleTree() before upload, or roots are wrong.
  await file.merkleTree();

  const indexer = new Indexer(config.OG_STORAGE_INDEXER_URL!);
  const [tx, err] = await indexer.upload(file, signer);
  if (err) {
    log.error({ err }, "storage_upload_failed");
    throw new Error("upload_failed");
  }
  return {
    rootHash: tx.rootHash as `0x${string}`,
    storageTxHash: tx.txHash as `0x${string}`,
    stub: false,
  };
}
