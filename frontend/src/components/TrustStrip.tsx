"use client";

const OG_EXPLORER =
  process.env.NEXT_PUBLIC_OG_EXPLORER_URL ?? "https://chainscan.0g.ai";
const PROVENANT_ADDR = (process.env.NEXT_PUBLIC_PROVENANT_ADDRESS ?? "") as
  | ""
  | `0x${string}`;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Status row across the top of every authenticated page.
 *
 * Apple/Safari register: the URL bar tells you what's true *right now*,
 * with one sentence + a status dot + a link to verify. No marketing pills.
 *
 * Shows:
 *   • a single sage dot for "connected"
 *   • the network name + chain id
 *   • the deployed contract address as a clickable mono identifier
 *
 * Phishing defence: the contract address is rendered with `tabular-nums`
 * and the same monospace as our HashChip, so an auditor can compare against
 * Chainscan in one glance.
 */
export default function TrustStrip() {
  const validAddr = PROVENANT_ADDR && ADDRESS_RE.test(PROVENANT_ADDR);
  const short = validAddr
    ? `${PROVENANT_ADDR.slice(0, 6)}…${PROVENANT_ADDR.slice(-4)}`
    : null;

  return (
    <div className="hidden md:flex items-center justify-between px-5 h-9 text-[11.5px] border-b border-zinc-200" style={{ background: "color-mix(in srgb, var(--paper) 70%, white)" }}>
      <div className="flex items-center gap-2 text-zinc-600">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full bg-sage-500 shrink-0"
        />
        <span className="font-medium text-zinc-700">Connected</span>
        <span className="text-zinc-400" aria-hidden>·</span>
        <span>0G Aristotle mainnet</span>
        <span className="text-zinc-400 tabular" aria-hidden>·</span>
        <span className="tabular text-zinc-500">chain 16661</span>
      </div>
      {short && (
        <a
          href={`${OG_EXPLORER}/address/${PROVENANT_ADDR}`}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open ${PROVENANT_ADDR} on Chainscan`}
          className="group inline-flex items-center gap-1.5 text-zinc-600 hover:text-zinc-900 transition-colors"
        >
          <span className="text-zinc-500">Contract</span>
          <code className="hash-chip">{short}</code>
          <span
            aria-hidden
            className="text-zinc-400 group-hover:text-zinc-700 transition-colors"
          >
            ↗
          </span>
        </a>
      )}
    </div>
  );
}
