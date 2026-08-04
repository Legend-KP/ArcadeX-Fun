const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { ethers } = require("ethers");

dotenv.config({ path: path.resolve(__dirname, "../../../arcadex-celo/.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SECONDS_PER_DAY = 24 * 60 * 60;
const OUT_DIR = path.resolve(__dirname, "../../deployments");

function loadKey() {
  let pk = (process.env.PRIVATE_KEY || "").trim().replace(/^["']|["']$/g, "");
  if (!pk) throw new Error("PRIVATE_KEY missing");
  if (!pk.startsWith("0x")) pk = `0x${pk}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error(`PRIVATE_KEY invalid length ${pk.length}`);
  }
  return pk;
}

function loadArtifact(name) {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`),
      "utf8"
    )
  );
}

function save(name, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}-base-mainnet.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log("Saved", file);
  return file;
}

async function deployContract(wallet, artifact, args = []) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log("Sending deploy tx…");
  const contract = await factory.deploy(...args);
  const tx = contract.deploymentTransaction();
  console.log("tx", tx.hash);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Deploy failed: ${tx.hash}`);
  }
  const address = await contract.getAddress();
  const code = await wallet.provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error(`No code at ${address} after ${tx.hash}`);
  }
  console.log("deployed", address, "gasUsed", receipt.gasUsed.toString());
  return { contract, address, txHash: tx.hash, receipt };
}

async function main() {
  const pk = loadKey();
  const rpc = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const provider = new ethers.JsonRpcProvider(rpc, 8453);
  const wallet = new ethers.Wallet(pk, provider);

  console.log("Deployer", wallet.address);
  console.log("Balance", ethers.formatEther(await provider.getBalance(wallet.address)), "ETH");
  console.log("Nonce", await provider.getTransactionCount(wallet.address));

  // 1) ArcadeXRewards
  console.log("\n=== ArcadeXRewards ===");
  const rewardsArt = loadArtifact("ArcadeXRewards");
  const rewards = await deployContract(wallet, rewardsArt, [wallet.address]);

  const rewardMeta = ethers.id("INFINITE_SPARK_24H");
  const now = Math.floor(Date.now() / 1000);
  const startTime = now;
  const endTime = now + 365 * SECONDS_PER_DAY;
  const setTx = await rewards.contract.setCampaign(
    1,
    0,
    true,
    7,
    SECONDS_PER_DAY,
    0,
    startTime,
    endTime,
    0,
    ethers.ZeroAddress,
    0,
    rewardMeta,
    true,
    false,
    0
  );
  console.log("setCampaign tx", setTx.hash);
  await setTx.wait();

  save("arcadex-rewards", {
    contract: "ArcadeXRewards",
    network: "base-mainnet",
    chainId: 8453,
    address: rewards.address,
    usdc: BASE_USDC,
    campaignId: 1,
    campaignType: "STREAK",
    requiredDays: 7,
    minIntervalSeconds: SECONDS_PER_DAY,
    rewardMode: 0,
    rewardMeta,
    resetAfterMilestone: true,
    requireEligibility: false,
    maxSinglePayout: 0,
    startTime,
    endTime,
    eligibilitySigner: wallet.address,
    spinResultSigner: ethers.ZeroAddress,
    constructorArgs: [wallet.address],
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
    txHash: rewards.txHash,
    setCampaignTxHash: setTx.hash,
  });

  // 2) SparkRefill
  console.log("\n=== SparkRefill ===");
  const sparkArt = loadArtifact("SparkRefill");
  const spark = await deployContract(wallet, sparkArt);
  const sparkFee = await spark.contract.fee();
  save("spark-refill", {
    contract: "SparkRefill",
    network: "base-mainnet",
    chainId: 8453,
    address: spark.address,
    usdc: BASE_USDC,
    fee: sparkFee.toString(),
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
    txHash: spark.txHash,
  });

  // 3) ScoreSubmit
  console.log("\n=== ScoreSubmit ===");
  const scoreArt = loadArtifact("ScoreSubmit");
  const score = await deployContract(wallet, scoreArt);
  const scoreFee = await score.contract.fee();
  save("score-submit", {
    contract: "ScoreSubmit",
    network: "base-mainnet",
    chainId: 8453,
    address: score.address,
    usdc: BASE_USDC,
    fee: scoreFee.toString(),
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
    txHash: score.txHash,
  });

  // 4) InfiniteSpark
  console.log("\n=== InfiniteSpark ===");
  const infArt = loadArtifact("InfiniteSpark");
  const inf = await deployContract(wallet, infArt);
  const infFee = await inf.contract.fee();
  save("infinite-spark", {
    contract: "InfiniteSpark",
    network: "base-mainnet",
    chainId: 8453,
    address: inf.address,
    usdc: BASE_USDC,
    fee: infFee.toString(),
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
    txHash: inf.txHash,
  });

  console.log("\n=== DONE ===");
  console.log("ArcadeXRewards", rewards.address);
  console.log("SparkRefill   ", spark.address);
  console.log("ScoreSubmit   ", score.address);
  console.log("InfiniteSpark ", inf.address);
  console.log("\nNext: node scripts/verify-all-base.cjs");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
