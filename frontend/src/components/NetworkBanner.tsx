"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { activeOgChain } from "@/lib/wagmi";
import { useToast } from "./Toast";
import { friendlyWalletError } from "@/lib/walletError";

/**
 * Global "Wrong network" banner.
 *
 * UX intent (LinkedIn — Aave network-badge example; purrweb — multi-chain
 * confusion is "the #1 abandonment driver"): if the wallet is connected but
 * pointed at the wrong chain, every page must surface the mismatch with a
 * one-click fix. Network state is too easy to miss as a stand-alone control.
 */
export default function NetworkBanner() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();
  const toast = useToast();

  // Hide when not connected or already on the right chain.
  if (!isConnected) return null;
  if (chainId === activeOgChain.id) return null;

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
        onSuccess: () => {
          toast.push({
            kind: "success",
            title: `Connected to ${activeOgChain.name}`,
            body: "Your wallet is now on the right network.",
          });
        },
      }
    );
  };

  return (
    <div
      role="alert"
      className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-300 dark:border-amber-900 px-4 py-2 flex items-center justify-between gap-3 flex-wrap"
    >
      <div className="flex items-start gap-2 min-w-0">
        <span aria-hidden className="text-amber-700 mt-0.5">
          ⚠
        </span>
        <div className="text-xs text-amber-900 dark:text-amber-200 leading-snug min-w-0">
          <span className="font-semibold">Wrong network.</span>{" "}
          Your wallet is on chain {chainId}; Meru runs on {activeOgChain.name} (chain {activeOgChain.id}).
        </div>
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={handleSwitch}
        className="rounded-md bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold px-2.5 py-1.5 shrink-0"
      >
        {isPending ? "Switching…" : `Switch to ${activeOgChain.name}`}
      </button>
    </div>
  );
}
