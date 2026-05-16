import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { Poller } from "./poller";
import { log } from "./logger";

/**
 * WebSocket fan-out — every new InferenceLogged event is pushed to all connected clients.
 * Useful for downstream services / dashboards that want push-instead-of-poll. Read-only.
 */
export function attachWebSocket(server: Server, poller: Poller): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws/events" });

  const broadcast = (kind: string, payload: unknown) => {
    const json = JSON.stringify({ kind, payload, at: Date.now() });
    let n = 0;
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(json); n++; } catch { /* ignore */ }
      }
    }
    if (n > 0) log.debug({ kind, n }, "broadcast");
  };

  poller.on("inference", (row) => broadcast("inference", row));
  poller.on("corpus", (row) => broadcast("corpus", row));

  wss.on("connection", (ws) => {
    log.info("ws_client_connected");
    ws.send(JSON.stringify({ kind: "hello", at: Date.now() }));
    ws.on("close", () => log.info("ws_client_disconnected"));
  });

  return wss;
}
