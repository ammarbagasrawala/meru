/**
 * Seed the corpus text cache from a local PDF file — used to recover demo
 * state when the cache was lost (backend restart before disk persistence
 * landed) and the user doesn't want to re-upload + re-mint.
 *
 *   cd backend && npx tsx scripts/seed-corpus-text.ts <tokenId> <pdfPath>
 *
 * Example:
 *   npx tsx scripts/seed-corpus-text.ts 4 ../demo-assets/banking-statement.pdf
 *
 * What it does:
 *   1. Reads the PDF from disk.
 *   2. Runs extractCorpusText() to get the same plaintext the upload route
 *      would have produced.
 *   3. Calls setCorpusText(tokenId, text) — which persists encrypted to
 *      ./data/corpus-text-cache.json.enc via the new disk-cache module.
 *   4. Verifies by reading back.
 *
 * Idempotent: re-seeding the same tokenId overwrites.
 */
import "dotenv/config";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { extractCorpusText } from "../src/corpus/extractText";
import { getCorpusText, setCorpusText } from "../src/corpus/textCache";

async function main(): Promise<void> {
  const [, , rawTokenId, rawPath] = process.argv;
  if (!rawTokenId || !rawPath) {
    console.error(
      "usage: tsx scripts/seed-corpus-text.ts <tokenId> <pdfPath>\n" +
        "e.g.:  tsx scripts/seed-corpus-text.ts 4 ../demo-assets/banking-statement.pdf"
    );
    process.exit(1);
  }
  if (!/^[0-9]+$/.test(rawTokenId)) {
    throw new Error("tokenId must be a positive integer");
  }
  const tokenId = rawTokenId;
  const pdfPath = resolve(rawPath);
  if (!existsSync(pdfPath)) {
    throw new Error(`pdf_not_found: ${pdfPath}`);
  }
  const stats = statSync(pdfPath);
  if (stats.size === 0 || stats.size > 5 * 1024 * 1024) {
    throw new Error(`pdf_size_invalid: ${stats.size} bytes (max 5 MB)`);
  }

  const buf = readFileSync(pdfPath);
  console.log(`pdf=${pdfPath} bytes=${buf.length}`);

  const text = await extractCorpusText(buf, "application/pdf");
  if (!text) {
    throw new Error("text_extract_failed_or_empty");
  }
  console.log(`extracted ${text.length} chars`);

  setCorpusText(tokenId, text);
  console.log(`seeded tokenId=${tokenId}`);

  const readBack = getCorpusText(tokenId);
  if (!readBack) {
    throw new Error("seed_verify_failed: read-back returned null");
  }
  // Don't print the doc contents — could be PII. Show shape only.
  console.log(`✅ verified: cache has ${readBack.length} chars for tokenId=${tokenId}`);
  console.log(`   persisted to ./data/corpus-text-cache.json.enc (encrypted at rest)`);
}

main().catch((err) => {
  console.error("seed failed:", (err as Error).message);
  process.exit(1);
});
