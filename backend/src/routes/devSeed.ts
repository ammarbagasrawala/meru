import { Router } from "express";
import { z } from "zod";
import { setCorpusText } from "../corpus/textCache";
import { asyncRoute } from "../middleware/error";

/**
 * Dev-only: seed corpus text into the cache without re-uploading.
 *
 * Used to recover demo state when the in-memory cache was lost (backend
 * restart before disk persistence landed) and re-uploading would require
 * minting a fresh corpus iNFT — burning gas + churning the tokenId space.
 *
 * Hard-gated to localhost on the request side AND
 * NODE_ENV !== "production" on the server side. Refuses to mount in prod.
 */
export const devSeedRouter = Router();

const Body = z
  .object({
    tokenId: z.string().regex(/^[0-9]+$/).max(20),
    text: z.string().min(1).max(64 * 1024),
  })
  .strict();

devSeedRouter.post(
  "/seed-corpus-text",
  asyncRoute(async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      res.status(404).json({ error: "not_found" });
      return;
    }
    // Localhost-only — defence in depth.
    const ip = (req.ip ?? "").replace(/^::ffff:/, "");
    if (ip !== "127.0.0.1" && ip !== "::1" && ip !== "localhost") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    setCorpusText(parsed.data.tokenId, parsed.data.text);
    res.json({ ok: true, tokenId: parsed.data.tokenId, chars: parsed.data.text.length });
  })
);
