# Run Meru — single-page operations guide

Everything to bring the full stack up in order, with one-liner equivalents per role.

**Read order:** if you're starting from scratch, do §1 then §2 then §3. If you're resuming a working session, jump to §4.

---

## §1 — Prerequisites (one-time)

```bash
# 1. Node 20+ (check)
node -v        # → v20.x or v22.x

# 2. Repo root
cd /Users/ammarbagasrawala/Documents/ammar/hackathon-0g-apac/provenant

# 3. Install deps for each package
( cd backend  && npm install )
( cd frontend && npm install )
( cd indexer  && npm install )
( cd contracts && npm install )
```

---

## §2 — Env files (REQUIRED before first boot)

⛔️ **Never run `cp .env.example .env`** — it will wipe your real keys. The template now ships with a poison-pill guard that hard-fails backend startup if you do.

Edit each file in your editor and fill in real values. Contents required per file:

### `backend/.env`

```ini
# Server
BACKEND_PORT=8787
BACKEND_CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=info

# 0G Aristotle mainnet
OG_RPC_URL=https://evmrpc.0g.ai
OG_CHAIN_ID=16661
OG_STORAGE_INDEXER_URL=https://indexer-storage-testnet-standard.0g.ai
PROVENANT_CONTRACT_ADDRESS=0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5

# 0G Sealed Inference (Phala TEE via broker SDK)
OG_INFERENCE_PROVIDER_ADDRESS=0x25F8f01cA76060ea40895472b1b79f76613Ca497

# Sepolia mirror
SEPOLIA_RPC_URL=<your Sepolia RPC, e.g. https://sepolia.drpc.org>
PROVENANT_READER_ADDRESS=0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5

# Server wallet (pays gas + signs Provenant digests)
SERVER_PRIVATE_KEY=<your deployer wallet pk, 64 hex chars, no 0x prefix>
TEE_ATTESTATION_SIGNER=0x01E246e79fE0547C0d9aA63672E766626825fc1A

# Crypto
ENCRYPTION_MASTER_KEY=<openssl rand -hex 32>

# Encrypted-intents bridge (X25519 keypair)
# Generate with: cd backend && npx tsx scripts/gen-enclave-keypair.ts
ENCLAVE_X25519_PRIVATE_KEY=<private half from gen-enclave-keypair.ts>
```

### `frontend/.env.local`

```ini
NEXT_PUBLIC_BACKEND_URL=http://localhost:8787
NEXT_PUBLIC_INDEXER_URL=http://localhost:8788
NEXT_PUBLIC_OG_EXPLORER_URL=https://chainscan.0g.ai
NEXT_PUBLIC_SEPOLIA_EXPLORER_URL=https://sepolia.etherscan.io
NEXT_PUBLIC_PROVENANT_ADDRESS=0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5
NEXT_PUBLIC_TEE_ATTESTATION_SIGNER=0x01E246e79fE0547C0d9aA63672E766626825fc1A
NEXT_PUBLIC_ENCLAVE_X25519_PUBLIC_KEY=<public half from gen-enclave-keypair.ts>
NEXT_PUBLIC_DEMO_MODE=1
```

### `indexer/.env`

```ini
PROVENANT_CHAIN_RPC=https://evmrpc.0g.ai
PROVENANT_CHAIN_ID=16661
PROVENANT_CONTRACT_ADDRESS=0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5
INDEXER_PORT=8788
LOG_LEVEL=info
# Leave INDEXER_BACKFILL_FROM_BLOCK unset — auto-defaults to (latest - 1000).
```

### Generate any keys you don't have

```bash
# AES-256-GCM master key (no 0x prefix)
openssl rand -hex 32

# X25519 keypair for encrypted-intents bridge
cd backend && npx tsx scripts/gen-enclave-keypair.ts
# Outputs both halves. Paste private to backend/.env, public to frontend/.env.local.
```

### Back up your real `.env` files NOW

After you've filled them in, snapshot them to a safe location outside the project:

```bash
mkdir -p ~/.meru-env-backup
cp backend/.env       ~/.meru-env-backup/backend.env.real
cp frontend/.env.local ~/.meru-env-backup/frontend.env.local.real
cp indexer/.env       ~/.meru-env-backup/indexer.env.real
chmod 600 ~/.meru-env-backup/*.real
```

To restore later if anything wipes them:

```bash
cp ~/.meru-env-backup/backend.env.real       backend/.env
cp ~/.meru-env-backup/frontend.env.local.real frontend/.env.local
cp ~/.meru-env-backup/indexer.env.real       indexer/.env
```

---

## §3 — Bring the stack up (3 terminals)

Open **three terminals**, one per service. Keeping them visible is the fastest way to spot a broken stage.

### Terminal 1 — Backend (Express + Sealed Inference broker)

```bash
cd /Users/ammarbagasrawala/Documents/ammar/hackathon-0g-apac/provenant/backend
npm run dev
```

Expect a line like:
```
{"level":30,"port":8787,"cors":"http://localhost:3000","ogReady":true,"sepoliaReady":true,"msg":"provenant_backend_listening"}
```

`ogReady` and `sepoliaReady` should both be `true` once the env is correct. If `ogReady: false`, check that all the Level-2/Level-3 vars in `backend/.env` are present and well-formed.

### Terminal 2 — Indexer (JSON-RPC + WebSocket audit log)

```bash
cd /Users/ammarbagasrawala/Documents/ammar/hackathon-0g-apac/provenant/indexer
npm run dev
```

Expect `provenant_indexer_listening` + a `lastIndexedBlock` near the current chain tip.

### Terminal 3 — Frontend (Next.js)

```bash
cd /Users/ammarbagasrawala/Documents/ammar/hackathon-0g-apac/provenant/frontend
npm run dev
```

Opens at <http://localhost:3000>. Hot-reload picks up TS + CSS edits without a restart. Cache corruption (`Failed to open SST file`) is rare but if it happens: kill, `rm -rf .next`, restart.

---

## §4 — Quick health checks (run any time)

### Mainnet smoke (proves contract is alive)

```bash
cd /Users/ammarbagasrawala/Documents/ammar/hackathon-0g-apac/provenant/backend
npm run smoke
```

Should show 8/8 ✅. This is the single command to put in front of a sceptical judge.

### Backend reachable

```bash
curl -sS -m 5 http://localhost:8787/api/audit/1 | head -c 300
```

### Indexer reachable

```bash
curl -sS -m 5 http://localhost:8788/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"provenant_status","params":[]}'
```

### Real Sealed Inference

```bash
cd /Users/ammarbagasrawala/Documents/ammar/hackathon-0g-apac/provenant/backend
npx tsx scripts/test-real-inference.ts
```

Should return `stub=false` and a coherent answer.

### Real upload + grounded query (end-to-end)

```bash
# Upload (creates a fresh corpus on-chain)
curl -sS -m 60 -X POST http://localhost:8787/api/upload \
  -F "file=@demo-assets/banking-statement.pdf" \
  -F "teeAttestationSigner=0x01E246e79fE0547C0d9aA63672E766626825fc1A" \
  | jq '{tokenId, mintTxHash, stub}'
# Note the tokenId — use it in the query below.

# Query (real Sealed Inference)
curl -sS -m 90 -X POST http://localhost:8787/api/query \
  -H "Content-Type: application/json" \
  -d '{"tokenId":"<TOKENID>","questionPlaintext":"What is the available balance?","mev":"off"}' \
  | jq '{stub, modelId: .provenance.modelId, answer}'
```

### Standalone verifier (regulator-style)

```bash
open "http://localhost:3000/verifier/index.html"
```

Paste any tokenId + bundleHash from a past query, hit Verify. No Meru backend in the loop.

---

## §5 — Restart any single service

```bash
# Backend
lsof -ti :8787 | xargs kill -9 2>/dev/null
( cd /Users/ammarbagasrawala/Documents/ammar/hackathon-0g-apac/provenant/backend && npm run dev )

# Indexer
lsof -ti :8788 | xargs kill -9 2>/dev/null
( cd /Users/ammarbagasrawala/Documents/ammar/hackathon-0g-apac/provenant/indexer && npm run dev )

# Frontend
lsof -ti :3000 | xargs kill -9 2>/dev/null
( cd /Users/ammarbagasrawala/Documents/ammar/hackathon-0g-apac/provenant/frontend && npm run dev )
```

---

## §6 — Recover from common breakage

| Symptom | Cause | Fix |
|---|---|---|
| `ogReady: false` at backend boot | Missing env vars | Verify all Level-2/3 keys in `backend/.env`; restart |
| `Internal Server Error` on upload | Missing `ENCRYPTION_MASTER_KEY` | Generate `openssl rand -hex 32`, add to `backend/.env`, restart |
| `encryption_not_configured` 503 response | Same as above (now with friendly error) | Same fix |
| `__MERU_TEMPLATE_GUARD__` panic at boot | You ran `cp .env.example .env` and wiped real keys | Restore from `~/.meru-env-backup/backend.env.real` |
| `Stub mode` chip in UI on every answer | `OG_INFERENCE_PROVIDER_ADDRESS` not set | Add `0x25F8f01cA76060ea40895472b1b79f76613Ca497` to backend env |
| Encrypted-intents path returns stub | X25519 keypair mismatch between backend + frontend | Regenerate with `gen-enclave-keypair.ts`, restart both |
| Frontend 500 with Turbopack SST errors | Cache corruption | `cd frontend && rm -rf .next && npm run dev` |
| Indexer reports `lastIndexedBlock: 1` | `INDEXER_BACKFILL_FROM_BLOCK` empty-string bug | Remove that var entirely; restart |
| Wallet popup off-screen | Old build cached | Hard-refresh `localhost:3000` (Cmd+Shift+R) |

---

## §7 — Production-ish ports + URLs reference

| Service | Port | URL | What |
|---|---|---|---|
| Frontend | 3000 | <http://localhost:3000> | Next.js — chat UI + auditor page |
| Backend  | 8787 | <http://localhost:8787> | Express API — upload, query, audit |
| Indexer  | 8788 | <http://localhost:8788> | JSON-RPC — `provenant_getInferences`, `provenant_status` |
| Verifier | (static) | <http://localhost:3000/verifier/index.html> | Standalone bundle verifier |
| 0G Aristotle | — | <https://chainscan.0g.ai> | Mainnet explorer |
| Sepolia | — | <https://sepolia.etherscan.io> | Mirror explorer |

Deployed contract addresses (eligibility-critical):
- `Provenant.sol` on 0G Aristotle (chain 16661): `0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5`
- `ProvenantReader.sol` on Sepolia (chain 11155111): `0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5`

---

## §8 — Pre-recording demo checklist

Before recording the submission video:

```bash
# 1. Stack up + smoke green
cd /Users/ammarbagasrawala/Documents/ammar/hackathon-0g-apac/provenant/backend && npm run smoke
# Expect 8/8 ✅

# 2. Warm the Phala TEE (first call is slower)
npx tsx scripts/test-real-inference.ts
# Expect stub=false in <30s

# 3. Confirm all three services up
echo "BE: $(lsof -ti :8787 || echo DOWN), IX: $(lsof -ti :8788 || echo DOWN), FE: $(lsof -ti :3000 || echo DOWN)"

# 4. Open browser tabs in order:
#    - http://localhost:3000 (home, demo upload)
#    - http://localhost:3000/audit/<TOKENID> (auditor view)
#    - http://localhost:3000/verifier/index.html (standalone verifier)
#    - https://chainscan.0g.ai/address/0xA8296DfF7C2faD1170e880d71aF92B2F201D30C5
```
