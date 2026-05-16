"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip } from "lucide-react";
import { enclavePubKeyAvailable } from "@/lib/encryptQuery";
import { Icon } from "./Icon";
import Tooltip from "./Tooltip";

type Props = {
  onSubmit: (
    question: string,
    encrypt: boolean,
    mev: "off" | "commit-reveal"
  ) => Promise<void>;
  onFile?: (file: File) => Promise<void>;
  disabled?: boolean;
  acceptsFile?: boolean;
  placeholder?: string;
  attachmentHint?: string;
};

/**
 * ChatGPT-style composer: rounded textarea with an attach (+) button on the left and a
 * send button on the right. Auto-grows up to ~10 lines. Cmd/Ctrl+Enter sends.
 */
export default function Composer({
  onSubmit,
  onFile,
  disabled,
  acceptsFile = true,
  placeholder = "Ask anything about this corpus…",
  attachmentHint,
}: Props) {
  const [text, setText] = useState("");
  const [encrypt, setEncrypt] = useState<boolean>(enclavePubKeyAvailable());
  const [mev, setMev] = useState<"off" | "commit-reveal">("off");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ta.current) return;
    ta.current.style.height = "0px";
    const lh = 24; // ~ line height
    const min = lh * 1.5;
    const max = lh * 10;
    ta.current.style.height = `${Math.max(min, Math.min(max, ta.current.scrollHeight))}px`;
  }, [text]);

  const send = async () => {
    const q = text.trim();
    if (!q || busy || disabled) return;
    if (q.length > 4000) {
      setError("Question is too long (max 4000 chars).");
      return;
    }
    setError(null);
    setBusy(true);
    // Optimistic clear: the parent immediately renders the typed message as a
    // user-question turn in the thread, so the textbox can empty right away
    // (standard chat UX). Otherwise the input stays full for the full duration
    // of the pipeline — seal + commit-reveal can take 5-30+ seconds — and the
    // user perceives the send as broken. If onSubmit throws, we restore the
    // text so the user can retry without losing their input.
    setText("");
    try {
      await onSubmit(q, encrypt, mev);
    } catch (err) {
      setError(err instanceof Error ? err.message : "send_failed");
      setText(q); // restore on failure
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  };

  const pickFile = async (f: File) => {
    if (!onFile) return;
    setError(null);
    setBusy(true);
    try {
      await onFile(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload_failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full">
      <div
        className={`rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(31,41,55,0.04),0_4px_12px_rgba(31,41,55,0.04)] focus-within:border-zinc-400 transition-colors ${
          busy ? "opacity-90" : ""
        }`}
      >
        <div className="flex items-end gap-2 px-3 py-2">
          {acceptsFile && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pickFile(f);
                  if (fileInput.current) fileInput.current.value = "";
                }}
              />
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => fileInput.current?.click()}
                className="p-2 rounded-full text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 transition-colors"
                aria-label="Attach a document"
                title="Attach a PDF / JPG / PNG (≤ 5 MB)"
              >
                <Icon as={Paperclip} size={18} />
              </button>
            </>
          )}

          <textarea
            ref={ta}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 4000))}
            onKeyDown={onKey}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            style={{ color: "var(--ink)", caretColor: "var(--ink)" }}
            className="flex-1 bg-transparent resize-none border-0 outline-none px-1 py-2 text-[15px] placeholder:text-zinc-400 disabled:opacity-50"
            aria-label="Ask Meru"
          />

          <button
            type="button"
            disabled={disabled || busy || text.trim().length === 0}
            onClick={() => void send()}
            style={{
              background:
                disabled || busy || text.trim().length === 0
                  ? "var(--hairline)"
                  : "var(--ink)",
            }}
            className="p-2 rounded-full text-white disabled:cursor-not-allowed transition-colors"
            aria-label="Send"
            title="Send (⌘/Ctrl + Enter)"
          >
            <Icon as={ArrowUp} size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2 px-3 pb-2 text-[11px] text-zinc-500">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={encrypt}
                onChange={(e) => setEncrypt(e.target.checked)}
                disabled={!enclavePubKeyAvailable() || busy}
                className="accent-emerald-600"
              />
              <span>
                Encrypt my question in transit
                {" "}
                <Tooltip text="X25519 → AES-256-GCM in the browser. Today: backend decrypts before forwarding (bridge mode). v2: enclave-only decryption — see THREAT-MODEL.md.">
                  (encrypted intent · bridge mode)
                </Tooltip>
                {!enclavePubKeyAvailable() && (
                  <span className="text-amber-700">
                    {" "}
                    · enclave key not configured
                  </span>
                )}
              </span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={mev === "commit-reveal"}
                onChange={(e) => setMev(e.target.checked ? "commit-reveal" : "off")}
                disabled={busy}
                className="accent-emerald-600"
              />
              <span>
                On-chain commit-reveal
                {" "}
                <Tooltip text="Two-tx anchor: commitInference posts a hash; the contract enforces a 60s gap; revealAndLogInference then anchors the bundle. Threshold-keyper integration is v2 scaffold (see backend/src/mev/shutter.ts).">
                  (60s reveal window)
                </Tooltip>
              </span>
            </label>
          </div>
          <div className="flex items-center gap-2">
            {attachmentHint && <span>{attachmentHint}</span>}
            <span className="hidden sm:inline text-zinc-400">⌘ + Enter to send</span>
          </div>
        </div>
      </div>

      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
    </div>
  );
}
