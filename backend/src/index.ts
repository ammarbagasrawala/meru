import express from "express";
import { config, ogIntegrationReady, sepoliaMirrorReady } from "./config";
import { corsMw, helmetMw, rateLimitFor } from "./middleware/security";
import { errorHandler, log } from "./middleware/error";
import { mintRouter } from "./routes/mint";
import { uploadRouter } from "./routes/upload";
import { queryRouter } from "./routes/query";
import { auditRouter } from "./routes/audit";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1); // for accurate IP under most PaaS

app.use(helmetMw);
app.use(corsMw);
app.use(express.json({ limit: "256kb" }));

// Health probe — public, no rate limit
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    integrations: {
      ogMainnet: ogIntegrationReady(),
      sepoliaMirror: sepoliaMirrorReady(),
    },
  });
});

// Per-endpoint rate limits
app.use("/api/mint", rateLimitFor(/* 1 min */ 1, /* max */ 10), mintRouter);
app.use("/api/upload", rateLimitFor(1, 10), uploadRouter);
app.use("/api/query", rateLimitFor(1, 30), queryRouter);
app.use("/api/audit", rateLimitFor(1, 60), auditRouter);

app.use(errorHandler);

const server = app.listen(config.BACKEND_PORT, () => {
  log.info(
    {
      port: config.BACKEND_PORT,
      cors: config.BACKEND_CORS_ORIGIN,
      ogReady: ogIntegrationReady(),
      sepoliaReady: sepoliaMirrorReady(),
    },
    "provenant_backend_listening"
  );
});

const shutdown = (signal: string) => {
  log.info({ signal }, "shutdown_signal");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
