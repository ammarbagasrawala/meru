/**
 * Typed fetch helpers for the Provenant backend.
 * No secrets — only NEXT_PUBLIC_BACKEND_URL / NEXT_PUBLIC_INDEXER_URL.
 */
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8787";

export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "";

export function indexerConfigured(): boolean {
  return INDEXER_URL.length > 0;
}

export type ProvenanceBundle = {
  sourceChunkHashes: `0x${string}`[];
  modelId: string;
  enclaveTimestamp: number;
  bundleHash: `0x${string}`;
  questionHash: `0x${string}`;
  originTxHash: `0x${string}`;
  originChainId: number;
  teeAttestationSigner: `0x${string}` | null;
  mirror: { txHash: `0x${string}`; stub: boolean } | null;
};

export type MevEnvelope =
  | { mode: "off" }
  | {
      mode: "commit-reveal";
      commitHash: `0x${string}`;
      /** The Galileo tx hash of the on-chain commitInference call. Null if the
       *  request ran in stub mode (chainWritesReady === false). */
      commitTxHash: `0x${string}` | null;
      identityHex: `0x${string}`;
      epochId: number;
      chainId: number;
      verifyingContract: `0x${string}`;
      scaffold: boolean;
    };

export type QueryResponse = {
  answer: string;
  provenance: ProvenanceBundle;
  mev: MevEnvelope;
  stub: boolean;
};

export type UploadResponse = {
  tokenId: string;
  rootHash: `0x${string}`;
  storageTxHash: `0x${string}`;
  mintTxHash?: `0x${string}`;
  stub: boolean;
};

export type AuditResponse = {
  tokenId: string;
  rootBlobHash?: `0x${string}`;
  teeAttestationSigner?: `0x${string}`;
  mintedAt?: number;
  lastInferenceAt?: number;
  events: Array<{
    index: number;
    questionHash: `0x${string}`;
    bundleHash: `0x${string}`;
    timestamp: number;
  }>;
  stub: boolean;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: { error?: string } = {};
    try {
      detail = (await res.json()) as { error?: string };
    } catch {
      /* ignore */
    }
    throw new Error(detail.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

export async function uploadDocument(args: {
  file: File;
  tokenId?: string;
  teeAttestationSigner?: `0x${string}`;
}): Promise<UploadResponse> {
  const fd = new FormData();
  fd.append("file", args.file);
  if (args.tokenId) fd.append("tokenId", args.tokenId);
  if (args.teeAttestationSigner)
    fd.append("teeAttestationSigner", args.teeAttestationSigner);
  const res = await fetch(`${BACKEND_URL}/api/upload`, {
    method: "POST",
    body: fd,
  });
  return jsonOrThrow<UploadResponse>(res);
}

export async function postQuery(args: {
  tokenId: string;
  questionPlaintext?: string;
  encryptedQuery?: {
    ciphertextHex: `0x${string}`;
    ephemeralPublicKeyHex: `0x${string}`;
    ivHex: `0x${string}`;
  };
  mev?: "off" | "commit-reveal";
}): Promise<QueryResponse> {
  const res = await fetch(`${BACKEND_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return jsonOrThrow<QueryResponse>(res);
}

export async function fetchAudit(tokenId: string): Promise<AuditResponse> {
  const res = await fetch(`${BACKEND_URL}/api/audit/${encodeURIComponent(tokenId)}`);
  return jsonOrThrow<AuditResponse>(res);
}

export type IndexerInferenceRow = {
  tokenId: string;
  /** Position of the InferenceLogged event within its block. */
  logIndex: number;
  questionHash: `0x${string}`;
  bundleHash: `0x${string}`;
  /** Unix seconds at which the event was emitted on-chain. */
  eventTimestamp: number;
  /** Millis since epoch — when the indexer first saw the event. */
  indexedAt?: number;
  txHash: `0x${string}`;
  blockNumber: number;
};

/**
 * Fetch the same audit log via the @provenant/indexer JSON-RPC 2.0 endpoint.
 *
 * Why this matters: the indexer is the cross-chain fragmentation primitive — anyone
 * can run an instance, hit `POST /rpc` with `method: "provenant_getInferences"`, and
 * get a normalised view of 0G events without trusting our backend or running their
 * own 0G full node. The TEE-attested signature on each bundle is what keeps an
 * indexer honest: it can re-order or omit, but it cannot forge.
 *
 * Returns null if NEXT_PUBLIC_INDEXER_URL is not configured.
 */
export async function fetchAuditFromIndexer(
  tokenId: string
): Promise<IndexerInferenceRow[] | null> {
  if (!indexerConfigured()) return null;
  // Constant-time validation — tokenId must be digits only before going on the wire.
  if (!/^[0-9]+$/.test(tokenId)) {
    throw new Error("invalid_token_id");
  }
  const res = await fetch(`${INDEXER_URL}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "provenant_getInferences",
      params: [tokenId, 200],
    }),
  });
  if (!res.ok) throw new Error(`indexer_http_${res.status}`);
  const json = (await res.json()) as
    | { jsonrpc: "2.0"; id: number; result: IndexerInferenceRow[] }
    | { jsonrpc: "2.0"; id: number; error: { code: number; message: string } };
  if ("error" in json) throw new Error(`indexer_rpc_${json.error.code}`);
  return json.result;
}

export type IndexerStatus = {
  lastIndexedBlock: number | null;
  chainId: number;
  poll_ms: number;
};

export async function fetchIndexerStatus(): Promise<IndexerStatus | null> {
  if (!indexerConfigured()) return null;
  const res = await fetch(`${INDEXER_URL}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "provenant_status",
      params: [],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { result?: IndexerStatus };
  return json.result ?? null;
}
