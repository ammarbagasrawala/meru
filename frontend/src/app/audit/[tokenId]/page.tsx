"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchAudit,
  fetchAuditFromIndexer,
  indexerConfigured,
  AuditResponse,
  IndexerInferenceRow,
} from "@/lib/api";
import HashChip from "@/components/HashChip";

const OG_EXPLORER =
  process.env.NEXT_PUBLIC_OG_EXPLORER_URL ?? "https://chainscan.0g.ai";

type Source = "backend" | "indexer";

export default function AuditPage({
  params,
}: {
  params: Promise<{ tokenId: string }>;
}) {
  const { tokenId } = use(params);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [indexerRows, setIndexerRows] = useState<IndexerInferenceRow[] | null>(null);
  const [source, setSource] = useState<Source>("backend");
  const [error, setError] = useState<string | null>(null);
  const [indexerError, setIndexerError] = useState<string | null>(null);

  const indexerAvailable = indexerConfigured();

  useEffect(() => {
    fetchAudit(tokenId)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "load_failed"));
  }, [tokenId]);

  useEffect(() => {
    if (source !== "indexer" || !indexerAvailable) return;
    if (indexerRows !== null) return;
    fetchAuditFromIndexer(tokenId)
      .then((rows) => setIndexerRows(rows ?? []))
      .catch((err) =>
        setIndexerError(err instanceof Error ? err.message : "indexer_load_failed")
      );
  }, [source, tokenId, indexerAvailable, indexerRows]);

  const eventCount =
    source === "indexer"
      ? indexerRows?.length ?? null
      : data?.events.length ?? null;
  const lastSeen =
    source === "indexer"
      ? indexerRows?.[indexerRows.length - 1]?.eventTimestamp
      : data?.lastInferenceAt;

  return (
    <main className="flex-1 max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">
            Public audit log · no login required
          </div>
          <h1 className="text-2xl font-semibold mt-0.5 tracking-tight">Corpus #{tokenId}</h1>
          {data?.stub && (
            <p className="text-xs text-amber-700 mt-1">Stub mode — connect to 0G mainnet for live data.</p>
          )}
        </div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← Home
        </Link>
      </div>

      {eventCount !== null && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6 max-w-2xl">
          {eventCount === 0
            ? "No inferences logged yet. Ask the AI a question and the receipt will appear here."
            : `${eventCount} ${eventCount === 1 ? "inference" : "inferences"} on record${
                lastSeen
                  ? `, last one ${friendlyAgo(lastSeen)}`
                  : ""
              }. Every row was signed by the sealed AI and posted to a public ledger — you can verify it without trusting us.`}
        </p>
      )}

      <div className="mb-4 flex items-center gap-2 text-xs">
        <span className="text-zinc-500">Source:</span>
        <button
          type="button"
          onClick={() => setSource("backend")}
          className={`px-2 py-1 rounded border ${
            source === "backend"
              ? "bg-emerald-600 text-white border-emerald-600"
              : "border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300"
          }`}
        >
          Backend (Express)
        </button>
        <button
          type="button"
          onClick={() => setSource("indexer")}
          disabled={!indexerAvailable}
          title={
            indexerAvailable
              ? "Read the same log via the Meru indexer (JSON-RPC 2.0)"
              : "Set NEXT_PUBLIC_INDEXER_URL to enable"
          }
          className={`px-2 py-1 rounded border ${
            source === "indexer"
              ? "bg-emerald-600 text-white border-emerald-600"
              : "border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300"
          } ${!indexerAvailable ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          Indexer (JSON-RPC)
        </button>
        {source === "indexer" && indexerAvailable && (
          <span className="text-zinc-500">
            ← Same TEE-signed bundle, served by a third party. Indexer can re-order or omit but cannot forge.
          </span>
        )}
      </div>

      {error && source === "backend" && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          Couldn&apos;t load audit log: {error}
        </div>
      )}
      {indexerError && source === "indexer" && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          Indexer query failed: {indexerError}
        </div>
      )}

      {data && (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <Card label="Corpus root (CID)" value={data.rootBlobHash ?? "(stub)"} />
            <Card label="TEE attestation signer" value={data.teeAttestationSigner ?? "(stub)"} />
            <Card
              label="Last inference"
              value={
                data.lastInferenceAt
                  ? new Date(data.lastInferenceAt * 1000).toLocaleString()
                  : "—"
              }
            />
          </section>

          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900/50 text-[10px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="text-left px-4 py-2.5">#</th>
                  <th className="text-left px-4 py-2.5">When</th>
                  <th className="text-left px-4 py-2.5">Question hash</th>
                  <th className="text-left px-4 py-2.5">Bundle hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {source === "backend" && data.events.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                      No inferences logged yet.
                    </td>
                  </tr>
                )}
                {source === "backend" &&
                  data.events.map((e) => (
                    <tr key={`b-${e.index}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                      <td className="px-4 py-2.5 align-top text-zinc-500 text-xs">
                        {e.index}
                      </td>
                      <td className="px-4 py-2.5 align-top text-xs">
                        {new Date(e.timestamp * 1000).toISOString()}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <HashChip label="" value={e.questionHash} truncate={10} />
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <HashChip label="" value={e.bundleHash} truncate={10} />
                      </td>
                    </tr>
                  ))}
                {source === "indexer" && indexerRows === null && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                      Loading from indexer JSON-RPC…
                    </td>
                  </tr>
                )}
                {source === "indexer" && indexerRows !== null && indexerRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                      Indexer has not seen any inferences for this corpus yet.
                    </td>
                  </tr>
                )}
                {source === "indexer" &&
                  indexerRows?.map((r, i) => (
                    <tr
                      key={`i-${r.blockNumber}-${r.logIndex}`}
                      className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                    >
                      <td className="px-4 py-2.5 align-top text-zinc-500 text-xs">
                        {i}
                      </td>
                      <td className="px-4 py-2.5 align-top text-xs">
                        {safeIsoTimestamp(r.eventTimestamp)}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <HashChip label="" value={r.questionHash} truncate={10} />
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <HashChip label="" value={r.bundleHash} truncate={10} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>

          <p className="mt-4 text-xs text-zinc-500">
            Every row is anchored on 0G Aristotle. Click any hash to copy it; cross-reference against{" "}
            <a href={OG_EXPLORER} className="underline hover:text-emerald-600" target="_blank" rel="noopener noreferrer">
              chainscan.0g.ai
            </a>{" "}
            or the Sepolia mirror — both should show the same{" "}
            <code>bundleHash</code>.
          </p>
        </>
      )}
    </main>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">
        {label}
      </div>
      <div className="text-xs mt-1 font-mono break-all">{value}</div>
    </div>
  );
}

function friendlyAgo(unixSeconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

function safeIsoTimestamp(unixSeconds: number | undefined | null): string {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds)) {
    return "—";
  }
  const ms = unixSeconds * 1000;
  if (ms < 0 || ms > 8.64e15) return "—"; // outside RFC 9557 range
  try {
    return new Date(ms).toISOString();
  } catch {
    return "—";
  }
}
