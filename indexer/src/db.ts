import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

/**
 * SQLite-backed event store. Append-only, indexed by tokenId + bundleHash.
 * Schema is intentionally narrow — this is an *audit-log mirror*, not an analytical warehouse.
 */

export type InferenceRow = {
  bundleHash: string;
  questionHash: string;
  tokenId: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  eventTimestamp: number; // contract-emitted timestamp (seconds)
  indexedAt: number;      // local indexer received time (ms)
};

export type CorpusRow = {
  tokenId: string;
  rootBlobHash: string;
  teeAttestationSigner: string;
  ownerAtMint: string;
  blockNumber: number;
  txHash: string;
  mintedAt: number;
  indexedAt: number;
};

function ensureDir(p: string): void {
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
}

ensureDir(config.INDEXER_DB_PATH);
const db = new Database(config.INDEXER_DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS inferences (
    bundleHash TEXT PRIMARY KEY,
    questionHash TEXT NOT NULL,
    tokenId TEXT NOT NULL,
    blockNumber INTEGER NOT NULL,
    txHash TEXT NOT NULL,
    logIndex INTEGER NOT NULL,
    eventTimestamp INTEGER NOT NULL,
    indexedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_inferences_token ON inferences(tokenId, blockNumber);
  CREATE INDEX IF NOT EXISTS idx_inferences_block ON inferences(blockNumber);

  CREATE TABLE IF NOT EXISTS corpora (
    tokenId TEXT PRIMARY KEY,
    rootBlobHash TEXT NOT NULL,
    teeAttestationSigner TEXT NOT NULL,
    ownerAtMint TEXT NOT NULL,
    blockNumber INTEGER NOT NULL,
    txHash TEXT NOT NULL,
    mintedAt INTEGER NOT NULL,
    indexedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cursor (
    name TEXT PRIMARY KEY,
    block_number INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mirror_attempts (
    bundleHash TEXT NOT NULL,
    destinationChainId INTEGER NOT NULL,
    txHash TEXT,
    status TEXT NOT NULL,  -- 'pending' | 'success' | 'failed'
    error TEXT,
    attemptedAt INTEGER NOT NULL,
    PRIMARY KEY (bundleHash, destinationChainId)
  );
`);

const upsertInference = db.prepare<InferenceRow>(`
  INSERT OR IGNORE INTO inferences
    (bundleHash, questionHash, tokenId, blockNumber, txHash, logIndex, eventTimestamp, indexedAt)
  VALUES (@bundleHash, @questionHash, @tokenId, @blockNumber, @txHash, @logIndex, @eventTimestamp, @indexedAt)
`);

const upsertCorpus = db.prepare<CorpusRow>(`
  INSERT OR IGNORE INTO corpora
    (tokenId, rootBlobHash, teeAttestationSigner, ownerAtMint, blockNumber, txHash, mintedAt, indexedAt)
  VALUES (@tokenId, @rootBlobHash, @teeAttestationSigner, @ownerAtMint, @blockNumber, @txHash, @mintedAt, @indexedAt)
`);

const getInferencesForToken = db.prepare<[string, number]>(`
  SELECT * FROM inferences WHERE tokenId = ? ORDER BY blockNumber ASC LIMIT ?
`);

const getInferenceByBundle = db.prepare<string>(`
  SELECT * FROM inferences WHERE bundleHash = ?
`);

const getCursor = db.prepare<string>(`
  SELECT block_number FROM cursor WHERE name = ?
`);

const setCursorStmt = db.prepare<[string, number]>(`
  INSERT INTO cursor(name, block_number) VALUES (?, ?)
  ON CONFLICT(name) DO UPDATE SET block_number = excluded.block_number
`);

const recordMirrorAttempt = db.prepare<{
  bundleHash: string;
  destinationChainId: number;
  txHash: string | null;
  status: "pending" | "success" | "failed";
  error: string | null;
  attemptedAt: number;
}>(`
  INSERT INTO mirror_attempts(bundleHash, destinationChainId, txHash, status, error, attemptedAt)
  VALUES (@bundleHash, @destinationChainId, @txHash, @status, @error, @attemptedAt)
  ON CONFLICT(bundleHash, destinationChainId) DO UPDATE SET
    txHash = excluded.txHash, status = excluded.status, error = excluded.error, attemptedAt = excluded.attemptedAt
`);

export const store = {
  saveInference(row: InferenceRow): void {
    upsertInference.run(row);
  },
  saveCorpus(row: CorpusRow): void {
    upsertCorpus.run(row);
  },
  listInferences(tokenId: string, limit = 200): InferenceRow[] {
    const rows = getInferencesForToken.all(tokenId, Math.min(limit, 1000));
    return rows as InferenceRow[];
  },
  findInferenceByBundle(bundleHash: string): InferenceRow | null {
    const row = getInferenceByBundle.get(bundleHash);
    return (row as InferenceRow | undefined) ?? null;
  },
  getCursor(name: string): number {
    const row = getCursor.get(name) as { block_number: number } | undefined;
    return row?.block_number ?? 0;
  },
  setCursor(name: string, blockNumber: number): void {
    setCursorStmt.run(name, blockNumber);
  },
  recordMirror(args: {
    bundleHash: string;
    destinationChainId: number;
    txHash: string | null;
    status: "pending" | "success" | "failed";
    error: string | null;
  }): void {
    recordMirrorAttempt.run({ ...args, attemptedAt: Date.now() });
  },
};
