const fs = require("fs");
const path = require("path");

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function patch(file, patterns) {
  let s = fs.readFileSync(file, "utf8");
  let changed = false;
  for (const [from, to] of patterns) {
    if (s.includes(from)) {
      s = s.split(from).join(to);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(file, s);
    console.log("patched", path.basename(file));
  } else {
    console.log("no change", path.basename(file));
  }
}

const dir = __dirname;

patch(path.join(dir, "deploy-arcadex-rewards.cjs"), [
  [
    `  const address = await contract.getAddress();
  const usdc = await contract.USDC();
  console.log("ArcadeXRewards deployed to:", address);
  console.log("USDC:", usdc);`,
    `  const deployTx = contract.deploymentTransaction();
  if (deployTx) {
    const receipt = await deployTx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("ArcadeXRewards deployment transaction failed");
    }
  }

  const address = await contract.getAddress();
  const usdc = BASE_USDC;
  console.log("ArcadeXRewards deployed to:", address);
  console.log("USDC:", usdc);`,
  ],
  [
    `const hre = require("hardhat");`,
    `const hre = require("hardhat");\n\nconst BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";`,
  ],
]);

for (const name of [
  "deploy-spark-refill.cjs",
  "deploy-score-submit.cjs",
  "deploy-infinite-spark.cjs",
]) {
  patch(path.join(dir, name), [
    [
      `  const address = await contract.getAddress();
  const fee = await contract.fee();
  const usdc = await contract.USDC();`,
      `  const deployTx = contract.deploymentTransaction();
  if (deployTx) {
    const receipt = await deployTx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("Deployment transaction failed");
    }
  }

  const address = await contract.getAddress();
  const fee = await contract.fee();
  const usdc = BASE_USDC;`,
    ],
    [
      `const hre = require("hardhat");`,
      `const hre = require("hardhat");\n\nconst BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";`,
    ],
  ]);
}
