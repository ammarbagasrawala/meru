"use client";

import { useEffect, useState } from "react";
import { ProvenanceBundle } from "@/lib/api";
import HashChip from "./HashChip";
import Tooltip from "./Tooltip";

const OG_EXPLORER =
  process.env.NEXT_PUBLIC_OG_EXPLORER_URL ?? "https://chainscan.0g.ai";
const SEPOLIA_EXPLORER =
  process.env.NEXT_PUBLIC_SEPOLIA_EXPLORER_URL ?? "https://sepolia.etherscan.io";

type Props = {
  bundle: ProvenanceBundle;
  open: boolean;
  onClose: () => void;
};

/**
 * UX intent (uxofai.com "Progressive disclosure" + "Transparency of process"):
 * the modal opens to a plain-English summary that anyone can read in 5 seconds.
 * A single "Show technical details" disclosure expands the hex evidence for the
 * power-user / auditor. The lay reader is never forced to parse a wall of hex.
 */
export default function ProvenanceModal({ bundle, open, onClose }: Props) {
  const [showTech, setShowTech] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setShowTech(false);
  }, [open]);

  if (!open) return null;

  const enclaveWhen = bundle.enclaveTimestamp
    ? new Date(bundle.enclaveTimestamp * 1000).toLocaleString()
    : "—";
  const sourceCount = bundle.sourceChunkHashes.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prov-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-white dark:bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400 font-semibold">
              Verified · {enclaveWhen}
            </div>
            <h2
              id="prov-modal-title"
              className="text-lg font-semibold mt-0.5"
            >
              This answer is signed and on-chain.
            </h2>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              The AI ran inside a{" "}
              <Tooltip text="A tamper-evident hardware chip (TEE) — even the cloud operator can't peek inside while it runs.">
                sealed chip
              </Tooltip>
              , signed the result, and the receipt was posted to {bundle.mirror ? "two" : "one"} public ledger{bundle.mirror ? "s" : ""}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded ml-2"
          >
            ✕
          </button>
        </div>

        {/* Lay summary — 3 trust badges */}
        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-zinc-200 dark:border-zinc-800">
          <TrustBadge
            icon="Signed"
            title="TEE-attested response"
            body={
              bundle.modelId === "—"
                ? "Failed"
                : "Signed by the provider's enclave key; on-chain teeSignerAddress is the verification anchor."
            }
          />
          <TrustBadge
            icon="Corpus"
            title={`Bound to corpus #${bundle.questionHash ? "" : ""}`.replace(/#$/, "(see audit log)")}
            body={`${sourceCount} corpus fingerprint${sourceCount === 1 ? "" : "s"} bound to this query. Per-chunk retrieval proof is a v2 item.`}
          />
          <TrustBadge
            icon="Mirrored"
            title={bundle.mirror ? "Anchored on 0G + Sepolia" : "Anchored on 0G"}
            body={
              bundle.mirror
                ? "Same signed bundle re-attested on Sepolia by the configured signer (not a trust-free bridge)."
                : "Sepolia re-attestation pending."
            }
          />
        </div>

        {/* Quick proof links — single hop */}
        <div className="px-5 py-3 flex flex-wrap items-center gap-2 text-xs">
          <a
            href={`${OG_EXPLORER}/tx/${bundle.originTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 px-3 py-1 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
          >
            Open on 0G ↗
          </a>
          {bundle.mirror && (
            <a
              href={`${SEPOLIA_EXPLORER}/tx/${bundle.mirror.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 px-3 py-1 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
            >
              Open on Sepolia ↗
            </a>
          )}
          {/* Standalone verifier — opens a single static HTML page that
              queries 0G + Sepolia directly, with no Meru backend in the
              loop. This is the "you don't have to trust us" moment. */}
          <a
            href={`/verifier/index.html?bundle=${bundle.bundleHash}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the standalone verifier — no Meru backend in the loop"
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-zinc-700 hover:border-zinc-400 transition-colors"
          >
            Verify independently ↗
          </a>
          <button
            type="button"
            onClick={() => setShowTech((v) => !v)}
            className="ml-auto text-zinc-500 hover:text-zinc-900 underline decoration-dotted underline-offset-2"
          >
            {showTech ? "Hide technical details" : "Show technical details"}
          </button>
        </div>

        {/* Technical disclosure */}
        {showTech && (
          <div className="px-5 py-4 space-y-4 max-h-[40vh] overflow-y-auto border-t border-zinc-200 dark:border-zinc-800">
            <Section title="Model & Enclave">
              <Row label="Model">
                <code className="text-xs">{bundle.modelId}</code>
              </Row>
              <Row label="Enclave timestamp">
                <code className="text-xs">
                  {bundle.enclaveTimestamp
                    ? new Date(bundle.enclaveTimestamp * 1000).toISOString()
                    : "—"}
                </code>
              </Row>
              {bundle.teeAttestationSigner && (
                <Row label="TEE signer">
                  <HashChip
                    label=""
                    value={bundle.teeAttestationSigner}
                    href={`${OG_EXPLORER}/address/${bundle.teeAttestationSigner}`}
                  />
                </Row>
              )}
            </Section>

            <Section title="Cryptographic commitments">
              <Row label="Question hash">
                <HashChip label="" value={bundle.questionHash} />
              </Row>
              <Row label="Bundle hash">
                <HashChip label="" value={bundle.bundleHash} />
              </Row>
              <Row label={`Source chunks (${sourceCount})`}>
                <div className="flex flex-wrap gap-1.5">
                  {bundle.sourceChunkHashes.map((h, i) => (
                    <HashChip key={i} label={`#${i + 1}`} value={h} truncate={8} />
                  ))}
                </div>
              </Row>
            </Section>

            <Section title="On-chain anchors">
              <Row label="0G Aristotle">
                <HashChip
                  label=""
                  value={bundle.originTxHash}
                  href={`${OG_EXPLORER}/tx/${bundle.originTxHash}`}
                />
              </Row>
              {bundle.mirror && (
                <Row label="Sepolia mirror">
                  <HashChip
                    label=""
                    value={bundle.mirror.txHash}
                    href={`${SEPOLIA_EXPLORER}/tx/${bundle.mirror.txHash}`}
                  />
                  {bundle.mirror.stub && (
                    <span className="text-[10px] text-amber-700 ml-2">
                      (stub mode)
                    </span>
                  )}
                </Row>
              )}
            </Section>

            <div className="text-[11px] text-zinc-500 italic">
              Tip: open the two transaction links in separate tabs — same
              <code className="mx-1">bundleHash</code>, two chains. That&apos;s the{" "}
              <Tooltip text="Same TEE-signed receipt re-published on Ethereum. No assets cross, no validator set — just a re-attestation.">
                anchor + mirror
              </Tooltip>{" "}
              pattern (not a bridge).
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-zinc-900 text-white px-3 py-1.5 text-sm hover:bg-zinc-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function TrustBadge({
  icon,
  title,
  body,
}: {
  /** Short eyebrow label — rendered uppercase, kerned. iOS-style section accent. */
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-500 font-medium mb-1.5">
        {icon}
      </div>
      <div className="text-[13px] font-medium text-zinc-900 leading-snug">
        {title}
      </div>
      <div className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{body}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-2">
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <div className="w-32 shrink-0 text-zinc-500 text-xs pt-0.5">{label}</div>
      <div className="flex-1 break-all">{children}</div>
    </div>
  );
}
