/**
 * Server-side decryption of NICE-7 encrypted-intent queries.
 *
 * Mirror of frontend/src/lib/encryptQuery.ts: X25519 → ECDH → HKDF-SHA-256 →
 * AES-256-GCM with the same `info = "provenant:v1:query-key"` context.
 *
 * Trust-boundary note: the receiving end here is the *backend*, not the
 * inference enclave. The encryption protects the wire (and any intermediate
 * proxy / log aggregator), but the backend operator can read the plaintext
 * once decrypted. See docs/E2E-ENCRYPTED-INFERENCE.md for the v2 plan that
 * moves the receiver into the TEE itself.
 *
 * Security:
 *   - Constant-time AEAD: @noble's gcm.decrypt() rejects tampered ciphertext
 *     by throwing — we never compare tags by hand.
 *   - The X25519 private key is read from env on every call (not cached),
 *     so a runtime rotation through process restart is enough.
 *   - All input lengths are validated; malformed hex throws generic errors.
 *   - The decrypted plaintext is bounded by the same 4096-byte question cap
 *     the frontend enforces; we reject larger payloads.
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";

const QUESTION_MAX_BYTES = 4096;
const HKDF_INFO = new TextEncoder().encode("provenant:v1:query-key");

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error("invalid_hex");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export type EncryptedQuery = {
  ciphertextHex: string;
  ephemeralPublicKeyHex: string;
  ivHex: string;
};

export function decryptIncomingQuery(
  enc: EncryptedQuery,
  enclavePrivKeyHex: string
): string {
  // Validate priv key shape first — the most common configuration error.
  const privKey = fromHex(enclavePrivKeyHex);
  if (privKey.length !== 32) throw new Error("priv_key_invalid");

  const ephPub = fromHex(enc.ephemeralPublicKeyHex);
  if (ephPub.length !== 32) throw new Error("eph_pub_invalid");

  const iv = fromHex(enc.ivHex);
  if (iv.length !== 12) throw new Error("iv_invalid");

  const ct = fromHex(enc.ciphertextHex);
  // ct includes 16-byte AES-GCM tag suffix; reject obvious truncation.
  if (ct.length <= 16 || ct.length > QUESTION_MAX_BYTES + 16) {
    throw new Error("ciphertext_size_invalid");
  }

  const shared = x25519.getSharedSecret(privKey, ephPub);
  const aesKey = hkdf(sha256, shared, /* salt */ undefined, HKDF_INFO, 32);

  // gcm.decrypt throws on tag mismatch — no manual comparison.
  const pt = gcm(aesKey, iv).decrypt(ct);
  if (pt.length === 0 || pt.length > QUESTION_MAX_BYTES) {
    throw new Error("plaintext_size_invalid");
  }
  return new TextDecoder().decode(pt);
}

export function deriveEnclavePublicKeyHex(enclavePrivKeyHex: string): `0x${string}` {
  const priv = fromHex(enclavePrivKeyHex);
  if (priv.length !== 32) throw new Error("priv_key_invalid");
  const pub = x25519.getPublicKey(priv);
  let s = "0x";
  for (const b of pub) s += b.toString(16).padStart(2, "0");
  return s as `0x${string}`;
}
