import { AbiCoder, Wallet, getBytes, keccak256 } from "ethers";
import { config, sepoliaMirrorReady } from "../config";
import {
  getProvenantReaderContract,
  getSepoliaProvider,
  getServerSigner,
} from "../chain/client";
import { log } from "../middleware/error";

/**
 * Re-attest a Provenant InferenceLogged event onto Sepolia via ProvenantReader.sol.
 *
 * Important: ProvenantReader.sol verifies a DIFFERENT digest than Provenant.sol does:
 *   - Aristotle anchor digest: keccak256(tokenId, questionHash, bundleHash, ts, chainId=16661, provenantAddr)
 *   - Sepolia mirror digest:  keccak256(bundleHash, originTxHash, originChainId, ts, chainId=11155111, readerAddr)
 *
 * The backend therefore signs the mirror digest separately with the same SERVER_PRIVATE_KEY
 * (which, per the Level-1 placeholder convention, equals the Reader's bound teeAttestationSigner).
 * In a production keyper / real TEE deployment, both digests would be signed by the enclave's
 * attestation key — the backend wouldn't hold the signer's private key at all. Documented in
 * README threat model.
 *
 * This is NOT a bridge. No value moves. We re-publish an attestation so an auditor indexing
 * Ethereum (not 0G) can verify the audit log without trusting the Provenant backend.
 */

const SEPOLIA_CHAIN_ID = 11155111;

export type MirrorResult = {
  txHash: `0x${string}`;
  stub: boolean;
};

function signMirrorDigest(
  signerWallet: Wallet,
  args: {
    bundleHash: `0x${string}`;
    originTxHash: `0x${string}`;
    originChainId: number;
    enclaveTimestamp: number;
    readerAddress: `0x${string}`;
  }
): Promise<`0x${string}`> {
  const inner = AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes32", "uint256", "uint64", "uint256", "address"],
    [
      args.bundleHash,
      args.originTxHash,
      args.originChainId,
      args.enclaveTimestamp,
      SEPOLIA_CHAIN_ID,
      args.readerAddress,
    ]
  );
  const digest = keccak256(inner);
  // EIP-191 prefix matches `MessageHashUtils.toEthSignedMessageHash` on the Reader side.
  return signerWallet.signMessage(getBytes(digest)) as Promise<`0x${string}`>;
}

export async function mirrorInferenceToSepolia(args: {
  bundleHash: `0x${string}`;
  originTxHash: `0x${string}`;
  originChainId: number;
  enclaveTimestamp: number;
  teeSignature: `0x${string}`;
}): Promise<MirrorResult> {
  if (!sepoliaMirrorReady() || !config.PROVENANT_READER_ADDRESS) {
    log.warn({ bundleHash: args.bundleHash }, "sepolia_mirror_stub");
    return {
      txHash: ("0x" + "22".repeat(32)) as `0x${string}`,
      stub: true,
    };
  }

  const provider = getSepoliaProvider();
  const signer = getServerSigner(provider);
  const reader = getProvenantReaderContract(signer);

  // Re-sign for the Reader's digest format. `args.teeSignature` is the Aristotle anchor
  // signature; it does NOT verify under the Reader's digest. We sign fresh here.
  const mirrorSignature = await signMirrorDigest(signer, {
    bundleHash: args.bundleHash,
    originTxHash: args.originTxHash,
    originChainId: args.originChainId,
    enclaveTimestamp: args.enclaveTimestamp,
    readerAddress: config.PROVENANT_READER_ADDRESS as `0x${string}`,
  });

  const tx = await reader.mirror(
    args.bundleHash,
    args.originTxHash,
    args.originChainId,
    args.enclaveTimestamp,
    mirrorSignature
  );
  const receipt = await tx.wait(1);
  // Silence the unused-param warning — teeSignature is part of the public API
  // and gets re-bound to a Reader-compatible signature here.
  void args.teeSignature;
  return { txHash: receipt!.hash as `0x${string}`, stub: false };
}
