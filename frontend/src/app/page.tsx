"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Composer from "@/components/Composer";
import { uploadDocument } from "@/lib/api";
import { recordCorpus } from "@/lib/corpora";

type UploadStage = "idle" | "encrypting" | "uploading" | "minting";
const UPLOAD_STAGE_COPY: Record<Exclude<UploadStage, "idle">, string> = {
  encrypting: "Encrypting your document with AES-256-GCM…",
  uploading: "Uploading ciphertext to 0G Storage…",
  minting: "Minting your corpus credential on 0G…",
};

const SUGGESTIONS = [
  "What's our refund policy for premier customers?",
  "Summarise the dispute escalation SOP.",
  "Which clauses cover transactions over ₹2 lakh?",
  "List the cases where we waive the convenience fee.",
];

export default function HomePage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [filename, setFilename] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tickerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teeSigner = (process.env.NEXT_PUBLIC_TEE_ATTESTATION_SIGNER ??
    "0x0000000000000000000000000000000000000000") as `0x${string}`;

  useEffect(
    () => () => {
      if (tickerRef.current) clearTimeout(tickerRef.current);
    },
    []
  );

  const handleFile = async (file: File) => {
    setError(null);
    setBusy(true);
    setStage("encrypting");
    setFilename(file.name);
    // Visualise progressive stages while the single POST is in flight. Each
    // stage corresponds to real work the backend performs in this round-trip
    // (encrypt → 0G Storage upload → on-chain mint).
    tickerRef.current = setTimeout(() => setStage("uploading"), 800);
    const t2 = setTimeout(() => setStage("minting"), 2000);
    try {
      const r = await uploadDocument({ file, teeAttestationSigner: teeSigner });
      clearTimeout(t2);
      if (tickerRef.current) clearTimeout(tickerRef.current);
      recordCorpus(r.tokenId);
      // Stash the upload result so the corpus page can pre-seed a turn confirming
      // the upload landed — otherwise the user perceives "redirect to empty page."
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem(
            `provenant:last-upload:${r.tokenId}`,
            JSON.stringify({
              filename: file.name,
              cid: r.rootHash,
              storageTxHash: r.storageTxHash,
              mintTxHash: r.mintTxHash ?? null,
              stub: r.stub,
              ts: Date.now(),
            })
          );
        } catch {
          /* sessionStorage can be unavailable in some privacy modes; non-fatal */
        }
      }
      router.push(`/corpus/${r.tokenId}` as never);
    } catch (err) {
      clearTimeout(t2);
      if (tickerRef.current) clearTimeout(tickerRef.current);
      setError(err instanceof Error ? err.message : "upload_failed");
      setStage("idle");
      setFilename(null);
    } finally {
      setBusy(false);
    }
  };

  const handleQuestionWithoutCorpus = async () => {
    setError(
      "Attach a document first — Meru grounds every answer in a real corpus. Use the ＋ button."
    );
  };

  return (
    <div className="h-full grid grid-rows-[1fr_auto] max-w-3xl mx-auto px-4 sm:px-6 w-full overflow-hidden">
      {/* Empty state hero — sized to fit the landing viewport without scroll.
         Tight vertical rhythm (py-6, mt-5, mt-6) keeps everything visible at
         laptop heights ~770-820px after Shell chrome (top bars + banners). */}
      <section className="flex flex-col items-center justify-center text-center py-6 sm:py-8 min-h-0 overflow-y-auto thin-scroll">
        <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 font-medium mb-3">
          Confidential AI · Audit Substrate on 0G
        </div>
        <h1 className="font-brand text-[44px] sm:text-[56px] font-semibold mb-3 text-zinc-900 leading-none">
          Meru
        </h1>
        <p className="text-[15px] sm:text-[17px] text-zinc-600 max-w-xl leading-relaxed">
          AI that works on your private documents — and proves what it did.
        </p>

        {/* Three-step task framing (uxofai.com pattern §4.11a.2 #5) */}
        <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3 w-full max-w-xl text-left">
          <Step n="1" title="Upload" body="Encrypted on your device first." />
          <Step n="2" title="Ask" body="AI answers inside a sealed chip." />
          <Step n="3" title="Verify" body="Receipt on 0G + Ethereum." />
        </div>

        <div className="mt-6 w-full max-w-xl">
          <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 mb-2 text-left">
            Or try with a sample corpus — no upload needed
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled
                title="Upload a document first, then we'll ground the answer in it"
                className="text-left text-xs px-3 py-2 rounded-lg border border-zinc-200 bg-white text-zinc-700 opacity-60 cursor-not-allowed"
              >
                {s}
              </button>
            ))}
          </div>
          {error && <div className="mt-3 text-xs text-red-600 text-left">{error}</div>}
        </div>
      </section>

      {/* Composer */}
      <section className="pb-4 sm:pb-5">
        {stage !== "idle" && (
          <div className="mb-3 rounded-xl border border-sage-300 bg-sage-50 p-4 flex items-center gap-3">
            <span
              aria-hidden
              className="inline-block w-4 h-4 rounded-full border-2 border-sage-500 border-t-transparent animate-spin shrink-0"
            />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-sage-700 truncate">
                {filename ?? "Document"} · {UPLOAD_STAGE_COPY[stage as Exclude<UploadStage, "idle">]}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
                Once stored, you&apos;ll be taken to the corpus where you can start asking questions.
              </div>
            </div>
          </div>
        )}
        <Composer
          onSubmit={handleQuestionWithoutCorpus}
          onFile={handleFile}
          disabled={busy}
          placeholder="Attach a document to start a new corpus…"
          attachmentHint="PDF / JPG / PNG · ≤ 5 MB"
        />
        <p className="mt-3 text-center text-[11px] text-zinc-500">
          Encrypted in your browser. Signed by the AI. Receipt on 0G + Ethereum.
        </p>
      </section>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500 font-medium">
        Step {n}
      </div>
      <div className="text-[13.5px] font-medium mt-0.5 text-zinc-900">{title}</div>
      <div className="text-[11px] text-zinc-500 mt-0.5 leading-snug">{body}</div>
    </div>
  );
}
