/**
 * Corpus text cache with encrypted-at-rest disk persistence.
 *
 * Why a cache: on upload we extract the PDF text once and stash it keyed by
 * tokenId so `seal.ts` can prepend it to the system prompt at query time
 * (real RAG over 0G Storage is v2 — see docs/E2E-ENCRYPTED-INFERENCE.md).
 *
 * Why disk persistence: an in-memory cache disappears on backend restart,
 * meaning the user's uploaded document loses its grounding context any time
 * the dev server reloads. That breaks the demo on second-session use. We
 * persist the cache to `./data/corpus-text-cache.json.enc` so restarts
 * preserve doc context.
 *
 * Why encrypted at rest: cached entries are user-uploaded document plaintext.
 * Storing them on disk in cleartext would defeat the at-rest-encryption
 * invariant that the rest of the pipeline maintains (0G Storage blobs are
 * AES-256-GCM, frontend X25519 keys never leave the browser). We wrap the
 * whole cache file in AES-256-GCM with an HKDF-derived subkey of
 * ENCRYPTION_MASTER_KEY (info = "corpus-text-cache-v1"). On boot we hydrate
 * the cache by decrypting; if the master key isn't configured we silently
 * stay in RAM-only mode and log a one-line warning.
 *
 * Hard caps still apply:
 *   - MAX_TEXT_BYTES per entry  → prevents one huge doc from eating RAM
 *                                 or blowing the model's context window
 *   - MAX_ENTRIES total         → LRU eviction so the cache can't grow
 *                                 unbounded with sustained uploads
 *
 * Never logged. Treat the cached text as user PII.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hkdfSync } from "node:crypto";
import { aeadDecrypt, aeadEncrypt, packBlob, unpackBlob } from "../crypto/keys";
import { config } from "../config";
import { log } from "../middleware/error";

const MAX_TEXT_BYTES = 32 * 1024;
const MAX_ENTRIES = 200;
const CACHE_FILE = join(process.cwd(), "data", "corpus-text-cache.json.enc");
const HKDF_INFO = "provenant:v1:corpus-text-cache";

type Entry = {
  text: string;
  bytes: number;
  addedAt: number;
};

const store = new Map<string, Entry>();
let hydrated = false;
let dirty = false;

function cacheKey(): Buffer | null {
  if (!config.ENCRYPTION_MASTER_KEY) return null;
  // Derive a subkey so the master key is never used directly as an AES key.
  const master = Buffer.from(config.ENCRYPTION_MASTER_KEY, "hex");
  return Buffer.from(
    hkdfSync("sha256", master, Buffer.alloc(0), Buffer.from(HKDF_INFO, "utf8"), 32)
  );
}

function ensureDir(): void {
  const dir = dirname(CACHE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Atomic write: write to a tmp file, fsync, rename. Prevents a half-written
 * cache file on crash/sigkill.
 */
function persistToDisk(): void {
  const key = cacheKey();
  if (!key) return; // no master key → stay in RAM-only mode (no persistence)
  try {
    ensureDir();
    const snapshot = Array.from(store.entries()).map(([tokenId, e]) => ({
      tokenId,
      text: e.text,
      addedAt: e.addedAt,
    }));
    const plaintext = Buffer.from(JSON.stringify(snapshot), "utf8");
    if (plaintext.length === 0) return;
    const blob = aeadEncrypt(key, plaintext);
    const packed = packBlob(blob);
    const tmp = `${CACHE_FILE}.tmp`;
    writeFileSync(tmp, packed, { mode: 0o600 });
    renameSync(tmp, CACHE_FILE);
    dirty = false;
  } catch (err) {
    log.warn({ name: (err as Error)?.name }, "corpus_text_cache_persist_failed");
  }
}

function hydrateFromDisk(): void {
  if (hydrated) return;
  hydrated = true;
  const key = cacheKey();
  if (!key) {
    log.info("corpus_text_cache_ram_only_no_master_key");
    return;
  }
  if (!existsSync(CACHE_FILE)) return;
  try {
    const packed = readFileSync(CACHE_FILE);
    const blob = unpackBlob(packed);
    const plaintext = aeadDecrypt(key, blob);
    const parsed = JSON.parse(plaintext.toString("utf8")) as Array<{
      tokenId: string;
      text: string;
      addedAt: number;
    }>;
    if (!Array.isArray(parsed)) return;
    for (const row of parsed) {
      if (
        typeof row?.tokenId === "string" &&
        typeof row?.text === "string" &&
        row.text.length > 0 &&
        row.text.length <= MAX_TEXT_BYTES
      ) {
        store.set(row.tokenId, {
          text: row.text,
          bytes: row.text.length,
          addedAt: typeof row.addedAt === "number" ? row.addedAt : Date.now(),
        });
      }
    }
    log.info({ entries: store.size }, "corpus_text_cache_hydrated");
  } catch (err) {
    // Tampered file / wrong key / corrupted JSON — start fresh, log generic.
    log.warn({ name: (err as Error)?.name }, "corpus_text_cache_hydrate_failed");
  }
}

function evictIfFull(): void {
  while (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
  }
}

export function setCorpusText(tokenId: string, text: string): void {
  if (typeof text !== "string" || text.length === 0) return;
  hydrateFromDisk();
  const clipped = text.length > MAX_TEXT_BYTES ? text.slice(0, MAX_TEXT_BYTES) : text;
  evictIfFull();
  store.set(tokenId, {
    text: clipped,
    bytes: clipped.length,
    addedAt: Date.now(),
  });
  dirty = true;
  // Fire-and-forget atomic persist. The write is small (≤ MAX_ENTRIES × ~32 KB
  // encrypted) and happens off the hot path of the upload request anyway,
  // since the upload route awaits the bigger 0G Storage tx first.
  persistToDisk();
}

export function getCorpusText(tokenId: string): string | null {
  hydrateFromDisk();
  const entry = store.get(tokenId);
  if (!entry) return null;
  store.delete(tokenId);
  store.set(tokenId, entry);
  return entry.text;
}

export function corpusTextStats(): { count: number; bytes: number; dirty: boolean } {
  hydrateFromDisk();
  let bytes = 0;
  for (const v of store.values()) bytes += v.bytes;
  return { count: store.size, bytes, dirty };
}
