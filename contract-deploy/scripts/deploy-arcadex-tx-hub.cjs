const { writeFileSync, mkdirSync } = require("fs");
const { join, resolve } = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying ArcadeXTxHub (Base free play sign-in) with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  const ArcadeXTxHub = await hre.ethers.getContractFactory("ArcadeXTxHub");
  const contract = await ArcadeXTxHub.deploy();
  await contract.waitForDeployment();

  const deployTx = contract.deploymentTransaction();
  if (deployTx) {
    const receipt = await deployTx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("ArcadeXTxHub deployment transaction failed");
    }
  }

  const address = await contract.getAddress();
  const owner = await contract.owner();

  console.log("ArcadeXTxHub deployed to:", address);
  console.log("Owner:", owner);

  const outDir = resolve(__dirname, "../../deployments");
  mkdirSync(outDir, { recursive: true });

  const deployment = {
    contract: "ArcadeXTxHub",
    network: "base-mainnet",
    chainId: 8453,
    address,
    deployer: deployer.address,
    owner,
    deployedAt: new Date().toISOString(),
    txHash: deployTx?.hash ?? null,
    notes: {
      playPurpose: 'keccak256(UTF-8 "PLAY:{gameId}")',
      signInMethod: "signIn(bytes32)",
      env: "NEXT_PUBLIC_ARCADEX_TX_HUB_CONTRACT=<address>",
    },
  };

  writeFileSync(
    join(outDir, "arcadex-tx-hub-base-mainnet.json"),
    JSON.stringify(deployment, null, 2)
  );

  console.log("Deployment saved to deployments/arcadex-tx-hub-base-mainnet.json");
  console.log("Set NEXT_PUBLIC_ARCADEX_TX_HUB_CONTRACT=" + address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
