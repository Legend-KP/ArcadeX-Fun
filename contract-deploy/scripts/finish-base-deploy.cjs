const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { ethers } = require("ethers");

dotenv.config({ path: path.resolve(__dirname, "../../../arcadex-celo/.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SECONDS_PER_DAY = 24 * 60 * 60;
const OUT_DIR = path.resolve(__dirname, "../../deployments");
const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";

// Already mined from previous attempt
const EXISTING_REWARDS = {
  address: "0xa3ff9C5f592e2891279b83f9017C00733A3F19fC",
  txHash: "0xe2c30b7f05771453fe4d4e85a7161c2de5fe4d86b5445b0e10aaeb370ccc6ff1",
};

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
}

async function waitForCode(provider, address, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    const code = await provider.getCode(address);
    if (code && code !== "0x") return code;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`No code at ${address} after retries`);
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
  const address = receipt.contractAddress || (await contract.getAddress());
  await waitForCode(wallet.provider, address);
  console.log("deployed", address, "gasUsed", receipt.gasUsed.toString());
  return {
    contract: new ethers.Contract(address, artifact.abi, wallet),
    address,
    txHash: tx.hash,
    receipt,
  };
}

async function main() {
  const pk = loadKey();
  const provider = new ethers.JsonRpcProvider(RPC, 8453);
  const wallet = new ethers.Wallet(pk, provider);
  const rewardsArt = loadArtifact("ArcadeXRewards");

  console.log("Deployer", wallet.address);
  console.log("Balance", ethers.formatEther(await provider.getBalance(wallet.address)), "ETH");

  // --- ArcadeXRewards (reuse existing deploy) ---
  console.log("\n=== ArcadeXRewards (existing) ===");
  await waitForCode(provider, EXISTING_REWARDS.address);
  const rewards = new ethers.Contract(
    EXISTING_REWARDS.address,
    rewardsArt.abi,
    wallet
  );

  const campaign = await rewards.getCampaign(1);
  let setCampaignTxHash = null;
  if (!campaign.active) {
    const rewardMeta = ethers.id("INFINITE_SPARK_24H");
    const now = Math.floor(Date.now() / 1000);
    const startTime = now;
    const endTime = now + 365 * SECONDS_PER_DAY;
    const setTx = await rewards.setCampaign(
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
    setCampaignTxHash = setTx.hash;

    save("arcadex-rewards", {
      contract: "ArcadeXRewards",
      network: "base-mainnet",
      chainId: 8453,
      address: EXISTING_REWARDS.address,
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
      txHash: EXISTING_REWARDS.txHash,
      setCampaignTxHash,
    });
  } else {
    console.log("Campaign 1 already active");
    const rewardMeta = ethers.id("INFINITE_SPARK_24H");
    save("arcadex-rewards", {
      contract: "ArcadeXRewards",
      network: "base-mainnet",
      chainId: 8453,
      address: EXISTING_REWARDS.address,
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
      startTime: Number(campaign.startTime),
      endTime: Number(campaign.endTime),
      eligibilitySigner: wallet.address,
      spinResultSigner: ethers.ZeroAddress,
      constructorArgs: [wallet.address],
      deployer: wallet.address,
      deployedAt: new Date().toISOString(),
      txHash: EXISTING_REWARDS.txHash,
      setCampaignTxHash: null,
    });
  }

  console.log("\n=== SparkRefill ===");
  const spark = await deployContract(wallet, loadArtifact("SparkRefill"));
  save("spark-refill", {
    contract: "SparkRefill",
    network: "base-mainnet",
    chainId: 8453,
    address: spark.address,
    usdc: BASE_USDC,
    fee: (await spark.contract.fee()).toString(),
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
    txHash: spark.txHash,
  });

  console.log("\n=== ScoreSubmit ===");
  const score = await deployContract(wallet, loadArtifact("ScoreSubmit"));
  save("score-submit", {
    contract: "ScoreSubmit",
    network: "base-mainnet",
    chainId: 8453,
    address: score.address,
    usdc: BASE_USDC,
    fee: (await score.contract.fee()).toString(),
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
    txHash: score.txHash,
  });

  console.log("\n=== InfiniteSpark ===");
  const inf = await deployContract(wallet, loadArtifact("InfiniteSpark"));
  save("infinite-spark", {
    contract: "InfiniteSpark",
    network: "base-mainnet",
    chainId: 8453,
    address: inf.address,
    usdc: BASE_USDC,
    fee: (await inf.contract.fee()).toString(),
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
    txHash: inf.txHash,
  });

  console.log("\n=== DONE ===");
  console.log("ArcadeXRewards", EXISTING_REWARDS.address);
  console.log("SparkRefill   ", spark.address);
  console.log("ScoreSubmit   ", score.address);
  console.log("InfiniteSpark ", inf.address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
