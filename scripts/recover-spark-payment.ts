/**
 * One-off recovery: credit Infinite Spark / Spark Refill after a paid on-chain tx
 * failed to confirm in the app (RPC receipt lag).
 *
 * Usage:
 *   npx tsx scripts/recover-spark-payment.ts <wallet> <txHash> <infinite-24h|spark-refill>
 */
import { config } from "dotenv";
config({ path: ".env" });

async function main() {
  const [, , wallet, txHash, product] = process.argv;
  if (!wallet || !txHash || !product) {
    throw new Error(
      "Usage: npx tsx scripts/recover-spark-payment.ts <wallet> <txHash> <infinite-24h|spark-refill>"
    );
  }

  if (product === "infinite-24h") {
    const { activateInfiniteSparkOnServer } = await import(
      "../lib/rtdb-server"
    );
    const result = await activateInfiniteSparkOnServer(wallet, txHash);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (product === "spark-refill") {
    const { activateSparkRefillOnServer } = await import("../lib/rtdb-server");
    const result = await activateSparkRefillOnServer(wallet, txHash);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error("product must be infinite-24h or spark-refill");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
