"use client";

import { useEffect, useState } from "react";
import HashChip from "./HashChip";

const OG_EXPLORER =
  process.env.NEXT_PUBLIC_OG_EXPLORER_URL ?? "https://chainscan.0g.ai";
const SEPOLIA_EXPLORER =
  process.env.NEXT_PUBLIC_SEPOLIA_EXPLORER_URL ?? "https://sepolia.etherscan.io";

export type StageKey =
  | "encrypt"
  | "seal"
  | "infer"
  | "anchor"
  | "mirror"
  | "commit";

export type StageState = "pending" | "running" | "done" | "skipped";

export type StageStatus = {
  state: StageState;
  /** Optional hash to show as a chip once the stage is done. */
  hash?: `0x${string}`;
  /** Optional explorer link to attach to the hash chip. */
  href?: string;
};

type Props = {
  /** Live stage map. Driven by the parent based on real progress. */
  stages: Partial<Record<StageKey, StageStatus>>;
  /** When true, mute the visual entirely (e.g. while idle before submit). */
  hidden?: boolean;
};

type StageDef = {
  key: StageKey;
  label: string;
  /** Plain-English subtitle (8–12 words). */
  caption: string;
};

const DEFAULT_STAGES: StageDef[] = [
  {
    key: "encrypt",
    label: "Encrypting in your browser",
    caption: "Your question is scrambled here — only the sealed AI can read it.",
  },
  {
    key: "commit",
    label: "Sealing the envelope · ~60s reveal window",
    caption: "Commit tx on-chain. The contract refuses the reveal until 60s have passed — a block builder can't bundle commit + reveal.",
  },
  {
    key: "seal",
    label: "Sending to the sealed AI",
    caption: "Reaches a tamper-evident chip that runs the model in isolation.",
  },
  {
    key: "infer",
    label: "AI thinking and signing",
    caption: "The model answers and signs the receipt inside the chip.",
  },
  {
    key: "anchor",
    label: "Posting to 0G blockchain",
    caption: "Receipt is written to a public, immutable ledger.",
  },
  {
    key: "mirror",
    label: "Mirroring to Ethereum (Sepolia)",
    caption: "Same receipt re-posted to Ethereum so any auditor can read it.",
  },
];

function explorerHref(key: StageKey, hash: string): string | undefined {
  if (key === "anchor") return `${OG_EXPLORER}/tx/${hash}`;
  if (key === "mirror") return `${SEPOLIA_EXPLORER}/tx/${hash}`;
  return undefined;
}

/**
 * 5/6-stage live tracker shown below an in-flight assistant turn.
 *
 * UX intent (uxofai.com "Show your work while thinking"):
 *   - Latency masking: rotate through stages so the user perceives progress.
 *   - Trust signal: every completed stage shows the actual hash that proves it ran.
 *   - Honesty: a stage only flips to "done" when there is real evidence (a hash, an
 *     attestation timestamp, etc.). Stages without evidence stay "running" — we never
 *     fabricate a tick.
 */
export default function PipelineTracker({ stages, hidden }: Props) {
  const visibleStages = DEFAULT_STAGES.filter((s) => {
    if (s.key === "commit") return stages.commit && stages.commit.state !== "skipped";
    return true;
  });

  if (hidden) return null;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-2">
        Behind the scenes
      </div>
      <ol className="space-y-1.5">
        {visibleStages.map((s, i) => {
          const status = stages[s.key]?.state ?? "pending";
          const hash = stages[s.key]?.hash;
          const href =
            stages[s.key]?.href ?? (hash ? explorerHref(s.key, hash) : undefined);
          return (
            <li key={s.key} className="flex items-start gap-2.5 text-[13px]">
              <StageDot state={status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={
                      status === "done"
                        ? "text-sage-700"
                        : status === "running"
                        ? "text-emerald-700 dark:text-emerald-300 font-medium"
                        : "text-zinc-500"
                    }
                  >
                    {s.label}
                  </span>
                  {hash && (
                    <HashChip
                      label=""
                      value={hash}
                      href={href}
                      truncate={6}
                    />
                  )}
                </div>
                {status === "running" && <RotatingHint base={s.caption} />}
              </div>
              <StepIndex index={i + 1} state={status} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StageDot({ state }: { state: StageState }) {
  // Done = "verified" semantic → Soft Sage. Running = "in flight" → Mineral
  // Blue. Pending = neutral hairline. Matches the palette's intent split.
  if (state === "done") {
    return (
      <span className="mt-0.5 inline-flex w-4 h-4 items-center justify-center rounded-full bg-sage-500 text-white text-[10px]">
        ✓
      </span>
    );
  }
  if (state === "running") {
    return (
      <span
        aria-hidden
        className="mt-0.5 inline-block w-4 h-4 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin"
      />
    );
  }
  return (
    <span className="mt-0.5 inline-block w-4 h-4 rounded-full border border-zinc-300 dark:border-zinc-700" />
  );
}

function StepIndex({ index, state }: { index: number; state: StageState }) {
  return (
    <span
      className={`text-[10px] tabular-nums shrink-0 ${
        state === "done"
          ? "text-sage-600"
          : state === "running"
          ? "text-emerald-700 dark:text-emerald-300"
          : "text-zinc-400"
      }`}
    >
      {String(index).padStart(2, "0")}
    </span>
  );
}

/**
 * Sub-caption that rotates through a small set of phrasings while a stage is
 * running. Pure visual cue that the system is doing real work; no claim is made
 * about the specific micro-step in flight.
 */
function RotatingHint({ base }: { base: string }) {
  const variants = [base, "Still working…", "Nearly there…"];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % variants.length), 1800);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="text-[11px] text-zinc-500 italic mt-0.5 transition-opacity">
      {variants[i]}
    </div>
  );
}
