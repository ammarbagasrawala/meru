import { Router } from "express";
import { AuditParams } from "../schemas/api";
import { config } from "../config";
import { getAristotleProvider, getProvenantContract } from "../chain/client";
import { asyncRoute, log } from "../middleware/error";

export const auditRouter = Router();

/**
 * GET /api/audit/:tokenId
 * Public, read-only audit log of inferences against a corpus.
 * No authentication — auditors / regulators should be pseudonymous.
 *
 * The "real" path needs only PROVENANT_CONTRACT_ADDRESS + a working OG RPC;
 * encryption keys / Sealed Inference URL / storage indexer are write-side
 * concerns and don't gate read-only audits.
 */
auditRouter.get(
  "/:tokenId",
  asyncRoute(async (req, res) => {
    const parsed = AuditParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const tokenId = parsed.data.tokenId;

    if (!config.PROVENANT_CONTRACT_ADDRESS) {
      // No contract configured — fall back to a deterministic demo entry so
      // the frontend table still renders during local development.
      res.json({
        tokenId: tokenId.toString(),
        mintedAt: Math.floor(Date.now() / 1000) - 86400,
        events: [0, 1, 2].map((i) => ({
          index: i,
          questionHash: `0x${(i + 1).toString().padStart(2, "0").repeat(32)}`,
          bundleHash: `0x${"aa".repeat(32)}`,
          timestamp: Math.floor(Date.now() / 1000) - 3600 * (3 - i),
        })),
        stub: true,
      });
      return;
    }

    const provider = getAristotleProvider();
    const contract = getProvenantContract(provider);

    // corpusOf reverts when the tokenId doesn't exist. Treat that as
    // "no audit log to show" instead of bubbling the chain error up to the
    // client (which would leak revert reasons + look like a server crash).
    let corpus: {
      rootBlobHash: string;
      teeAttestationSigner: string;
      issuedAt: bigint;
      lastInferenceAt: bigint;
    };
    let count: bigint;
    try {
      [count, corpus] = await Promise.all([
        contract.inferenceCountOf(tokenId),
        contract.corpusOf(tokenId),
      ]);
    } catch (err) {
      // Token not minted, or RPC error. Log internally; surface a clean empty
      // response to the client.
      log.warn(
        { tokenId: tokenId.toString(), reason: (err as Error)?.message?.slice(0, 80) },
        "audit_corpus_lookup_failed"
      );
      res.json({
        tokenId: tokenId.toString(),
        events: [],
        stub: false,
      });
      return;
    }

    const n = Number(count);
    const cap = Math.min(n, 100);
    const events = await Promise.all(
      Array.from({ length: cap }, (_, i) =>
        contract.inferenceAt(tokenId, i).then((e) => ({
          index: i,
          questionHash: e.questionHash,
          bundleHash: e.bundleHash,
          timestamp: Number(e.timestamp),
        }))
      )
    );

    res.json({
      tokenId: tokenId.toString(),
      rootBlobHash: corpus.rootBlobHash,
      teeAttestationSigner: corpus.teeAttestationSigner,
      mintedAt: Number(corpus.issuedAt),
      lastInferenceAt: Number(corpus.lastInferenceAt),
      events,
      stub: false,
    });
  })
);
