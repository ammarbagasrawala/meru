"use client";

import { useState } from "react";

type Props = {
  label: string;
  value: string;
  href?: string;
  truncate?: number;
};

/**
 * Visible-tx-hash overlay component. Used throughout the demo per the 06e
 * "80%-skipped winning lever" — every CID / tx hash / attestation hash is
 * visible on screen, not hidden in dev tools.
 */
export default function HashChip({ label, value, href, truncate = 12 }: Props) {
  const [copied, setCopied] = useState(false);

  const display =
    value.length > truncate * 2 + 3
      ? `${value.slice(0, truncate)}…${value.slice(-truncate)}`
      : value;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="hash-chip hover:underline"
          title={value}
        >
          {display}
        </a>
      ) : (
        <button
          type="button"
          onClick={onCopy}
          className="hash-chip cursor-pointer"
          title={copied ? "Copied" : value}
        >
          {copied ? "✓ copied" : display}
        </button>
      )}
    </span>
  );
}
