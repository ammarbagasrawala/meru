"use client";

import { useState } from "react";
import { postQuery, QueryResponse } from "@/lib/api";
import { encryptQueryForEnclave, enclavePubKeyAvailable } from "@/lib/encryptQuery";

type Props = {
  tokenId: string;
  onAnswer: (r: QueryResponse, encryptedIntent: boolean) => void;
};

const ENCLAVE_PUBKEY = process.env.NEXT_PUBLIC_ENCLAVE_X25519_PUBLIC_KEY ?? "";

export default function QueryBox({ tokenId, onAnswer }: Props) {
  const [question, setQuestion] = useState("");
  const [encrypt, setEncrypt] = useState<boolean>(enclavePubKeyAvailable());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const q = question.trim();
    if (q.length === 0) return;
    if (q.length > 4000) {
      setError("Question is too long (max 4000 chars).");
      return;
    }

    setBusy(true);
    try {
      if (encrypt && enclavePubKeyAvailable()) {
        const eq = await encryptQueryForEnclave(q, ENCLAVE_PUBKEY);
        const result = await postQuery({
          tokenId,
          encryptedQuery: eq,
        });
        onAnswer(result, true);
      } else {
        const result = await postQuery({
          tokenId,
          questionPlaintext: q,
        });
        onAnswer(result, false);
      }
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "query_failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value.slice(0, 4000))}
        placeholder="Ask the corpus a question, e.g. What's the refund policy for premier customers?"
        rows={3}
        className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        disabled={busy}
      />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <label className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
          <input
            type="checkbox"
            checked={encrypt}
            onChange={(e) => setEncrypt(e.target.checked)}
            disabled={!enclavePubKeyAvailable() || busy}
            className="accent-emerald-600"
          />
          Encrypt this question client-side (X25519 → AES-GCM into the TEE)
          {!enclavePubKeyAvailable() && (
            <span className="text-amber-700 dark:text-amber-400 ml-1">
              · enclave key not configured
            </span>
          )}
        </label>
        <button
          type="submit"
          disabled={busy || question.trim().length === 0}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
    </form>
  );
}
