/**
 * Generate a fresh X25519 keypair for the encrypted-intent bridge.
 *
 *   cd backend && npx tsx scripts/gen-enclave-keypair.ts
 *
 * Outputs:
 *   ENCLAVE_X25519_PRIVATE_KEY=<hex>   → goes into backend/.env
 *   NEXT_PUBLIC_ENCLAVE_X25519_PUBLIC_KEY=0x<hex>
 *                                       → goes into frontend/.env.local
 *
 * After adding both and restarting backend + frontend, the encrypted-intent
 * toggle on the chat UI routes through the real broker instead of the stub.
 *
 * Safety: prints the private key to stdout once. Do not paste it into chat,
 * issue trackers, or commits. Rotate by re-running this script and updating
 * both env files together.
 */
import { randomBytes } from "node:crypto";
import { x25519 } from "@noble/curves/ed25519.js";

function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

const priv = randomBytes(32);
const pub = x25519.getPublicKey(priv);

console.log("// — Backend (backend/.env) — keep this private —");
console.log(`ENCLAVE_X25519_PRIVATE_KEY=${toHex(priv)}`);
console.log();
console.log("// — Frontend (frontend/.env.local) — public, safe to commit if you wish —");
console.log(`NEXT_PUBLIC_ENCLAVE_X25519_PUBLIC_KEY=0x${toHex(pub)}`);
console.log();
console.log("Restart both backend (kill + npm run dev) and frontend after editing.");
