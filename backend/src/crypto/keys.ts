import { hkdfSync, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";

/**
 * Cryptography helpers — AES-256-GCM + HKDF-SHA-256.
 *
 * Rules baked in (per the secure-coding policy):
 *   - AEAD with unique 12-byte CSPRNG IV per message.
 *   - Per-corpus subkey derived from a 32-byte master via HKDF-SHA-256 with a labelled `info`.
 *   - Constant-time comparison for any auth-tag / hash equality check.
 *   - No caller-supplied IVs; we always generate them inside the wrapper.
 */

const AES_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HKDF_INFO_PREFIX = "provenant:v1:corpus-key:";

export type EncryptedBlob = {
  iv: Buffer;          // 12 bytes
  tag: Buffer;         // 16 bytes
  ciphertext: Buffer;  // |plaintext|
};

/** Derive a 32-byte per-corpus key from the 32-byte master key + corpus identifier. */
export function deriveCorpusKey(masterHex: string, corpusId: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(masterHex)) {
    throw new Error("master_key_invalid");
  }
  if (!corpusId || corpusId.length > 128) {
    throw new Error("corpus_id_invalid");
  }
  const master = Buffer.from(masterHex, "hex");
  const info = Buffer.from(HKDF_INFO_PREFIX + corpusId, "utf8");
  const okm = hkdfSync("sha256", master, /* salt */ Buffer.alloc(0), info, AES_KEY_BYTES);
  return Buffer.from(okm);
}

/** Encrypt a buffer with AES-256-GCM; returns iv|tag|ciphertext. IV is CSPRNG. */
export function aeadEncrypt(key: Buffer, plaintext: Buffer): EncryptedBlob {
  if (key.length !== AES_KEY_BYTES) throw new Error("key_length_invalid");
  if (plaintext.length === 0) throw new Error("plaintext_empty");
  const iv = randomBytes(IV_BYTES); // CSPRNG — never reuse
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, tag, ciphertext };
}

/** Decrypt iv|tag|ciphertext with AES-256-GCM. Throws on tampering. */
export function aeadDecrypt(key: Buffer, blob: EncryptedBlob): Buffer {
  if (key.length !== AES_KEY_BYTES) throw new Error("key_length_invalid");
  if (blob.iv.length !== IV_BYTES) throw new Error("iv_length_invalid");
  if (blob.tag.length !== TAG_BYTES) throw new Error("tag_length_invalid");
  const decipher = createDecipheriv("aes-256-gcm", key, blob.iv);
  decipher.setAuthTag(blob.tag);
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
}

/** Pack iv|tag|ciphertext into a single buffer for storage. */
export function packBlob(blob: EncryptedBlob): Buffer {
  return Buffer.concat([blob.iv, blob.tag, blob.ciphertext]);
}

/** Unpack a stored buffer back into an EncryptedBlob. */
export function unpackBlob(buf: Buffer): EncryptedBlob {
  if (buf.length < IV_BYTES + TAG_BYTES + 1) throw new Error("packed_blob_too_short");
  return {
    iv: buf.subarray(0, IV_BYTES),
    tag: buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES),
    ciphertext: buf.subarray(IV_BYTES + TAG_BYTES),
  };
}

/** Constant-time equality on two Buffers of equal length. */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
