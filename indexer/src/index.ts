import http from "node:http";
import { config } from "./config";
import { buildRpcApp } from "./rpc";
import { Poller } from "./poller";
import { Relayer } from "./relayer";
import { attachWebSocket } from "./wss";
import { log } from "./logger";

async function main(): Promise<void> {
  const app = buildRpcApp();
  const server = http.createServer(app);

  if (!config.PROVENANT_CONTRACT_ADDRESS) {
    log.warn(
      "PROVENANT_CONTRACT_ADDRESS not set — indexer will start in REST/RPC-only mode (DB-cached events from a previous run will be queryable, but no new events will be polled)."
    );
  }

  let poller: Poller | null = null;
  let relayer: Relayer | null = null;

  if (config.PROVENANT_CONTRACT_ADDRESS) {
    poller = new Poller(config.PROVENANT_CONTRACT_ADDRESS);
    relayer = new Relayer();

    poller.on("inference", (row) => {
      if (relayer && relayer.hasTargets()) {
        void relayer.onInference(row);
      }
    });

    await poller.start();
    attachWebSocket(server, poller);
  }

  server.listen(config.INDEXER_PORT, () => {
    log.info(
      {
        port: config.INDEXER_PORT,
        chainId: config.PROVENANT_CHAIN_ID,
        polling: Boolean(poller),
        relayingTo: relayer?.hasTargets() ?? false,
      },
      "indexer_listening"
    );
  });

  const shutdown = (signal: string) => {
    log.info({ signal }, "shutdown");
    poller?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void main().catch((err) => {
  log.error({ err }, "main_threw");
  process.exit(1);
});
