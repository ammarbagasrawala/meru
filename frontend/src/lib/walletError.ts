/**
 * Map wagmi / viem errors to plain-English copy.
 *
 * UX intent (austinwerner.io + artkai.io patterns): users should never see a hex
 * error code or a developer-centric exception string. The wallet flow is the most
 * jargon-dense surface in a Web3 app — give the user a sentence and a verb, not a
 * stack trace.
 *
 * Honesty rule: if we can't classify the error confidently, return a generic
 * "Something went wrong" line + the raw message as a "Details" affordance. Do not
 * fabricate a more reassuring story than reality.
 */
export type FriendlyWalletError = {
  title: string;
  body: string;
  /** Optional, raw message to surface behind a "Details" disclosure for the curious. */
  raw?: string;
};

const REJECTED_CODES = new Set([4001, "ACTION_REJECTED", "USER_REJECTED_REQUEST"]);
const INSUFFICIENT_FUNDS_CODES = new Set([
  "INSUFFICIENT_FUNDS",
  -32000, // some RPCs return this for insufficient funds
]);
const NETWORK_CODES = new Set([
  "NETWORK_ERROR",
  "TIMEOUT",
  "SERVER_ERROR",
  -32603,
]);
const CHAIN_MISMATCH_CODES = new Set([
  4902, // EIP-3085 — chain not added
  "CHAIN_DISCONNECTED",
]);

type WithCode = { code?: unknown; shortMessage?: unknown; message?: unknown };

function pickCode(err: unknown): string | number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as WithCode;
  if (typeof e.code === "string" || typeof e.code === "number") return e.code;
  return undefined;
}

function pickMessage(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as WithCode;
    if (typeof e.shortMessage === "string") return e.shortMessage;
    if (typeof e.message === "string") return e.message;
  }
  return String(err);
}

export function friendlyWalletError(err: unknown): FriendlyWalletError {
  const code = pickCode(err);
  const raw = pickMessage(err);
  const lower = raw.toLowerCase();

  // Heuristic match — viem/wagmi nest error info in `cause`, so check the message text too.
  if (code !== undefined && REJECTED_CODES.has(code as never)) {
    return {
      title: "Wallet popup cancelled",
      body: "Looks like you closed the wallet without confirming. Click again whenever you're ready.",
      raw,
    };
  }
  if (lower.includes("user rejected") || lower.includes("user denied")) {
    return {
      title: "Wallet popup cancelled",
      body: "Looks like you closed the wallet without confirming. Click again whenever you're ready.",
      raw,
    };
  }
  if (
    (code !== undefined && INSUFFICIENT_FUNDS_CODES.has(code as never)) ||
    lower.includes("insufficient funds")
  ) {
    return {
      title: "Not enough OG for gas",
      body: "Your wallet doesn't have enough 0G to pay the network fee for this action.",
      raw,
    };
  }
  if (
    (code !== undefined && CHAIN_MISMATCH_CODES.has(code as never)) ||
    lower.includes("unrecognized chain") ||
    lower.includes("chain not configured")
  ) {
    return {
      title: "0G Aristotle isn't in your wallet yet",
      body: "Your wallet doesn't know about 0G's chain. We'll try to add it for you on the next click.",
      raw,
    };
  }
  if (
    (code !== undefined && NETWORK_CODES.has(code as never)) ||
    lower.includes("fetch failed") ||
    lower.includes("network request failed") ||
    lower.includes("timeout")
  ) {
    return {
      title: "Couldn't reach the network",
      body: "We couldn't get a response from the chain right now. Check your connection and retry.",
      raw,
    };
  }
  if (
    lower.includes("no injected") ||
    lower.includes("connector not found") ||
    lower.includes("provider not found") ||
    lower.includes("no ethereum provider")
  ) {
    return {
      title: "No wallet detected in this browser",
      body:
        "We couldn't find a wallet extension (MetaMask / Rabby / Coinbase Wallet) in this tab. " +
        "Most common causes: (1) MetaMask isn't installed — get it at metamask.io/download, " +
        "(2) you're in an incognito window where extensions are disabled — switch to a normal window or " +
        "enable MetaMask in incognito via the extensions menu, (3) MetaMask is disabled in chrome://extensions. " +
        "After fixing, refresh this page.",
      raw,
    };
  }
  return {
    title: "Something went wrong",
    body: "The wallet didn't complete that action. Try again — if it keeps happening, copy the details below.",
    raw,
  };
}
