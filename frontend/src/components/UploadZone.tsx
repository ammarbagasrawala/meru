"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadDocument, UploadResponse } from "@/lib/api";
import HashChip from "./HashChip";
import Tooltip from "./Tooltip";

const ACCEPTED = ".pdf,.jpg,.jpeg,.png";
const MAX_BYTES = 5 * 1024 * 1024;
const OG_EXPLORER =
  process.env.NEXT_PUBLIC_OG_EXPLORER_URL ?? "https://chainscan.0g.ai";

type UploadStage = "encrypting" | "uploading" | "minting" | "done";
const UPLOAD_STAGE_LABELS: Record<Exclude<UploadStage, "done">, string> = {
  encrypting: "Encrypting on your device…",
  uploading: "Uploading to 0G Storage…",
  minting: "Minting your corpus credential…",
};

type Props = {
  tokenId?: string;
  teeAttestationSigner?: `0x${string}`;
  onUploaded: (r: UploadResponse) => void;
};

export default function UploadZone({ tokenId, teeAttestationSigner, onUploaded }: Props) {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<UploadStage>("done");
  const [showProof, setShowProof] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<UploadResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tickerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (tickerRef.current) clearTimeout(tickerRef.current);
    },
    []
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (file.size === 0 || file.size > MAX_BYTES) {
        setError("File must be under 5 MB.");
        return;
      }
      const okType = ["application/pdf", "image/jpeg", "image/png"].includes(file.type);
      if (!okType) {
        setError("Only PDF / JPG / PNG accepted.");
        return;
      }
      setBusy(true);
      setStage("encrypting");
      // The browser hands the file to the backend for AES-256-GCM encryption +
      // 0G Storage upload + iNFT mint in one POST. We can't observe sub-stages
      // from a single fetch, so visualise them with realistic timing.
      tickerRef.current = setTimeout(() => setStage("uploading"), 800);
      const t2 = setTimeout(() => setStage("minting"), 2000);
      try {
        const result = await uploadDocument({ file, tokenId, teeAttestationSigner });
        clearTimeout(t2);
        if (tickerRef.current) clearTimeout(tickerRef.current);
        setLastResult(result);
        setStage("done");
        onUploaded(result);
      } catch (err) {
        clearTimeout(t2);
        if (tickerRef.current) clearTimeout(tickerRef.current);
        setError(err instanceof Error ? err.message : "upload_failed");
        setStage("done");
      } finally {
        setBusy(false);
      }
    },
    [tokenId, teeAttestationSigner, onUploaded]
  );

  return (
    <div className="w-full">
      <label
        htmlFor="provenant-upload"
        className="block w-full border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg p-6 text-center cursor-pointer hover:border-emerald-500 transition-colors"
      >
        <input
          ref={inputRef}
          id="provenant-upload"
          type="file"
          accept={ACCEPTED}
          disabled={busy}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <div className="text-3xl mb-2" aria-hidden>
          📄
        </div>
        <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {busy
            ? stage === "done"
              ? "Finishing up…"
              : UPLOAD_STAGE_LABELS[stage]
            : "Drop or pick a PDF / JPG / PNG"}
        </div>
        <div className="text-[11px] text-zinc-500 mt-1">
          <Tooltip text="AES-256-GCM encryption in your browser before it leaves your device.">
            Encrypted on your device
          </Tooltip>{" "}
          ·{" "}
          <Tooltip text="0G Storage — a content-addressed decentralised blob store. We send only ciphertext.">
            stored on 0G
          </Tooltip>
        </div>
      </label>

      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

      {lastResult && (
        <div className="mt-3 rounded-md bg-sage-50 border border-sage-300 p-3 text-sm">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="font-medium text-sage-700 flex items-center gap-1.5">
              <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-sage-500" />
              Stored{" "}
              {lastResult.stub
                ? "(stub mode)"
                : `as corpus #${lastResult.tokenId}`}
            </div>
            <button
              type="button"
              onClick={() => setShowProof((v) => !v)}
              className="text-[11px] text-sage-700 underline decoration-dotted underline-offset-2"
            >
              {showProof ? "Hide proof" : "See proof"}
            </button>
          </div>
          {showProof && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
              <HashChip label="CID" value={lastResult.rootHash} />
              <HashChip
                label="Storage Tx"
                value={lastResult.storageTxHash}
                href={`${OG_EXPLORER}/tx/${lastResult.storageTxHash}`}
              />
              {lastResult.mintTxHash && (
                <HashChip
                  label="Mint Tx"
                  value={lastResult.mintTxHash}
                  href={`${OG_EXPLORER}/tx/${lastResult.mintTxHash}`}
                />
              )}
              <HashChip label="Token" value={lastResult.tokenId} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
