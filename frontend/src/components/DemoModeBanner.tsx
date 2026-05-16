"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Icon } from "./Icon";

/**
 * DEMO MODE banner.
 *
 * Honesty surface: the TEE attestation signer in v1 is the deployer wallet
 * (`SERVER_PRIVATE_KEY`'s address), not an enclave-generated key. This is
 * the single most important "we know, you knew first" signal we can put in
 * the UI before a careful reviewer spots it on the explorer.
 *
 * Renders when NEXT_PUBLIC_DEMO_MODE === "1" (default in demo deployments).
 * Hide via NEXT_PUBLIC_DEMO_MODE="0" once Level 3 is wired (enclave-generated
 * TEE signer registered on-chain).
 *
 * Dismissible per-session — once you've acknowledged the banner, it gets
 * out of your way and stays out until the tab is closed. Acknowledgement
 * lives in `sessionStorage`, not `localStorage`, because we want every new
 * tab to see the banner once.
 *
 * SSR-safe dismissal: initial state is a deterministic `false` so the server
 * and the client's first render emit the same DOM (server can't see
 * sessionStorage). The previously-dismissed flag is then read in `useEffect`
 * after mount, which triggers a follow-up render that hides the banner.
 * This is the standard React pattern for client-only state in SSR pages.
 */
const STORAGE_KEY = "meru:demo-banner:dismissed";

export default function DemoModeBanner() {
  const enabled = (process.env.NEXT_PUBLIC_DEMO_MODE ?? "1") === "1";
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === "1") {
        setDismissed(true);
      }
    } catch {
      /* sessionStorage unavailable in some privacy modes — non-fatal. */
    }
  }, []);

  if (!enabled || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* sessionStorage unavailable in some privacy modes — non-fatal. */
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 px-4 py-2 border-b border-amber-200 text-[12px]"
      style={{ background: "var(--warning-soft)" }}
    >
      <span
        aria-hidden
        className="shrink-0 mt-0.5"
        style={{ color: "var(--warning-strong)" }}
      >
        <Icon as={AlertTriangle} size={14} strokeWidth={1.8} />
      </span>
      <div className="flex-1 leading-relaxed" style={{ color: "var(--warning-strong)" }}>
        <span className="font-semibold">Demo mode.</span>{" "}
        Until Level 3 deploys, the TEE attestation signer is the deployer wallet
        — not an enclave-generated key. The bundle is signed; the *signer* is a placeholder.{" "}
        <a
          href={
            process.env.NEXT_PUBLIC_GITHUB_REPO_URL
              ? `${process.env.NEXT_PUBLIC_GITHUB_REPO_URL.replace(/\/$/, "")}/blob/main/THREAT-MODEL.md#tee-attestation-signer-bootstrap`
              : "https://github.com/ammarbagasrawala/meru/blob/main/THREAT-MODEL.md#tee-attestation-signer-bootstrap"
          }
          className="underline decoration-dotted underline-offset-2 hover:text-zinc-900"
          target="_blank"
          rel="noopener noreferrer"
        >
          Why & v2 plan ↗
        </a>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss demo banner"
        className="shrink-0 p-0.5 rounded hover:bg-amber-100 transition-colors"
        style={{ color: "var(--warning-strong)" }}
      >
        <Icon as={X} size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}
