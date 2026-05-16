import { Router } from "express";
import { ethers } from "ethers"; // v5 island
import { config, chainWritesReady } from "../config";
import { getAristotleProvider, getServerSigner, PROVENANT_ABI } from "../chain/client";
import { MintBody } from "../schemas/api";
import { asyncRoute, log } from "../middleware/error";

export const mintRouter = Router();

/**
 * POST /api/mint
 * Mint a new Provenant iNFT bound to a teeAttestationSigner.
 *
 * The owner is the server's deployer wallet for the demo. In production this would mint
 * to the user's wallet via a meta-transaction or a frontend-initiated tx; for the hackathon
 * demo the server pays gas and transfers ownership to the user on first inference.
 */
mintRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = MintBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const { teeAttestationSigner } = parsed.data;

    if (!chainWritesReady() || !config.PROVENANT_CONTRACT_ADDRESS) {
      // Stub — return a synthetic tokenId so the frontend can wire up without 0G credentials.
      const fakeTokenId = String(Date.now());
      log.warn({ teeAttestationSigner }, "mint_stub");
      res.json({
        tokenId: fakeTokenId,
        txHash: "0x" + "33".repeat(32),
        stub: true,
      });
      return;
    }

    // For initial mint we need a rootBlobHash; in this flow the mint is "empty" — first upload
    // can happen separately. We use a placeholder that gets overwritten on first upload (a future
    // contract upgrade can decouple mint from rootBlobHash, but for v1 we require it).
    res.status(400).json({
      error: "mint_via_upload",
      message:
        "Provenant v1 requires the first upload to mint. POST /api/upload with no tokenId to mint + upload in one shot.",
    });
  })
);
