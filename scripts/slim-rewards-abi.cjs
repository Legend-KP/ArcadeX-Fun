/**
 * Replace ARCADEX_REWARDS_ABI with a minimal subset used by the app.
 * Full ABI bloats the Cloudflare Worker past the free 3 MiB limit.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const fullAbi = require(path.join(
  root,
  "contract-deploy/artifacts/contracts/ArcadeXRewards.sol/ArcadeXRewards.json"
)).abi;

const KEEP_EVENTS = new Set([
  "CheckedIn",
  "MilestoneReached",
  "SpinResultGranted",
]);
const KEEP_FNS = new Set([
  "checkIn",
  "spin",
  "claim",
  "getProgress",
  "getCampaign",
  "spinNonce",
]);

const slim = fullAbi.filter((item) => {
  if (item.type === "event") return KEEP_EVENTS.has(item.name);
  if (item.type === "function") return KEEP_FNS.has(item.name);
  return false;
});

const filePath = path.join(root, "lib/arcadex-rewards.ts");
const src = fs.readFileSync(filePath, "utf8");
const marker = "export const ARCADEX_REWARDS_ABI = [";
const start = src.indexOf(marker);
const end = src.indexOf("] as const;", start);
if (start < 0 || end < 0) throw new Error("ABI markers not found");

const next = `${src.slice(0, start)}/** Minimal ABI for Base ArcadeXRewards (Worker size budget). */
export const ARCADEX_REWARDS_ABI = ${JSON.stringify(
  slim,
  null,
  2
)} as const;${src.slice(end + "] as const;".length)}`;

fs.writeFileSync(filePath, next);
console.log("Slim ABI items:", slim.length, "(from", fullAbi.length + ")");
