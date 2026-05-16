/**
 * Deploy Provenant.sol to 0G Aristotle mainnet.
 *
 * Run with:
 *   npx hardhat run scripts/deploy-provenant.ts --network aristotle
 *
 * Requires PRIVATE_KEY and OG_RPC_URL in .env.
 */
import { ethers, network } from "hardhat";

async function main(): Promise<void> {
  const expectedChainId = 16661n;
  const net = await ethers.provider.getNetwork();
  if (net.chainId !== expectedChainId) {
    throw new Error(
      `Wrong network. Expected chainId ${expectedChainId} (Aristotle), got ${net.chainId}. ` +
        `Pass --network aristotle.`
    );
  }

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "OG");

  if (balance === 0n) {
    throw new Error(
      "Deployer balance is zero. Fund the wallet with OG on Aristotle before deploying. " +
        "See ../00-GROUNDING.md §12 for token-acquisition options."
    );
  }

  const factory = await ethers.getContractFactory("Provenant");
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("✅ Provenant deployed at:", address);
  console.log(`Explorer: https://chainscan.0g.ai/address/${address}`);
  console.log("\nNext steps:");
  console.log("  1. Add PROVENANT_CONTRACT_ADDRESS to your .env files");
  console.log("  2. Deploy ProvenantReader to Sepolia: npm run deploy:reader");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
