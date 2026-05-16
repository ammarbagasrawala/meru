import {
  Contract,
  ContractTransactionResponse,
  JsonRpcProvider,
  Wallet,
} from "ethers"; // v6 (peer of @0glabs/0g-ts-sdk)
import { config } from "../config";

/**
 * ethers v6 client factory. The 0G TS SDK 0.3.x requires ethers v6 as a peer dep, so the whole
 * backend uses v6 — no v5/v6 island needed.
 *
 * Typed contract wrappers below give us strict static typing on every call site, avoiding the
 * ethers v6 + `noUncheckedIndexedAccess` issue where Contract methods are typed as undefined.
 */

let aristotleProvider: JsonRpcProvider | null = null;
let sepoliaProvider: JsonRpcProvider | null = null;

export function getAristotleProvider(): JsonRpcProvider {
  if (aristotleProvider) return aristotleProvider;
  aristotleProvider = new JsonRpcProvider(config.OG_RPC_URL, {
    chainId: config.OG_CHAIN_ID,
    name: "aristotle",
  });
  return aristotleProvider;
}

export function getSepoliaProvider(): JsonRpcProvider {
  if (sepoliaProvider) return sepoliaProvider;
  if (!config.SEPOLIA_RPC_URL) {
    throw new Error("sepolia_rpc_url_missing");
  }
  sepoliaProvider = new JsonRpcProvider(config.SEPOLIA_RPC_URL, {
    chainId: 11155111,
    name: "sepolia",
  });
  return sepoliaProvider;
}

export function getServerSigner(provider: JsonRpcProvider): Wallet {
  if (!config.SERVER_PRIVATE_KEY) {
    throw new Error("server_private_key_missing");
  }
  const key = config.SERVER_PRIVATE_KEY.startsWith("0x")
    ? config.SERVER_PRIVATE_KEY
    : `0x${config.SERVER_PRIVATE_KEY}`;
  return new Wallet(key, provider);
}

/** Minimal ABI for the calls the backend actually makes. */
export const PROVENANT_ABI = [
  "function mint(bytes32 rootBlobHash, address teeAttestationSigner) external returns (uint256 tokenId)",
  "function logInference(uint256 tokenId, bytes32 questionHash, bytes32 bundleHash, uint64 enclaveTimestamp, bytes teeSignature) external",
  "function commitInference(bytes32 commitHash) external",
  "function revealAndLogInference(bytes32 commitHash, uint256 tokenId, bytes32 questionHash, bytes32 bundleHash, uint64 enclaveTimestamp, bytes teeSignature) external",
  "function commitRegisteredAt(bytes32 commitHash) view returns (uint64)",
  "function corpusOf(uint256 tokenId) view returns (tuple(bytes32 rootBlobHash, address teeAttestationSigner, uint64 issuedAt, uint64 lastInferenceAt))",
  "function inferenceCountOf(uint256 tokenId) view returns (uint256)",
  "function inferenceAt(uint256 tokenId, uint256 index) view returns (tuple(bytes32 questionHash, bytes32 bundleHash, uint64 timestamp))",
  "event CorpusMinted(uint256 indexed tokenId, address indexed owner, bytes32 rootBlobHash, address teeAttestationSigner)",
  "event InferenceLogged(uint256 indexed tokenId, bytes32 indexed bundleHash, bytes32 questionHash, uint64 timestamp)",
  "event InferenceCommitted(bytes32 indexed commitHash, uint64 timestamp)",
  "event InferenceRevealed(bytes32 indexed commitHash, uint256 indexed tokenId, bytes32 bundleHash)",
] as const;

export const PROVENANT_READER_ABI = [
  "function mirror(bytes32 bundleHash, bytes32 originTxHash, uint256 originChainId, uint64 enclaveTimestamp, bytes teeSignature) external",
  "function isMirrored(bytes32 bundleHash) view returns (bool)",
  "event Mirrored(bytes32 indexed bundleHash, bytes32 originTxHash, uint256 indexed originChainId, uint64 enclaveTimestamp, uint64 mirroredAt)",
] as const;

// ──────────────────────────────────────────────────────────────────
// Typed contract shapes — for strict TS at every call site
// ──────────────────────────────────────────────────────────────────

export type Corpus = {
  rootBlobHash: string;
  teeAttestationSigner: string;
  issuedAt: bigint;
  lastInferenceAt: bigint;
};

export type InferenceEvent = {
  questionHash: string;
  bundleHash: string;
  timestamp: bigint;
};

/**
 * Strongly-typed contract shapes via intersection (not extension) — avoids the
 * `Contract` index-signature clash. The `Contract` base provides .runner / .target / etc.;
 * the intersection adds the methods we actually call.
 */
type ProvenantMethods = {
  mint: (
    rootBlobHash: string,
    teeAttestationSigner: string
  ) => Promise<ContractTransactionResponse>;
  logInference: (
    tokenId: bigint,
    questionHash: string,
    bundleHash: string,
    enclaveTimestamp: number,
    teeSignature: string
  ) => Promise<ContractTransactionResponse>;
  commitInference: (commitHash: string) => Promise<ContractTransactionResponse>;
  revealAndLogInference: (
    commitHash: string,
    tokenId: bigint,
    questionHash: string,
    bundleHash: string,
    enclaveTimestamp: number,
    teeSignature: string
  ) => Promise<ContractTransactionResponse>;
  commitRegisteredAt: (commitHash: string) => Promise<bigint>;
  corpusOf: (tokenId: bigint) => Promise<Corpus>;
  inferenceCountOf: (tokenId: bigint) => Promise<bigint>;
  inferenceAt: (tokenId: bigint, index: number | bigint) => Promise<InferenceEvent>;
};

type ProvenantReaderMethods = {
  mirror: (
    bundleHash: string,
    originTxHash: string,
    originChainId: number | bigint,
    enclaveTimestamp: number,
    teeSignature: string
  ) => Promise<ContractTransactionResponse>;
  isMirrored: (bundleHash: string) => Promise<boolean>;
};

export type ProvenantContract = Contract & ProvenantMethods;
export type ProvenantReaderContract = Contract & ProvenantReaderMethods;

export function getProvenantContract(runner: JsonRpcProvider | Wallet): ProvenantContract {
  if (!config.PROVENANT_CONTRACT_ADDRESS) {
    throw new Error("provenant_contract_address_missing");
  }
  const c = new Contract(config.PROVENANT_CONTRACT_ADDRESS, [...PROVENANT_ABI], runner);
  return c as unknown as ProvenantContract;
}

export function getProvenantReaderContract(
  runner: JsonRpcProvider | Wallet
): ProvenantReaderContract {
  if (!config.PROVENANT_READER_ADDRESS) {
    throw new Error("provenant_reader_address_missing");
  }
  const c = new Contract(
    config.PROVENANT_READER_ADDRESS,
    [...PROVENANT_READER_ABI],
    runner
  );
  return c as unknown as ProvenantReaderContract;
}
