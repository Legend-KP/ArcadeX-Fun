const { writeFileSync, mkdirSync } = require("fs");
const { join, resolve } = require("path");
const hre = require("hardhat");

const AVALANCHE_USDC = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
const SECONDS_PER_DAY = 24 * 60 * 60;
const CAMPAIGN_ID = 1;
const REQUIRED_DAYS = 7;
const REWARD_OFFCHAIN = 0;
const CAMPAIGN_TYPE_STREAK = 0;

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log(
    "Deploying ArcadeXRewards (Avalanche USDC-only) with account:",
    deployer.address
  );

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "AVAX");

  const ArcadeXRewards = await hre.ethers.getContractFactory("ArcadeXRewards");
  const contract = await ArcadeXRewards.deploy(deployer.address);
  await contract.waitForDeployment();

  const deployTx = contract.deploymentTransaction();
  if (deployTx) {
    const receipt = await deployTx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("ArcadeXRewards deployment transaction failed");
    }
  }

  const address = await contract.getAddress();
  const code = await hre.ethers.provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error("No bytecode at ArcadeXRewards address");
  }

  console.log("ArcadeXRewards deployed to:", address);
  console.log("USDC:", AVALANCHE_USDC);

  const rewardMeta = hre.ethers.id("INFINITE_SPARK_24H");
  const now = Math.floor(Date.now() / 1000);
  const startTime = now;
  const endTime = now + 365 * SECONDS_PER_DAY;

  const tx = await contract.setCampaign(
    CAMPAIGN_ID,
    CAMPAIGN_TYPE_STREAK,
    true,
    REQUIRED_DAYS,
    SECONDS_PER_DAY,
    0,
    startTime,
    endTime,
    REWARD_OFFCHAIN,
    hre.ethers.ZeroAddress,
    0,
    rewardMeta,
    true,
    false,
    0
  );
  await tx.wait();

  console.log(
    "Campaign",
    CAMPAIGN_ID,
    "configured (7-day OFFCHAIN Infinite Spark STREAK)"
  );

  const outDir = resolve(__dirname, "../../deployments");
  mkdirSync(outDir, { recursive: true });

  const deployment = {
    contract: "ArcadeXRewards",
    network: "avalanche-c-chain",
    chainId: 43114,
    address,
    usdc: AVALANCHE_USDC,
    campaignId: CAMPAIGN_ID,
    campaignType: "STREAK",
    requiredDays: REQUIRED_DAYS,
    minIntervalSeconds: SECONDS_PER_DAY,
    rewardMode: REWARD_OFFCHAIN,
    rewardMeta,
    resetAfterMilestone: true,
    requireEligibility: false,
    maxSinglePayout: 0,
    startTime,
    endTime,
    eligibilitySigner: deployer.address,
    spinResultSigner: hre.ethers.ZeroAddress,
    constructorArgs: [deployer.address],
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: deployTx?.hash ?? null,
    setCampaignTxHash: tx.hash,
  };

  writeFileSync(
    join(outDir, "arcadex-rewards-avalanche-mainnet.json"),
    JSON.stringify(deployment, null, 2)
  );

  console.log("Saved deployments/arcadex-rewards-avalanche-mainnet.json");
  console.log("Set NEXT_PUBLIC_AVALANCHE_ARCADEX_REWARDS_CONTRACT=" + address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
