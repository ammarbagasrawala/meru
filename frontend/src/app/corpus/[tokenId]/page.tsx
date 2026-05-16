"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mountain } from "lucide-react";
import { postQuery, uploadDocument, QueryResponse, ProvenanceBundle } from "@/lib/api";
import { encryptQueryForEnclave } from "@/lib/encryptQuery";
import { recordCorpus } from "@/lib/corpora";
import Composer from "@/components/Composer";
import ProvenanceModal from "@/components/ProvenanceModal";
import HashChip from "@/components/HashChip";
import { Icon } from "@/components/Icon";
import PipelineTracker, {
  StageKey,
  StageStatus,
} from "@/components/PipelineTracker";

const ENCLAVE_PUBKEY = process.env.NEXT_PUBLIC_ENCLAVE_X25519_PUBLIC_KEY ?? "";
const OG_EXPLORER =
  process.env.NEXT_PUBLIC_OG_EXPLORER_URL ?? "https://chainscan.0g.ai";
const SEPOLIA_EXPLORER =
  process.env.NEXT_PUBLIC_SEPOLIA_EXPLORER_URL ?? "https://sepolia.etherscan.io";

type Stages = Partial<Record<StageKey, StageStatus>>;

type Turn =
  | {
      kind: "user-question";
      id: string;
      question: string;
      encrypted: boolean;
    }
  | {
      kind: "assistant-pending";
      id: string;
      stages: Stages;
    }
  | {
      kind: "assistant-answer";
      id: string;
      response: QueryResponse;
      stages: Stages;
    }
  | {
      kind: "doc-upload";
      id: string;
      filename: string;
      cid: `0x${string}`;
      storageTxHash: `0x${string}`;
      /** Real on-chain mint tx hash (null in stub-storage mode if mint also stubbed). */
      mintTxHash: `0x${string}` | null;
      stub: boolean;
    };

export default function CorpusPage({
  params,
}: {
  params: Promise<{ tokenId: string }>;
}) {
  const { tokenId } = use(params);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [modal, setModal] = useState<ProvenanceBundle | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    recordCorpus(tokenId);

    // Pre-seed the thread with the upload that just happened on the home page.
    // The home page stashes a payload in sessionStorage under the corpus's
    // tokenId key right before redirecting here. We inject it as a doc-upload
    // turn so the user sees "✅ filename.pdf added" rather than landing on an
    // empty page after their upload completes. (Stale stashes are ignored.)
    if (typeof window === "undefined") return;
    const key = `provenant:last-upload:${tokenId}`;
    const stash = sessionStorage.getItem(key);
    if (!stash) return;
    sessionStorage.removeItem(key);
    try {
      const parsed = JSON.parse(stash) as {
        filename: string;
        cid: `0x${string}`;
        storageTxHash: `0x${string}`;
        mintTxHash: `0x${string}` | null;
        stub: boolean;
        ts: number;
      };
      // Reject anything older than 30 seconds — the user navigated here directly,
      // not from a fresh upload.
      if (Date.now() - parsed.ts > 30_000) return;
      setTurns((prev) =>
        prev.some((t) => t.kind === "doc-upload" && t.cid === parsed.cid)
          ? prev
          : [
              ...prev,
              {
                kind: "doc-upload",
                id: `seed-${parsed.ts}`,
                filename: parsed.filename,
                cid: parsed.cid,
                storageTxHash: parsed.storageTxHash,
                mintTxHash: parsed.mintTxHash,
                stub: parsed.stub,
              },
            ]
      );
    } catch {
      /* malformed stash — ignore */
    }
  }, [tokenId]);

  // Auto-scroll on new turn
  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [turns]);

  const handleSubmit = async (
    question: string,
    encrypt: boolean,
    mev: "off" | "commit-reveal"
  ) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pendingId = `${id}-a`;

    // Seed the user turn AND the pending assistant turn (so the tracker is visible
    // immediately under the user's question). All non-active stages start `pending`;
    // skipped stages (e.g. commit when MEV is off, encrypt when no enclave pubkey)
    // are filtered out by PipelineTracker so they don't render.
    const initialStages: Stages = {
      encrypt: { state: encrypt && ENCLAVE_PUBKEY ? "running" : "skipped" },
      commit: { state: mev === "commit-reveal" ? "pending" : "skipped" },
      seal: { state: "pending" },
      infer: { state: "pending" },
      anchor: { state: "pending" },
      mirror: { state: "pending" },
    };

    setTurns((prev) => [
      ...prev,
      {
        kind: "user-question",
        id,
        question: encrypt ? "(encrypted — plaintext stays in your browser)" : question,
        encrypted: encrypt,
      },
      { kind: "assistant-pending", id: pendingId, stages: initialStages },
    ]);

    const updateStages = (patch: Stages) =>
      setTurns((prev) =>
        prev.map((t) =>
          t.kind === "assistant-pending" && t.id === pendingId
            ? { ...t, stages: { ...t.stages, ...patch } }
            : t
        )
      );

    try {
      // ── Stage: encrypt (real work; happens in this browser tab) ─────────
      let encryptedQuery:
        | {
            ciphertextHex: `0x${string}`;
            ephemeralPublicKeyHex: `0x${string}`;
            ivHex: `0x${string}`;
          }
        | undefined;
      if (encrypt && ENCLAVE_PUBKEY) {
        encryptedQuery = await encryptQueryForEnclave(question, ENCLAVE_PUBKEY);
        updateStages({ encrypt: { state: "done" } });
      } else {
        updateStages({ encrypt: { state: "skipped" } });
      }

      // ── Honest progress visualization ───────────────────────────────────
      // The backend runs the whole chain (commit → 60s wait → reveal → seal →
      // infer → anchor → mirror) inside ONE POST. From the frontend we have
      // two genuinely real-time anchors: (a) the moment we submit, (b) the
      // moment the response lands. Everything between is opaque — we don't
      // have server-sent events, so any per-stage animation we draw would be
      // fabricated. Older builds of this page used a 750ms ticker to fake
      // step-by-step progress; that contradicts the product's "don't trust,
      // verify" stance and has been removed.
      //
      // What we DO know in real time:
      //   - MEV commit-reveal window is exactly REVEAL_DELAY = 60s, contract-
      //     enforced. So when MEV is on we can honestly tick `commit` → done
      //     at t≈65s (commit tx confirm + 60s window + reveal tx confirm).
      //   - Everything else stays "running" together until response arrives.
      //     They're genuinely in flight; we just can't pinpoint which one is
      //     currently executing on the backend.
      const seq: StageKey[] = [
        ...(mev === "commit-reveal" ? (["commit"] as StageKey[]) : []),
        "seal",
        "infer",
        "anchor",
        "mirror",
      ];
      // Kick everything that's in flight to running, all at once.
      const initialRunning: Stages = {};
      for (const k of seq) initialRunning[k] = { state: "running" };
      updateStages(initialRunning);

      // Honest tick: only the commit stage has a real, contract-enforced
      // duration we can rely on (~65s). Mark it done once that window passes.
      // If the response arrives before then (unlikely but possible), the
      // final reconcile below overrides this anyway.
      let commitTimer: ReturnType<typeof setTimeout> | null = null;
      if (mev === "commit-reveal") {
        commitTimer = setTimeout(() => {
          updateStages({ commit: { state: "done" } } as Stages);
        }, 65_000);
      }

      let response: QueryResponse;
      try {
        response = encryptedQuery
          ? await postQuery({ tokenId, encryptedQuery, mev })
          : await postQuery({ tokenId, questionPlaintext: question, mev });
      } finally {
        if (commitTimer) clearTimeout(commitTimer);
      }

      // ── Reconcile to real evidence ───────────────────────────────────────
      const finalStages: Stages = {
        encrypt:
          encrypt && ENCLAVE_PUBKEY
            ? { state: "done" }
            : { state: "skipped" },
        seal: { state: "done" },
        infer: {
          state: "done",
          hash: response.provenance.bundleHash,
        },
        anchor: {
          state: "done",
          hash: response.provenance.originTxHash,
        },
        mirror: response.provenance.mirror
          ? { state: "done", hash: response.provenance.mirror.txHash }
          : { state: "skipped" },
        ...(response.mev.mode === "commit-reveal"
          ? {
              commit: {
                state: "done",
                hash: response.mev.commitHash,
              },
            }
          : { commit: { state: "skipped" } }),
      };

      setTurns((prev) =>
        prev.map((t) =>
          t.kind === "assistant-pending" && t.id === pendingId
            ? {
                kind: "assistant-answer",
                id: pendingId,
                response,
                stages: finalStages,
              }
            : t
        )
      );
    } catch (err) {
      // Replace the pending turn with an error card. We don't bubble the error
      // upward — the user sees a non-technical failure message.
      const message = err instanceof Error ? err.message : "request_failed";
      setTurns((prev) =>
        prev.map((t) =>
          t.kind === "assistant-pending" && t.id === pendingId
            ? {
                kind: "assistant-answer",
                id: pendingId,
                response: {
                  answer: `Something went wrong while processing your question. (${message})`,
                  provenance: {
                    sourceChunkHashes: [],
                    modelId: "—",
                    enclaveTimestamp: 0,
                    bundleHash: ("0x" + "00".repeat(32)) as `0x${string}`,
                    questionHash: ("0x" + "00".repeat(32)) as `0x${string}`,
                    originTxHash: ("0x" + "00".repeat(32)) as `0x${string}`,
                    originChainId: 0,
                    teeAttestationSigner: null,
                    mirror: null,
                  },
                  mev: { mode: "off" },
                  stub: true,
                },
                stages: { ...t.stages },
              }
            : t
        )
      );
    }
  };

  const handleFile = async (file: File) => {
    const result = await uploadDocument({ file, tokenId });
    setTurns((prev) => [
      ...prev,
      {
        kind: "doc-upload",
        id: `${Date.now()}-up`,
        filename: file.name,
        cid: result.rootHash,
        storageTxHash: result.storageTxHash,
        mintTxHash: result.mintTxHash ?? null,
        stub: result.stub,
      },
    ]);
  };

  return (
    <div className="h-full grid grid-rows-[auto_1fr_auto] max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="px-4 sm:px-6 py-5 border-b border-zinc-200 flex items-center justify-between flex-wrap gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-medium">
            Meru corpus
          </div>
          <h1 className="text-[17px] font-semibold truncate text-zinc-900 mt-0.5">
            #{tokenId}
          </h1>
        </div>
        <Link
          href={`/audit/${tokenId}` as never}
          className="text-[12px] text-zinc-600 hover:text-zinc-900 transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          Public auditor view
          <span aria-hidden className="ml-0.5 text-zinc-400">↗</span>
        </Link>
      </div>

      {/* Thread */}
      <div ref={threadRef} className="overflow-y-auto px-4 sm:px-6 py-6">
        {turns.length === 0 ? (
          <div className="text-center text-zinc-500 py-20 text-sm">
            Empty corpus. Use the ＋ button below to attach a document, then ask the AI a question.
            Every answer comes with cryptographic provenance.
          </div>
        ) : (
          <div className="space-y-6">
            {turns.map((t) => {
              if (t.kind === "doc-upload") {
                return (
                  <div key={t.id} className="flex justify-center">
                    <div className="text-[11px] rounded-full border border-sage-300 bg-sage-50 px-3 py-1.5 text-sage-700 flex items-center gap-2 flex-wrap justify-center">
                      <span className="font-medium">{t.filename}</span>
                      <span className="text-zinc-500">added{t.stub && " · stub"}</span>
                      <HashChip label="CID" value={t.cid} truncate={6} />
                      {/* Prefer the real on-chain Mint Tx (CorpusMinted event on
                          Aristotle). Only fall back to storage tx if mint is null
                          AND we're in stub mode — otherwise hiding the stub
                          placeholder keeps the chip strip honest. */}
                      {t.mintTxHash ? (
                        <HashChip
                          label="Mint Tx"
                          value={t.mintTxHash}
                          href={`${OG_EXPLORER}/tx/${t.mintTxHash}`}
                          truncate={6}
                        />
                      ) : (
                        t.stub && (
                          <HashChip
                            label="0G Tx (stub)"
                            value={t.storageTxHash}
                            truncate={6}
                          />
                        )
                      )}
                    </div>
                  </div>
                );
              }
              if (t.kind === "user-question") {
                return (
                  <div key={t.id} className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl px-4 py-2.5 bg-zinc-900 text-white text-[15px] whitespace-pre-wrap">
                      {t.question}
                      {t.encrypted && (
                        <div className="mt-1 text-[10px] uppercase tracking-[0.08em] opacity-70">
                          encrypted intent
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              if (t.kind === "assistant-pending") {
                return (
                  <div key={t.id} className="flex items-start gap-3">
                    <img
                      src="/meru-logo.png"
                      alt="Meru"
                      width={28}
                      height={28}
                      className="shrink-0 w-7 h-7 rounded-full"
                      title="Meru"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] leading-relaxed text-zinc-500 italic mb-2">
                        Processing through the Meru pipeline…
                      </p>
                      <PipelineTracker stages={t.stages} />
                    </div>
                  </div>
                );
              }
              // assistant-answer
              const r = t.response;
              return (
                <div key={t.id} className="space-y-3">
                  <div className="flex items-start gap-3">
                    <img
                      src="/meru-logo.png"
                      alt="Meru"
                      width={28}
                      height={28}
                      className="shrink-0 w-7 h-7 rounded-full"
                      title="Meru"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
                        {r.answer}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setModal(r.provenance)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-white border border-zinc-200 px-3 py-1 text-[11px] font-medium text-zinc-700 hover:border-zinc-400 transition-colors"
                        >
                          Verify provenance
                        </button>
                        <HashChip label="Bundle" value={r.provenance.bundleHash} truncate={6} />
                        <HashChip
                          label="0G Tx"
                          value={r.provenance.originTxHash}
                          href={`${OG_EXPLORER}/tx/${r.provenance.originTxHash}`}
                          truncate={6}
                        />
                        {r.provenance.mirror && (
                          <HashChip
                            label="Sepolia"
                            value={r.provenance.mirror.txHash}
                            href={`${SEPOLIA_EXPLORER}/tx/${r.provenance.mirror.txHash}`}
                            truncate={6}
                          />
                        )}
                        {r.mev.mode === "commit-reveal" && (
                          <>
                            {/* Commit tx: separate from the reveal/anchor tx. When
                                commitTxHash is present, link it; otherwise fall back
                                to showing just the commit hash digest. */}
                            {r.mev.commitTxHash ? (
                              <HashChip
                                label="Commit Tx"
                                value={r.mev.commitTxHash}
                                href={`${OG_EXPLORER}/tx/${r.mev.commitTxHash}`}
                                truncate={6}
                              />
                            ) : (
                              <HashChip
                                label="Commit hash"
                                value={r.mev.commitHash}
                                truncate={6}
                              />
                            )}
                          </>
                        )}
                        {r.stub && (
                          <span className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded">
                            stub
                          </span>
                        )}
                      </div>
                      <details className="mt-3">
                        <summary className="text-[11px] text-zinc-500 cursor-pointer hover:text-emerald-600 select-none">
                          Behind the scenes
                        </summary>
                        <div className="mt-2">
                          <PipelineTracker stages={t.stages} />
                        </div>
                      </details>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="px-4 sm:px-6 pb-6 pt-2 border-t border-zinc-200 dark:border-zinc-800">
        <Composer
          onSubmit={handleSubmit}
          onFile={handleFile}
          placeholder="Ask anything about this corpus…"
          attachmentHint="Attach more docs anytime · ≤ 5 MB"
        />
      </div>

      <ProvenanceModal
        bundle={modal ?? ({} as never)}
        open={Boolean(modal)}
        onClose={() => setModal(null)}
      />
    </div>
  );
}
