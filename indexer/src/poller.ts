import { Contract, EventLog, JsonRpcProvider } from "ethers";
import { EventEmitter } from "node:events";
import { config } from "./config";
import { store, InferenceRow, CorpusRow } from "./db";
import { log } from "./logger";

/**
 * Poller — polls 0G Aristotle for `InferenceLogged` and `CorpusMinted` events
 * since the last persisted cursor block. Idempotent (PRIMARY KEY on bundleHash
 * + tokenId means double-replays are no-ops).
 */

const PROVENANT_ABI = [
  "event CorpusMinted(uint256 indexed tokenId, address indexed owner, bytes32 rootBlobHash, address teeAttestationSigner)",
  "event InferenceLogged(uint256 indexed tokenId, bytes32 indexed bundleHash, bytes32 questionHash, uint64 timestamp)",
];

const CURSOR_KEY = "provenant:lastBlock";

export type IndexedInference = InferenceRow & {
  kind: "inference";
};

export class Poller extends EventEmitter {
  private provider: JsonRpcProvider;
  private contract: Contract;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(contractAddress: string) {
    super();
    this.provider = new JsonRpcProvider(config.PROVENANT_CHAIN_RPC, {
      chainId: config.PROVENANT_CHAIN_ID,
      name: "aristotle",
    });
    this.contract = new Contract(contractAddress, PROVENANT_ABI, this.provider);
  }

  async start(): Promise<void> {
    this.running = true;
    await this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    try {
      await this.pollOnce();
    } catch (err) {
      log.error({ err }, "poll_tick_failed");
    } finally {
      if (this.running) {
        this.timer = setTimeout(() => void this.tick(), config.INDEXER_POLL_INTERVAL_MS);
      }
    }
  }

  private async pollOnce(): Promise<void> {
    const latest = await this.provider.getBlockNumber();
    const cursorPersisted = store.getCursor(CURSOR_KEY);
    const cursor = cursorPersisted > 0
      ? cursorPersisted
      : config.INDEXER_BACKFILL_FROM_BLOCK ?? Math.max(0, latest - 1000);

    if (cursor >= latest) {
      log.trace({ cursor, latest }, "no_new_blocks");
      return;
    }

    // Cap the scan window per tick to avoid RPC strain on long backfills
    const toBlock = Math.min(latest, cursor + 5000);
    log.info({ fromBlock: cursor + 1, toBlock, latest }, "polling_events");

    // Filters are dynamically generated from the ABI; ethers v6 typing doesn't expose them
    // statically when constructed from a string-array ABI. Resolve at runtime.
    const mintFilterFn = this.contract.filters.CorpusMinted;
    const inferFilterFn = this.contract.filters.InferenceLogged;
    if (!mintFilterFn || !inferFilterFn) {
      throw new Error("provenant_abi_misconfigured");
    }
    const mintFilter = mintFilterFn();
    const inferFilter = inferFilterFn();

    const [mintLogs, inferLogs] = await Promise.all([
      this.contract.queryFilter(mintFilter, cursor + 1, toBlock),
      this.contract.queryFilter(inferFilter, cursor + 1, toBlock),
    ]);

    for (const ev of mintLogs) {
      if (!(ev instanceof EventLog)) continue;
      const block = await ev.getBlock();
      const row: CorpusRow = {
        tokenId: String(ev.args.getValue("tokenId")),
        rootBlobHash: String(ev.args.getValue("rootBlobHash")),
        teeAttestationSigner: String(ev.args.getValue("teeAttestationSigner")),
        ownerAtMint: String(ev.args.getValue("owner")),
        blockNumber: ev.blockNumber,
        txHash: ev.transactionHash,
        mintedAt: block.timestamp,
        indexedAt: Date.now(),
      };
      store.saveCorpus(row);
      this.emit("corpus", row);
    }

    for (const ev of inferLogs) {
      if (!(ev instanceof EventLog)) continue;
      const row: InferenceRow = {
        tokenId: String(ev.args.getValue("tokenId")),
        bundleHash: String(ev.args.getValue("bundleHash")),
        questionHash: String(ev.args.getValue("questionHash")),
        blockNumber: ev.blockNumber,
        txHash: ev.transactionHash,
        logIndex: ev.index,
        eventTimestamp: Number(ev.args.getValue("timestamp")),
        indexedAt: Date.now(),
      };
      store.saveInference(row);
      this.emit("inference", row);
    }

    store.setCursor(CURSOR_KEY, toBlock);
    log.info(
      { fromBlock: cursor + 1, toBlock, mints: mintLogs.length, inferences: inferLogs.length },
      "events_indexed"
    );
  }
}
