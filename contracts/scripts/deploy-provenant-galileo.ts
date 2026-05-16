/**
 * Deploy Provenant.sol to 0G Galileo testnet.
 *
 * Run with:
 *   npx hardhat run scripts/deploy-provenant-galileo.ts --network galileo
 *
 * Or via the npm script:
 *   npm run deploy:provenant:galileo
 *
 * Requires PRIVATE_KEY and (optional) GALILEO_RPC_URL in .env.
 * Faucet: https://faucet.0g.ai (0.1 OG/day; deploy uses ~0.005 OG so one drip is plenty).
 *
 * Per the 0G team via Discord (14 May 2026): build + test entirely on Galileo
 * first, then deploy a single instance to Aristotle mainnet at final submission
 * stage using a small amount of native OG. This script handles the Galileo half.
 */
import { ethers } from "hardhat";

async function main(): Promise<void> {
  const expectedChainId = 16602n;
  const net = await ethers.provider.getNetwork();
  if (net.chainId !== expectedChainId) {
    throw new Error(
      `Wrong network. Expected chainId ${expectedChainId} (0G Galileo Testnet), got ${net.chainId}. ` +
        `Pass --network galileo.`
    );
  }

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "OG");

  if (balance === 0n) {
    throw new Error(
      "Deployer balance is zero on Galileo. Hit the faucet first: https://faucet.0g.ai " +
        "or Google Cloud Web3 Faucet."
    );
  }

  const factory = await ethers.getContractFactory("Provenant");
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("✅ Provenant deployed at:", address);
  console.log(`Explorer: https://chainscan-galileo.0g.ai/address/${address}`);
  console.log("\nNext steps:");
  console.log("  1. Add PROVENANT_CONTRACT_ADDRESS to backend/.env + frontend/.env.local");
  console.log("  2. Point indexer's PROVENANT_CHAIN_RPC at https://evmrpc-testnet.0g.ai and");
  console.log("     PROVENANT_CHAIN_ID at 16602; restart the indexer to start polling.");
  console.log("  3. Record the demo against this testnet deploy.");
  console.log("  4. For final submission: also deploy to Aristotle mainnet (chain 16661)");
  console.log("     via `npm run deploy:provenant` once native OG is in the deployer wallet.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
