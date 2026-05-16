import type { RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "../config";

/** Strict CORS — single allowed origin from env. */
export const corsMw = cors({
  origin: config.BACKEND_CORS_ORIGIN,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
  maxAge: 600,
});

/** Helmet defaults — CSP / HSTS / X-Frame-Options / Referrer-Policy / etc. */
export const helmetMw = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "connect-src": ["'self'", config.BACKEND_CORS_ORIGIN],
      "img-src": ["'self'", "data:"],
      "object-src": ["'none'"],
      "frame-ancestors": ["'none'"],
    },
  },
  hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: false },
  referrerPolicy: { policy: "no-referrer" },
});

/** Per-endpoint rate limit. Fail-closed; in-memory is fine for hackathon scale. */
export function rateLimitFor(windowMinutes: number, max: number): RequestHandler {
  return rateLimit({
    windowMs: windowMinutes * 60_000,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "rate_limited" });
    },
  });
}
