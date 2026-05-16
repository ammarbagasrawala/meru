import "dotenv/config";
import { z } from "zod";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_PK = /^(0x)?[0-9a-fA-F]{64}$/;

const Schema = z.object({
  PROVENANT_CHAIN_RPC: z.string().url().default("https://evmrpc.0g.ai"),
  PROVENANT_CHAIN_ID: z.coerce.number().int().default(16661),
  PROVENANT_CONTRACT_ADDRESS: z.string().regex(ADDRESS).optional(),

  INDEXER_PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  INDEXER_CORS_ORIGIN: z.string().default("*"),
  INDEXER_DB_PATH: z.string().default("./data/provenant-indexer.db"),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).max(300000).default(15000),
  INDEXER_BACKFILL_FROM_BLOCK: z.coerce.number().int().min(0).optional(),

  INDEXER_MIRROR_TARGETS: z.string().optional(),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

// Filter to schema-known keys AND treat empty strings as absent. A `.env` line
// like `INDEXER_BACKFILL_FROM_BLOCK=` (no value) shows up in process.env as `""`,
// which `z.coerce.number()` coerces to 0 — that then short-circuits `??` and
// makes the poller start from block 1 (catastrophic on chains with millions of
// blocks of history). Empty-string → undefined lets the schema's `.optional()`
// fall through to the dynamic default (latest - 1000).
const ours = Object.fromEntries(
  Object.entries(process.env).filter(([k, v]) => k in Schema.shape && v !== "")
);
const parsed = Schema.safeParse(ours);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("[indexer/config] invalid environment:",
    parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  process.exit(1);
}

export const config = parsed.data;

export type MirrorTarget = {
  chainId: number;
  rpcUrl: string;
  readerAddress: string;
  privateKey: string;
};

/**
 * Parse INDEXER_MIRROR_TARGETS — comma-separated `chainId:rpc:reader:pk` tuples.
 * Skips malformed entries with a warning rather than failing the whole indexer.
 */
export function parseMirrorTargets(): MirrorTarget[] {
  const raw = config.INDEXER_MIRROR_TARGETS?.trim();
  if (!raw) return [];
  const out: MirrorTarget[] = [];
  for (const tuple of raw.split(",")) {
    const parts = tuple.split(":");
    if (parts.length < 4) continue;
    const chainId = Number(parts[0]);
    // rpc URL may contain ":" — reassemble everything between [0] and last-2 as the URL
    const rpcUrl = parts.slice(1, parts.length - 2).join(":");
    const readerAddress = parts[parts.length - 2]!;
    const privateKey = parts[parts.length - 1]!;
    if (
      !Number.isFinite(chainId) ||
      chainId <= 0 ||
      !rpcUrl ||
      !ADDRESS.test(readerAddress) ||
      !HEX_PK.test(privateKey)
    ) {
      // eslint-disable-next-line no-console
      console.warn("[indexer/config] skipping malformed INDEXER_MIRROR_TARGETS tuple");
      continue;
    }
    out.push({ chainId, rpcUrl, readerAddress, privateKey });
  }
  return out;
}
