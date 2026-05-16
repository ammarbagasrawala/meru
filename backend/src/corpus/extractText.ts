/**
 * Best-effort text extraction from uploaded corpus files.
 *
 * Supported today:
 *   - application/pdf  → pdf-parse (pdfjs under the hood)
 *
 * Unsupported (returns null, no error):
 *   - image/jpeg, image/png → would need OCR; out of scope for v1
 *
 * Defensive: PDF parsing is a known attack surface (malformed PDFs can
 * crash the parser). We size-cap before parse and try/catch around it so
 * one bad upload can't crash the upload route.
 */
import { log } from "../middleware/error";

const MAX_PARSE_BYTES = 5 * 1024 * 1024; // align with encryptUpload MAX_DOC_BYTES

export async function extractCorpusText(
  buf: Buffer,
  mime: string
): Promise<string | null> {
  if (!buf || buf.length === 0) return null;
  if (buf.length > MAX_PARSE_BYTES) return null;
  if (mime !== "application/pdf") return null;

  try {
    // Dynamic require so the rest of the codebase still compiles + runs
    // if pdf-parse hasn't been installed yet.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse") as (b: Buffer) => Promise<{ text: string }>;
    const result = await pdfParse(buf);
    const text = (result?.text ?? "").trim();
    if (!text) return null;
    return text;
  } catch (err) {
    // Generic operator log; do not echo PDF contents or full stack.
    log.warn({ name: (err as Error)?.name }, "pdf_text_extract_failed");
    return null;
  }
}
