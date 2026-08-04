const { writeFileSync, mkdirSync } = require("fs");
const { join, resolve } = require("path");
const hre = require("hardhat");

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying SparkRefill (Base USDC-only) with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  const SparkRefill = await hre.ethers.getContractFactory("SparkRefill");
  const contract = await SparkRefill.deploy();
  await contract.waitForDeployment();

  const deployTx = contract.deploymentTransaction();
  if (deployTx) {
    const receipt = await deployTx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("SparkRefill deployment transaction failed");
    }
  }

  const address = await contract.getAddress();
  const fee = await contract.fee();

  console.log("SparkRefill deployed to:", address);
  console.log("USDC:", BASE_USDC);
  console.log("Refill fee (6 decimals):", fee.toString(), "($0.20)");

  const outDir = resolve(__dirname, "../../deployments");
  mkdirSync(outDir, { recursive: true });

  const deployment = {
    contract: "SparkRefill",
    network: "base-mainnet",
    chainId: 8453,
    address,
    usdc: BASE_USDC,
    fee: fee.toString(),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: deployTx?.hash ?? null,
  };

  writeFileSync(
    join(outDir, "spark-refill-base-mainnet.json"),
    JSON.stringify(deployment, null, 2)
  );

  console.log("Deployment saved to deployments/spark-refill-base-mainnet.json");
  console.log("Set NEXT_PUBLIC_SPARK_REFILL_CONTRACT=" + address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
