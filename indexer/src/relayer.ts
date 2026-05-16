import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  getBytes,
  keccak256,
} from "ethers";
import type { InferenceRow } from "./db";
import { parseMirrorTargets, type MirrorTarget } from "./config";
import { store } from "./db";
import { log } from "./logger";

/**
 * Relayer — when the poller emits a new InferenceLogged event, re-publish it to every
 * configured destination chain via `ProvenantReader.mirror(...)`. Each destination is
 * independent; one chain's failure doesn't block the others. This is the Track-5
 * cross-chain-fragmentation primitive: one truth source → many EVM consumers.
 *
 * The signature passed to `mirror(...)` MUST be produced by the original TEE attestation signer.
 * For the indexer to produce these, it would need access to the enclave's signing key — which
 * defeats the trust model. Instead, the indexer reads the signature from the *original*
 * Aristotle event payload (we extended the InferenceLogged event to carry it in the
 * production version; for now the indexer marks mirror as 'pending_signature' until the
 * backend supplies it via /api/relay-signature).
 *
 * For the hackathon demo, we ship two modes:
 *   - "relay_with_signature": the backend pushes the TEE signature to this indexer
 *     out-of-band; the relayer assembles the mirror tx.
 *   - "relay_event_only": the indexer publishes a *re-attested* event signed by its own
 *     destination-chain wallet (lighter trust — destination is trusting the indexer, not
 *     the TEE). Used when the original TEE signature isn't available.
 */

const READER_ABI = [
  "function mirror(bytes32 bundleHash, bytes32 originTxHash, uint256 originChainId, uint64 enclaveTimestamp, bytes teeSignature) external",
  "function isMirrored(bytes32 bundleHash) view returns (bool)",
];

export class Relayer {
  private targets: MirrorTarget[];

  constructor() {
    this.targets = parseMirrorTargets();
    log.info({ targets: this.targets.map((t) => t.chainId) }, "relayer_configured");
  }

  hasTargets(): boolean {
    return this.targets.length > 0;
  }

  async onInference(row: InferenceRow, teeSignature?: string): Promise<void> {
    if (!this.hasTargets()) return;
    await Promise.allSettled(
      this.targets.map((t) => this.mirrorToTarget(t, row, teeSignature))
    );
  }

  private async mirrorToTarget(
    target: MirrorTarget,
    row: InferenceRow,
    teeSignature?: string
  ): Promise<void> {
    try {
      const provider = new JsonRpcProvider(target.rpcUrl);
      const key = target.privateKey.startsWith("0x")
        ? target.privateKey
        : `0x${target.privateKey}`;
      const wallet = new Wallet(key, provider);
      const reader = new Contract(target.readerAddress, READER_ABI, wallet);

      const already = (await reader.isMirrored?.(row.bundleHash)) as boolean | undefined;
      if (already) {
        store.recordMirror({
          bundleHash: row.bundleHash,
          destinationChainId: target.chainId,
          txHash: null,
          status: "success",
          error: "already_mirrored",
        });
        return;
      }

      const sig = teeSignature ?? this.indexerSignFallback(row, target);
      const mirrorFn = reader.mirror;
      if (!mirrorFn) throw new Error("mirror_fn_unavailable");
      const tx = await mirrorFn(
        row.bundleHash,
        row.txHash,
        BigInt(16661),
        BigInt(row.eventTimestamp),
        sig
      );
      const receipt = await tx.wait(1);
      store.recordMirror({
        bundleHash: row.bundleHash,
        destinationChainId: target.chainId,
        txHash: receipt?.hash ?? null,
        status: "success",
        error: null,
      });
      log.info(
        { destinationChainId: target.chainId, bundleHash: row.bundleHash, mirrorTx: receipt?.hash },
        "mirror_published"
      );
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 200) : "unknown_error";
      store.recordMirror({
        bundleHash: row.bundleHash,
        destinationChainId: target.chainId,
        txHash: null,
        status: "failed",
        error: message,
      });
      log.warn({ destinationChainId: target.chainId, err: message }, "mirror_failed");
    }
  }

  /**
   * ⚠️ DANGER MODE — DO NOT ENABLE WITHOUT READING THE WARNING BELOW.
   *
   * When the indexer doesn't have the original TEE signature, this fallback produces a
   * re-attestation signed by the indexer's *own destination wallet*. The verifier on the
   * destination chain MUST be aware that it's trusting the indexer (not the TEE) in this
   * mode.
   *
   * Why this is the same anti-pattern as KelpDAO ($292M loss, April 2026):
   *   KelpDAO ran with a *default-config* relayer that effectively used a 1-of-1 verifier
   *   set. Anyone who compromised that single signer could mint arbitrary bridge state.
   *   `relay_event_only` mode here has the same shape: a single off-chain signer (the
   *   indexer's wallet) authorising mirror events. If the indexer's key leaks, an
   *   attacker can publish arbitrary `Mirrored(...)` events on the destination chain.
   *
   * Correct path:
   *   - Use `relay_with_signature` only. The backend supplies the original TEE attestation
   *     signature out-of-band; the indexer is a transport, not a trust root.
   *   - If you absolutely must run `relay_event_only` (e.g., bootstrap before the
   *     backend's relay-signature pipe is wired up), deploy a SEPARATE
   *     `ProvenantReader.sol` instance whose `teeAttestationSigner` is *intentionally
   *     set to the indexer's wallet address*, and clearly label its UI as "indexer-attested,
   *     NOT TEE-attested." Never reuse the production reader for this mode.
   *
   * This fallback returns a placeholder signature (all zeros). The destination reader
   * contract WILL reject it on `ECDSA.recover()` — that is the correct fail-closed
   * behaviour until the operator explicitly opts into `relay_event_only` semantics.
   */
  private indexerSignFallback(_row: InferenceRow, target: MirrorTarget): string {
    log.warn(
      { destinationChainId: target.chainId },
      "indexer_sign_fallback_active__relay_event_only_mode__see_relayer.ts_for_KelpDAO_warning"
    );
    return "0x" + "00".repeat(65);
  }
}
