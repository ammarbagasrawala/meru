"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { activeOgChain } from "@/lib/wagmi";
import { useToast } from "./Toast";
import { friendlyWalletError } from "@/lib/walletError";

const OG_EXPLORER =
  process.env.NEXT_PUBLIC_OG_EXPLORER_URL ?? "https://chainscan.0g.ai";

/**
 * Wallet connect / network-switch button.
 *
 * Blockchain-UX patterns applied (artkai.io, austinwerner.io, LinkedIn):
 *   - Plain-language error toasts (no error codes leak to the user).
 *   - Address copy + explorer link on the connected dropdown.
 *   - Chain ID visible (small, secondary) for power users; plain-language primary copy.
 *
 * Security notes:
 *   - `useAccount` / `useChainId` are read-only.
 *   - The address is held in wagmi's in-memory state — we do not persist it.
 *   - Copy uses `navigator.clipboard`; never logs the address.
 */
export default function ConnectButton() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connect, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  // Avoid SSR/hydration mismatch — render a stable placeholder before first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const injected = useMemo(
    () => connectors.find((c) => c.id === "injected") ?? connectors[0],
    [connectors]
  );

  const handleConnect = () => {
    if (!injected) return;
    connect(
      { connector: injected },
      {
        onError: (err) => {
          const friendly = friendlyWalletError(err);
          toast.push({
            kind: "error",
            title: friendly.title,
            body: friendly.body,
            raw: friendly.raw,
          });
        },
      }
    );
  };

  const handleSwitch = () => {
    switchChain(
      { chainId: activeOgChain.id },
      {
        onError: (err) => {
          const friendly = friendlyWalletError(err);
          toast.push({
            kind: "error",
            title: friendly.title,
            body: friendly.body,
            raw: friendly.raw,
          });
        },
      }
    );
  };

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.push({
        kind: "warn",
        title: "Couldn't copy",
        body: "Your browser blocked clipboard access. You can still select and copy manually.",
      });
    }
  };

  if (!mounted) {
    return (
      <button
        type="button"
        disabled
        className="rounded-lg px-4 py-2 text-[13px] font-medium text-white opacity-50"
        style={{ background: "var(--ink)" }}
        aria-hidden
      >
        Connect wallet
      </button>
    );
  }

  if (!isConnected) {
    return (
      <button
        type="button"
        disabled={connecting || !injected}
        onClick={handleConnect}
        className="rounded-lg px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity w-full"
        style={{ background: "var(--ink)" }}
      >
        {connecting ? "Connecting…" : injected ? "Connect wallet" : "No wallet found"}
      </button>
    );
  }

  if (chainId !== activeOgChain.id) {
    return (
      <button
        type="button"
        disabled={switching}
        onClick={handleSwitch}
        className="rounded-lg px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity w-full"
        style={{ background: "var(--warning-strong)" }}
      >
        {switching ? "Switching…" : `Switch to ${activeOgChain.name}`}
      </button>
    );
  }

  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";

  return (
    <div className="relative inline-block w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[12.5px] font-mono text-zinc-700 hover:border-zinc-300 transition-colors flex items-center gap-1.5 w-full"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-sage-500" />
        <span>{short}</span>
      </button>
      {open && (
        <div
          role="menu"
          // Opens UPWARD from the button (bottom-full + mb-2). The button
          // lives in the sidebar footer, near the bottom of the viewport;
          // a downward-opening menu would clip off-screen. left-0 left-aligns
          // with the button (sidebar is narrow, so right-aligning would push
          // off the right edge into the main content area).
          className="absolute bottom-full left-0 mb-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg bg-white border border-zinc-200 shadow-[0_8px_32px_0_rgba(31,41,55,0.10)] z-50 overflow-hidden"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">
              Connected · {activeOgChain.name} (chain {activeOgChain.id})
            </div>
            <div className="text-[11px] font-mono mt-1 break-all text-zinc-700 dark:text-zinc-300">
              {address}
            </div>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="w-full text-left px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-between"
            role="menuitem"
          >
            <span>Copy address</span>
            {copied && <span className="text-[10px] text-sage-700">copied</span>}
          </button>
          {address && (
            <a
              href={`${OG_EXPLORER}/address/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              View on Chainscan ↗
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              disconnect();
              setOpen(false);
              toast.push({
                kind: "info",
                title: "Wallet disconnected",
                body: "You can reconnect anytime from the top-right.",
              });
            }}
            className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 border-t border-zinc-200 dark:border-zinc-800"
            role="menuitem"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
