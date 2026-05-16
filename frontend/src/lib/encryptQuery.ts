/**
 * NICE-7 — client-side query encryption ("encrypted intents") into the TEE.
 *
 * Threat model: the user's question content never leaves the browser as plaintext.
 *   - Generate an ephemeral X25519 keypair.
 *   - ECDH against the enclave's boot-time X25519 public key.
 *   - HKDF-SHA-256 → 32-byte AES key.
 *   - AES-256-GCM encrypt with a CSPRNG 12-byte IV; ship ciphertext + ephemeral pubkey + iv to the backend.
 *   - The backend cannot decrypt — only the enclave can.
 *
 * If NEXT_PUBLIC_ENCLAVE_X25519_PUBLIC_KEY is not configured, the caller should fall back to the
 * plaintext-question path. The frontend exposes a toggle to show users the difference.
 */
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";
import { gcm } from "@noble/ciphers/aes";

const QUESTION_MAX_BYTES = 4096;

export type EncryptedQuery = {
  ciphertextHex: `0x${string}`;
  ephemeralPublicKeyHex: `0x${string}`;
  ivHex: `0x${string}`;
};

function toHex(buf: Uint8Array): `0x${string}` {
  return ("0x" + Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error("invalid_hex");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function encryptQueryForEnclave(
  question: string,
  enclaveX25519PublicKeyHex: string
): Promise<EncryptedQuery> {
  const bytes = new TextEncoder().encode(question);
  if (bytes.length === 0 || bytes.length > QUESTION_MAX_BYTES) {
    throw new Error("invalid_question_size");
  }
  const enclavePub = fromHex(enclaveX25519PublicKeyHex);
  if (enclavePub.length !== 32) throw new Error("enclave_pubkey_invalid");

  const ephemeralPriv = x25519.utils.randomPrivateKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);
  const sharedSecret = x25519.getSharedSecret(ephemeralPriv, enclavePub);

  const aesKey = hkdf(
    sha256,
    sharedSecret,
    /* salt */ undefined,
    new TextEncoder().encode("provenant:v1:query-key"),
    32
  );

  const iv = randomBytes(12); // CSPRNG; never reuse
  const ciphertext = gcm(aesKey, iv).encrypt(bytes);

  return {
    ciphertextHex: toHex(ciphertext),
    ephemeralPublicKeyHex: toHex(ephemeralPub),
    ivHex: toHex(iv),
  };
}

export function enclavePubKeyAvailable(): boolean {
  const v = process.env.NEXT_PUBLIC_ENCLAVE_X25519_PUBLIC_KEY;
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}
