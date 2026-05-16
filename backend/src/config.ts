import "dotenv/config";
import { z } from "zod";

/**
 * Centralised environment configuration.
 * - All inputs validated through a Zod schema with `.strict()` semantics.
 * - The server refuses to start if required values are missing or malformed.
 * - Optional fields (used in stub mode while 0G mainnet credentials are pending) are flagged as such.
 */

const HEX32 = /^[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_PK = /^(0x)?[0-9a-fA-F]{64}$/;

// .passthrough() lets unrelated env vars (PATH, USER, etc.) flow through without rejection.
// We only validate the fields *we* care about; everything else is ignored.
// Railway / Render / Heroku set PORT dynamically. Promote it to BACKEND_PORT if
// the deploy didn't set BACKEND_PORT explicitly — keeps the binding env-aware
// without needing platform-specific overrides.
if (!process.env.BACKEND_PORT && process.env.PORT) {
  process.env.BACKEND_PORT = process.env.PORT;
}

const Schema = z.object({
  BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  BACKEND_CORS_ORIGIN: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // 0G Aristotle
  OG_RPC_URL: z.string().url().default("https://evmrpc.0g.ai"),
  OG_CHAIN_ID: z.coerce.number().int().default(16661),
  OG_STORAGE_INDEXER_URL: z.string().url().optional(),
  PROVENANT_CONTRACT_ADDRESS: z.string().regex(ADDRESS).optional(),

  // 0G Sealed Inference
  OG_SEALED_INFERENCE_URL: z.string().url().optional(),
  OG_SEALED_INFERENCE_API_KEY: z.string().min(10).optional(),
  // Provider address registered on the 0G compute network (e.g. a Phala TEE
  // chatbot endpoint). When set together with SERVER_PRIVATE_KEY and a funded
  // ledger, seal.ts uses the real broker path instead of the demo-stub answer.
  OG_INFERENCE_PROVIDER_ADDRESS: z.string().regex(ADDRESS).optional(),

  // Sepolia mirror
  SEPOLIA_RPC_URL: z.string().url().optional(),
  PROVENANT_READER_ADDRESS: z.string().regex(ADDRESS).optional(),

  // Server-side wallet (pays gas for logInference + mirror)
  SERVER_PRIVATE_KEY: z.string().regex(HEX_PK).optional(),

  // TEE signer (the address derived from the Sealed Inference enclave's pubkey)
  TEE_ATTESTATION_SIGNER: z.string().regex(ADDRESS).optional(),

  // X25519 private key (32-byte hex) used by the backend to decrypt
  // NICE-7 encrypted-intent queries. Matching public key lives in the frontend
  // env as NEXT_PUBLIC_ENCLAVE_X25519_PUBLIC_KEY. When this is set, encrypted
  // queries route through the real broker just like plaintext queries; the
  // backend operator sees the plaintext post-decrypt (see
  // docs/E2E-ENCRYPTED-INFERENCE.md for the v2 plan).
  ENCLAVE_X25519_PRIVATE_KEY: z.string().regex(HEX32).optional(),

  // Master AEAD key for HKDF-derived per-corpus keys (hex, 32 bytes)
  ENCRYPTION_MASTER_KEY: z.string().regex(HEX32).optional(),

  // Shutter eonSeed (32-byte hex). Optional; production swap-in for the in-repo
  // commit-reveal wrapper scaffold. Read directly via process.env in
  // backend/src/mev/shutter.ts::loadEonSeed — we only validate the shape here so
  // the server fails fast on a malformed value.
  SHUTTER_EON_SEED: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/)
    .optional(),
});

// Pluck only our known keys before parsing — unknowns are ignored, not rejected.
// Filter to schema-known keys AND treat empty strings as absent. A `.env` line
// like `SEPOLIA_RPC_URL=` (no value) shows up in process.env as `""`, which would
// fail `.url().optional()` because empty-string is "present but invalid." We want
// it to behave like `undefined` and use the schema default / absence semantics.
const ours = Object.fromEntries(
  Object.entries(process.env).filter(([k, v]) => k in Schema.shape && v !== "")
);
// Poison-pill guard: .env.example carries a __MERU_TEMPLATE_GUARD__ key
// specifically so an accidental `cp .env.example .env` is detected. If
// the user copies the template over their real .env, we refuse to boot
// rather than silently run with placeholder secrets.
if (process.env.__MERU_TEMPLATE_GUARD__) {
  // eslint-disable-next-line no-console
  console.error(
    "\n⛔️ [config] backend/.env appears to be the TEMPLATE, not your real .env.\n" +
      "    The __MERU_TEMPLATE_GUARD__ var is set — that var only exists in .env.example.\n" +
      "    Most likely cause: you ran `cp .env.example .env` and overwrote your real keys.\n" +
      "    Fix: restore your real .env (from a backup if you have one), or open .env\n" +
      "    in your editor and remove the __MERU_TEMPLATE_GUARD__ line + fill in real values.\n"
  );
  process.exit(1);
}

const parsed = Schema.safeParse(ours);
if (!parsed.success) {
  // Don't leak structured details from env back to the operator — log the field names only.
  // eslint-disable-next-line no-console
  console.error(
    "[config] invalid environment:",
    parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
  );
  process.exit(1);
}

export const config = parsed.data;

/**
 * Returns true if everything required for the *full* 0G integration is wired:
 *   - 0G Storage indexer (for real ciphertext blob uploads)
 *   - Deployed Provenant contract address
 *   - Sealed Inference provider address (via the @0gfoundation broker SDK)
 *   - Server wallet that pays gas + signs Provenant digests
 *   - TEE attestation signer address (Level-1 placeholder == deployer wallet;
 *     Level-3 swap-in = enclave-generated key)
 *   - Encryption master key (HKDF root for per-corpus AES-256-GCM keys)
 *
 * Note: the legacy `OG_SEALED_INFERENCE_URL` env was the pre-broker-SDK gate
 * and is no longer load-bearing. Real inference is gated on
 * `OG_INFERENCE_PROVIDER_ADDRESS` + the on-chain broker contract; check
 * `sealedInferenceReady()` for that.
 */
export function ogIntegrationReady(): boolean {
  return Boolean(
    config.OG_STORAGE_INDEXER_URL &&
      config.PROVENANT_CONTRACT_ADDRESS &&
      config.OG_INFERENCE_PROVIDER_ADDRESS &&
      config.SERVER_PRIVATE_KEY &&
      config.TEE_ATTESTATION_SIGNER &&
      config.ENCRYPTION_MASTER_KEY
  );
}

/**
 * Returns true if the *chain-write* side is wired (we have a deployed
 * Provenant contract, a funded server wallet, and a TEE-attestation signer
 * address). When this is true the query route fires REAL `logInference` /
 * `commitInference` / `revealAndLogInference` txs to whichever chain
 * `OG_RPC_URL` + `OG_CHAIN_ID` point at — even if Storage + Sealed Inference
 * stay in stub mode. This is the demo-headline configuration: real on-chain
 * audit trail with stubbed inference content for deterministic recording.
 */
export function chainWritesReady(): boolean {
  return Boolean(
    config.PROVENANT_CONTRACT_ADDRESS &&
      config.SERVER_PRIVATE_KEY &&
      config.TEE_ATTESTATION_SIGNER
  );
}

/** Returns true if the Sepolia mirror is wired up. */
export function sepoliaMirrorReady(): boolean {
  return Boolean(
    config.SEPOLIA_RPC_URL && config.PROVENANT_READER_ADDRESS && config.SERVER_PRIVATE_KEY
  );
}

/**
 * Returns true if real 0G Sealed Inference is wired: we have a funded server
 * wallet, a chain RPC, and a registered provider address. When true, seal.ts
 * routes the user's question through the broker SDK → provider TEE → signed
 * response, instead of returning a deterministic stub answer.
 */
export function sealedInferenceReady(): boolean {
  return Boolean(
    config.SERVER_PRIVATE_KEY &&
      config.OG_RPC_URL &&
      config.OG_INFERENCE_PROVIDER_ADDRESS
  );
}
