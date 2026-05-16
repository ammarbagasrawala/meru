import { z } from "zod";

/**
 * Zod schemas for every public API surface.
 * - `.strict()` to reject unknown fields (defense vs mass-assignment / over-posting).
 * - Length caps + regex shapes for every untrusted input.
 * - Schemas live here; routes import these and trust nothing else.
 */

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const MintBody = z
  .object({
    teeAttestationSigner: z.string().regex(ADDRESS),
  })
  .strict();
export type MintBody = z.infer<typeof MintBody>;

/** Uploaded file metadata accepted alongside the multipart body. */
export const UploadMeta = z
  .object({
    tokenId: z.coerce.bigint().positive(),
    // For NICE-7: caller MAY pre-encrypt the question; if they pre-encrypt the corpus instead,
    // they pass it through as a ciphertext too. We require neither — server-side encryption
    // is the default path. The wrapped per-corpus key (X25519-wrapped for the TEE) is optional.
    wrappedCorpusKey: z
      .string()
      .max(2048)
      .regex(/^[A-Za-z0-9+/=._-]+$/)
      .optional(),
  })
  .strict();
export type UploadMeta = z.infer<typeof UploadMeta>;

/** Encrypted-intent query payload (NICE-7). All hex; backend cannot decrypt. */
export const EncryptedQuery = z
  .object({
    ciphertextHex: z.string().regex(/^0x[0-9a-fA-F]+$/).max(16384),
    ephemeralPublicKeyHex: z.string().regex(/^0x[0-9a-fA-F]{64}$/), // X25519 = 32 bytes hex
    ivHex: z.string().regex(/^0x[0-9a-fA-F]{24}$/), // 12 bytes
  })
  .strict();

export const QueryBody = z
  .object({
    tokenId: z.coerce.bigint().positive(),
    // EITHER plaintext (max 4 KB) OR encryptedQuery — server validates exactly one is present.
    questionPlaintext: z.string().min(1).max(4096).optional(),
    encryptedQuery: EncryptedQuery.optional(),
    // MEV-resistance mode for the on-chain anchor step.
    //   - "off"           : direct logInference (default)
    //   - "commit-reveal" : wrap the logInference calldata in a Shutter-style threshold-encrypted
    //                       envelope, broadcast a chain-bound commit hash, then reveal+execute.
    //                       The wrapper is a scaffold; production swaps in the Shutter keyper
    //                       network (3-line change documented in backend/src/mev/shutter.ts).
    mev: z.enum(["off", "commit-reveal"]).optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.questionPlaintext) !== Boolean(v.encryptedQuery),
    { message: "Provide exactly one of questionPlaintext or encryptedQuery" }
  );
export type QueryBody = z.infer<typeof QueryBody>;

/** Path parameter for the audit endpoint. */
export const AuditParams = z
  .object({
    tokenId: z.coerce.bigint().positive(),
  })
  .strict();
export type AuditParams = z.infer<typeof AuditParams>;
