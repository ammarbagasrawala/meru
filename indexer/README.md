# @provenant/indexer
## Audit-log mirror & JSON-RPC service for Provenant events

A standalone Node.js service that listens to `InferenceLogged` and `CorpusMinted` events on 0G Aristotle, persists them locally, and exposes them via **JSON-RPC + REST + WebSocket**. Optionally relays each event to one or more EVM destinations via `ProvenantReader.mirror(...)`.

This is the Track-5 **cross-chain fragmentation primitive**: one Provenant audit-log feed, many EVM consumers, zero new validator sets.

## Why this matters for Track 5

Track 5's official scope names *"cross-chain fragmentation solutions"*. Provenant's audit log lives on 0G Aristotle, but enterprise auditors live on Ethereum, regulators index their own chains, and institutional indexers (Dune / The Graph) primarily target EVM. The indexer:

- **Reduces fragmentation by being permissionless** — anyone can run an indexer; multiple indexers consuming one 0G truth source can re-publish to any chain
- **Decouples the truth source from the consumption surface** — Provenant.sol on 0G stays the canonical record; consumers don't need 0G nodes
- **Supports many EVM destinations natively** — point `INDEXER_MIRROR_TARGETS` at Ethereum, Polygon, Base, Sepolia… each gets its own `ProvenantReader.sol` mirror

## Endpoints

### `GET /health`
Returns `{ ok, lastIndexedBlock, chainId }`.

### `GET /audit/:tokenId`
Browser-friendly read of all inferences for a corpus.

### `POST /rpc` (JSON-RPC 2.0)
- **`provenant_getInferences(tokenId, limit?)`** — Returns `InferenceRow[]` for that corpus.
- **`provenant_getInferenceByBundle(bundleHash)`** — Returns the single row by bundleHash, or `null`.
- **`provenant_status()`** — `{ lastIndexedBlock, chainId, poll_ms }`.

Example:
```bash
curl -X POST http://localhost:8788/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"provenant_getInferences","params":["42",100]}'
```

### `WS /ws/events`
WebSocket push of every new event:
```json
{ "kind": "inference", "payload": { "tokenId": "...", "bundleHash": "...", ... }, "at": 1778614528539 }
{ "kind": "corpus",    "payload": { "tokenId": "...", "rootBlobHash": "...", ... }, "at": ... }
```

## Configuration

Copy `.env.example` → `.env` and fill in:

| Env var | Purpose |
|---|---|
| `PROVENANT_CHAIN_RPC` | 0G Aristotle RPC URL (defaults to `https://evmrpc.0g.ai`) |
| `PROVENANT_CONTRACT_ADDRESS` | The deployed `Provenant.sol` address |
| `INDEXER_PORT` | HTTP+WS port (default `8788`) |
| `INDEXER_DB_PATH` | SQLite file (defaults to `./data/provenant-indexer.db`) |
| `INDEXER_POLL_INTERVAL_MS` | Default `15000` (15s) |
| `INDEXER_BACKFILL_FROM_BLOCK` | Optional starting block on first run |
| `INDEXER_MIRROR_TARGETS` | Optional comma-separated `chainId:rpc:reader:pk` tuples |

## Run locally

```bash
cd provenant/indexer
cp .env.example .env
# Edit .env: set PROVENANT_CONTRACT_ADDRESS at minimum
npm install
npm run dev
```

By default, hit `http://localhost:8788/health` to verify the service is up. Once `PROVENANT_CONTRACT_ADDRESS` is set, the poller starts walking forward from the last cursor block, persisting events into the local SQLite DB.

## Multi-destination relayer mode

Set `INDEXER_MIRROR_TARGETS=11155111:https://sepolia.drpc.org:0xReaderAddrOnSepolia:0xRelayerPrivateKey` to auto-mirror every new event onto Sepolia. The same pattern extends to Polygon, Base, etc. — comma-separate multiple tuples.

**Important:** the relayer signature flow is documented in `relayer.ts`. The production path is that the backend supplies the *original TEE attestation signature* out-of-band; the fallback path (indexer-signed) requires the destination reader contract to be configured for the indexer's address, not the enclave's. See `TRACK-5-COVERAGE.md` in the repo root.

## Trust model

- The indexer is a **read replica of the audit log** — it cannot mint corpora, log inferences, or alter on-chain state on 0G Aristotle. The canonical source is always `Provenant.sol` on 0G.
- Consumers verifying via JSON-RPC should **cross-check the bundleHash they care about against 0G chainscan directly** — the indexer is a convenience layer, not a trust anchor.
- The mirror relayer only writes to `ProvenantReader.sol` contracts on destination chains; those contracts themselves enforce signature verification against an immutable signer set at deploy.

## License

MIT.
