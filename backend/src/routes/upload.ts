import { Router } from "express";
import multer from "multer";
import { EventLog } from "ethers"; // v6
import { config, chainWritesReady } from "../config";
import { encryptAndUpload } from "../storage/encryptUpload";
import { extractCorpusText } from "../corpus/extractText";
import { setCorpusText } from "../corpus/textCache";
import {
  getAristotleProvider,
  getProvenantContract,
  getServerSigner,
} from "../chain/client";
import { asyncRoute, log } from "../middleware/error";
import { z } from "zod";

export const uploadRouter = Router();

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);

const UploadQuery = z
  .object({
    tokenId: z.coerce.bigint().positive().optional(),
    teeAttestationSigner: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
  })
  .strict();

/**
 * POST /api/upload
 *
 * Multipart body:
 *   file:  a PDF/JPG/PNG ≤ 5 MB
 *   tokenId (form field or query): existing corpus — appends a doc to it
 *   teeAttestationSigner (query/body): present only when minting (no tokenId given)
 */
uploadRouter.post(
  "/",
  upload.single("file"),
  asyncRoute(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "file_required" });
      return;
    }
    if (req.file.size === 0 || req.file.size > MAX_BYTES) {
      res.status(400).json({ error: "invalid_size" });
      return;
    }

    const parsedQuery = UploadQuery.safeParse({ ...req.query, ...req.body });
    if (!parsedQuery.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }

    // Magic-byte verification — never trust the multer-reported MIME alone.
    const detected = sniffMime(req.file.buffer);
    if (!detected || !ALLOWED_MIME.has(detected)) {
      res.status(400).json({ error: "invalid_mime" });
      return;
    }

    let tokenIdStr = parsedQuery.data.tokenId?.toString();
    const teeSigner = parsedQuery.data.teeAttestationSigner;

    // Encryption master key is the load-bearing config item for ANY upload
    // path (stub or real). Surface a friendly, actionable error to the
    // client rather than the generic 500 that asyncRoute would emit.
    if (!config.ENCRYPTION_MASTER_KEY) {
      log.warn("upload_blocked_no_master_key");
      res.status(503).json({
        error: "encryption_not_configured",
        detail:
          "Backend is missing ENCRYPTION_MASTER_KEY. Generate with `openssl rand -hex 32`, add to backend/.env, restart.",
      });
      return;
    }

    // Best-effort text extraction for prompt grounding. Failure here is
    // non-fatal — upload proceeds, the model just won't have doc context.
    const extractedText = await extractCorpusText(req.file.buffer, detected);

    // Stub flow when on-chain writes aren't wired — return synthetic ids so the UI works.
    if (!chainWritesReady() || !config.PROVENANT_CONTRACT_ADDRESS) {
      if (!tokenIdStr) tokenIdStr = String(Date.now());
      const out = await encryptAndUpload(req.file.buffer, detected, tokenIdStr);
      if (extractedText) setCorpusText(tokenIdStr, extractedText);
      res.json({
        tokenId: tokenIdStr,
        rootHash: out.rootHash,
        storageTxHash: out.storageTxHash,
        mintTxHash: "0x" + "44".repeat(32),
        stub: true,
      });
      return;
    }

    // ── Real path ──
    const provider = getAristotleProvider();
    const signer = getServerSigner(provider);
    const contract = getProvenantContract(signer);

    if (!tokenIdStr) {
      // Mint flow
      if (!teeSigner) {
        res.status(400).json({ error: "tee_attestation_signer_required" });
        return;
      }
      const out = await encryptAndUpload(
        req.file.buffer,
        detected,
        /* corpusId */ `pending-${Date.now()}`
      );
      const tx = await contract.mint(out.rootHash, teeSigner);
      const receipt = await tx.wait(1);

      // Extract tokenId from CorpusMinted event (ethers v6: logs includes EventLog)
      const event = receipt!.logs.find(
        (l): l is EventLog => l instanceof EventLog && l.fragment?.name === "CorpusMinted"
      );
      const newTokenId = event?.args?.[0]?.toString();

      if (newTokenId && extractedText) setCorpusText(newTokenId, extractedText);

      res.json({
        tokenId: newTokenId ?? "",
        rootHash: out.rootHash,
        storageTxHash: out.storageTxHash,
        mintTxHash: receipt!.hash,
        stub: false,
      });
      return;
    }

    // Append-to-existing-corpus flow — encrypt + upload only (no mint).
    const out = await encryptAndUpload(req.file.buffer, detected, tokenIdStr);
    if (extractedText) setCorpusText(tokenIdStr, extractedText);
    res.json({
      tokenId: tokenIdStr,
      rootHash: out.rootHash,
      storageTxHash: out.storageTxHash,
      stub: out.stub,
    });
  })
);

function sniffMime(buf: Buffer): string | null {
  // PDF: %PDF-
  if (
    buf.length >= 5 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  ) {
    return "application/pdf";
  }
  // JPEG: FFD8FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47
  if (
    buf.length >= 4 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  return null;
}
