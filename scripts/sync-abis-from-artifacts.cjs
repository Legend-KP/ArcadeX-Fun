/**
 * Sync app ABIs from Hardhat artifacts (matches verified Base deployments).
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rewardsAbi = require(path.join(
  root,
  "contract-deploy/artifacts/contracts/ArcadeXRewards.sol/ArcadeXRewards.json"
)).abi;
const sparkAbi = require(path.join(
  root,
  "contract-deploy/artifacts/contracts/SparkRefill.sol/SparkRefill.json"
)).abi;

function replaceExport(filePath, exportName, value) {
  const src = fs.readFileSync(filePath, "utf8");
  const marker = `export const ${exportName} = [`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${exportName} in ${filePath}`);
  const end = src.indexOf("] as const;", start);
  if (end < 0) throw new Error(`Missing ] as const for ${exportName}`);
  const next = `${src.slice(0, start)}export const ${exportName} = ${JSON.stringify(
    value,
    null,
    2
  )} as const;${src.slice(end + "] as const;".length)}`;
  fs.writeFileSync(filePath, next);
}

const rewardsPath = path.join(root, "lib/arcadex-rewards.ts");
replaceExport(rewardsPath, "ARCADEX_REWARDS_ABI", rewardsAbi);
let rewardsSrc = fs.readFileSync(rewardsPath, "utf8");
rewardsSrc = rewardsSrc.replace(
  /\/\*\* Full ABI for 0x[a-fA-F0-9]+ \*\//,
  "/** Full ABI — ArcadeXRewards on Base mainnet */"
);
fs.writeFileSync(rewardsPath, rewardsSrc);

replaceExport(path.join(root, "lib/spark-refill.ts"), "SPARK_REFILL_ABI", sparkAbi);

console.log("ArcadeXRewards ABI items:", rewardsAbi.length);
console.log("SparkRefill ABI items:", sparkAbi.length);
console.log(
  "UsdtDisabled present:",
  rewardsAbi.some((x) => x.name === "UsdtDisabled")
);
