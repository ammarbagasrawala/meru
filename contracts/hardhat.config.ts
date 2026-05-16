import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
const OG_RPC_URL = process.env.OG_RPC_URL ?? "https://evmrpc.0g.ai";
const GALILEO_RPC_URL = process.env.GALILEO_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "";

if (PRIVATE_KEY && !/^0x[a-fA-F0-9]{64}$/.test(PRIVATE_KEY) && !/^[a-fA-F0-9]{64}$/.test(PRIVATE_KEY)) {
  console.warn("[hardhat.config] PRIVATE_KEY does not look like a 32-byte hex string. Deploy commands will fail.");
}

const accounts = PRIVATE_KEY ? [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    aristotle: {
      url: OG_RPC_URL,
      chainId: 16661,
      accounts,
    },
    galileo: {
      url: GALILEO_RPC_URL,
      chainId: 16602,
      accounts,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      chainId: 11155111,
      accounts,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 120_000,
  },
};

export default config;
