import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import type { Chain } from "viem";
import { injected } from "wagmi/connectors";

// 0G Aristotle mainnet — the production chain Meru anchors to.
export const aristotle: Chain = {
  id: 16661,
  name: "0G Aristotle",
  nativeCurrency: { name: "OG", symbol: "OG", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc.0g.ai"] } },
  blockExplorers: {
    default: { name: "Chainscan", url: "https://chainscan.0g.ai" },
  },
};

// 0G Galileo testnet — dev / demo footage chain. Faucet'able, deterministic
// chainId matches the official 0G docs (confirmed via eth_chainId probe 14 May 2026:
// returns 0x40da = 16602; thirdweb's listing of 16601 is stale).
export const galileo: Chain = {
  id: 16602,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "OG", symbol: "OG", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc-testnet.0g.ai"] } },
  blockExplorers: {
    default: { name: "Chainscan Galileo", url: "https://chainscan-galileo.0g.ai" },
  },
  testnet: true,
};

/**
 * The currently-active 0G chain for the UI's network-mismatch banner and
 * the auto-add path. Switches based on NEXT_PUBLIC_OG_CHAIN_ID: 16602 = Galileo,
 * anything else (default 16661) = Aristotle.
 *
 * Recordings of the demo happen against Galileo (free OG via faucet); the final
 * submission deploy lives on Aristotle. Toggle this env var when switching.
 */
const activeChainId = Number(process.env.NEXT_PUBLIC_OG_CHAIN_ID ?? 16661);
export const activeOgChain: Chain = activeChainId === 16602 ? galileo : aristotle;

export const wagmiConfig = createConfig({
  chains: [aristotle, galileo, sepolia],
  connectors: [injected()],
  transports: {
    [aristotle.id]: http(),
    [galileo.id]: http(),
    [sepolia.id]: http(),
  },
  ssr: true,
});
