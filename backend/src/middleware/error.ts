import type { ErrorRequestHandler, RequestHandler } from "express";
import pino from "pino";
import { config } from "../config";

export const log = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.questionPlaintext",
      "req.body.encryptedQuery.ciphertextHex",
      "req.body.wrappedCorpusKey",
      "*.privateKey",
      "*.SERVER_PRIVATE_KEY",
      "*.OG_SEALED_INFERENCE_API_KEY",
      "*.ENCRYPTION_MASTER_KEY",
    ],
    censor: "[redacted]",
  },
  transport:
    config.LOG_LEVEL === "debug" || config.LOG_LEVEL === "trace"
      ? { target: "pino-pretty", options: { translateTime: "SYS:standard" } }
      : undefined,
});

/** Catch-all error handler — never leaks internals to the client. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  log.error({ err, path: req.path, method: req.method }, "request_error");
  if (res.headersSent) return;
  // Generic error to the client; details live in server logs.
  res.status(500).json({ error: "internal_error" });
};

/** Async wrapper so promise rejections reach the error handler. */
export const asyncRoute =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
