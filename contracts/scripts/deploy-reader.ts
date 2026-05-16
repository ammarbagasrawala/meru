/**
 * Deploy ProvenantReader.sol to Sepolia (Ethereum testnet).
 *
 * Run with:
 *   npx hardhat run scripts/deploy-reader.ts --network sepolia
 *
 * Requires PRIVATE_KEY, SEPOLIA_RPC_URL, and TEE_ATTESTATION_SIGNER in .env.
 */
import { ethers, network } from "hardhat";

async function main(): Promise<void> {
  const expectedChainId = 11155111n;
  const net = await ethers.provider.getNetwork();
  if (net.chainId !== expectedChainId) {
    throw new Error(
      `Wrong network. Expected chainId ${expectedChainId} (Sepolia), got ${net.chainId}. ` +
        `Pass --network sepolia.`
    );
  }

  const teeSigner = process.env.TEE_ATTESTATION_SIGNER;
  if (!teeSigner || !/^0x[a-fA-F0-9]{40}$/.test(teeSigner)) {
    throw new Error(
      "TEE_ATTESTATION_SIGNER must be a 0x-prefixed 20-byte hex address. " +
        "This is the address derived from the 0G Sealed Inference enclave's attestation pubkey. " +
        "Capture it from the first inference call's signed bundle, then set in .env."
    );
  }

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  if (balance === 0n) {
    throw new Error(
      "Deployer balance is zero on Sepolia. Hit a Sepolia faucet first " +
        "(e.g. https://sepoliafaucet.com or https://www.alchemy.com/faucets/ethereum-sepolia)."
    );
  }

  const factory = await ethers.getContractFactory("ProvenantReader");
  const contract = await factory.deploy(teeSigner);
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("✅ ProvenantReader deployed at:", address);
  console.log("   teeAttestationSigner:", teeSigner);
  console.log(`Explorer: https://sepolia.etherscan.io/address/${address}`);
  console.log("\nNext steps:");
  console.log("  1. Add PROVENANT_READER_ADDRESS to your .env files");
  console.log("  2. Start mirroring InferenceLogged events from 0G to Sepolia via backend/src/mirror/sepolia.ts");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
