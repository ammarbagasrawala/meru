import pino from "pino";
import { config } from "./config";

export const log = pino({
  level: config.LOG_LEVEL,
  transport:
    config.LOG_LEVEL === "debug" || config.LOG_LEVEL === "trace"
      ? { target: "pino-pretty", options: { translateTime: "SYS:standard" } }
      : undefined,
});
