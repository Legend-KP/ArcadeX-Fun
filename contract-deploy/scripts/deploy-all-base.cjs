const path = require("path");
const { spawnSync } = require("child_process");
const dotenv = require("dotenv");

const root = path.resolve(__dirname, "..");
dotenv.config({ path: path.resolve(root, "../../arcadex-celo/.env") });
dotenv.config({ path: path.resolve(root, "../.env") });

let pk = (process.env.PRIVATE_KEY || "").trim().replace(/^["']|["']$/g, "");
if (!pk) {
  console.error("PRIVATE_KEY not found");
  process.exit(1);
}
if (!pk.startsWith("0x")) pk = `0x${pk}`;
if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  console.error("PRIVATE_KEY invalid length", pk.length);
  process.exit(1);
}
process.env.PRIVATE_KEY = pk;

const scripts = [
  "scripts/deploy-arcadex-rewards.cjs",
  "scripts/deploy-spark-refill.cjs",
  "scripts/deploy-score-submit.cjs",
  "scripts/deploy-infinite-spark.cjs",
];

for (const script of scripts) {
  console.log("\n=== Deploying", script, "===\n");
  const result = spawnSync(
    "npx",
    ["hardhat", "run", script, "--network", "base"],
    { cwd: root, env: process.env, stdio: "inherit", shell: true }
  );
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log("\nAll deploys finished. Run: node scripts/verify-all-base.cjs");
