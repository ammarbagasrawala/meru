import express, { type Request, type Response } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { store } from "./db";
import { config } from "./config";
import { log } from "./logger";

/**
 * JSON-RPC 2.0 surface for the audit-log mirror.
 *
 * Methods (anyone can call — public, read-only):
 *   - provenant_getInferences(tokenId: string, limit?: number)
 *     → InferenceRow[] for that corpus
 *   - provenant_getInferenceByBundle(bundleHash: string)
 *     → InferenceRow | null
 *   - provenant_status()
 *     → indexer health + last indexed block
 *
 * Why JSON-RPC: this is the same wire format every EVM indexer / wallet / explorer
 * speaks. A consumer on Ethereum mainnet can hit this endpoint with no glue code.
 */

const RpcRequest = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    method: z.string().min(1).max(80),
    params: z.array(z.unknown()).max(10).optional(),
  })
  .strict();

type RpcRequest = z.infer<typeof RpcRequest>;

function ok(id: unknown, result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}
function err(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const TOKEN = /^[0-9]+$/;

export function buildRpcApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: config.INDEXER_CORS_ORIGIN, methods: ["GET", "POST", "OPTIONS"] }));
  app.use(express.json({ limit: "16kb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: (_req, res) => res.status(429).json(err(null, -32099, "rate_limited")),
    })
  );

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      lastIndexedBlock: store.getCursor("provenant:lastBlock"),
      chainId: config.PROVENANT_CHAIN_ID,
    });
  });

  // Simple REST helpers for browser-friendly inspection.
  app.get("/audit/:tokenId", (req: Request, res: Response) => {
    const tokenId = String(req.params.tokenId);
    if (!TOKEN.test(tokenId)) {
      res.status(400).json({ error: "invalid_token_id" });
      return;
    }
    res.json({ events: store.listInferences(tokenId, 200) });
  });

  app.post("/rpc", (req: Request, res: Response) => {
    const parsed = RpcRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(err(null, -32600, "invalid_request"));
      return;
    }
    const { id, method, params = [] } = parsed.data;
    try {
      switch (method) {
        case "provenant_getInferences": {
          const tokenId = params[0];
          const limit = (params[1] as number | undefined) ?? 200;
          if (typeof tokenId !== "string" || !TOKEN.test(tokenId)) {
            res.json(err(id, -32602, "invalid_params: tokenId"));
            return;
          }
          if (typeof limit !== "number" || limit < 1 || limit > 1000) {
            res.json(err(id, -32602, "invalid_params: limit"));
            return;
          }
          res.json(ok(id, store.listInferences(tokenId, limit)));
          return;
        }
        case "provenant_getInferenceByBundle": {
          const bundleHash = params[0];
          if (typeof bundleHash !== "string" || !HEX32.test(bundleHash)) {
            res.json(err(id, -32602, "invalid_params: bundleHash"));
            return;
          }
          res.json(ok(id, store.findInferenceByBundle(bundleHash)));
          return;
        }
        case "provenant_status": {
          res.json(
            ok(id, {
              lastIndexedBlock: store.getCursor("provenant:lastBlock"),
              chainId: config.PROVENANT_CHAIN_ID,
              poll_ms: config.INDEXER_POLL_INTERVAL_MS,
            })
          );
          return;
        }
        default:
          res.json(err(id, -32601, "method_not_found"));
          return;
      }
    } catch (e) {
      log.error({ err: e, method }, "rpc_handler_threw");
      res.status(500).json(err(id, -32000, "internal_error"));
    }
  });

  return app;
}
