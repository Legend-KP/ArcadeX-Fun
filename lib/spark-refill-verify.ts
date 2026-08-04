import type { Address, Hash } from "viem";
import { BASE_USDC } from "@/lib/spark-refill";
import {
  SPARK_REFILL_ABI,
  SPARK_REFILL_CONTRACT_ADDRESS,
  type SparkRefillPaymentToken,
} from "@/lib/spark-refill";
import { verifyEntryPaidPaymentTx } from "@/lib/payment-tx-verify";

export interface VerifiedSparkRefillPayment {
  player: Address;
  token: SparkRefillPaymentToken;
  amount: bigint;
}

export async function verifySparkRefillPaymentTx(
  walletAddress: string,
  txHash: Hash
): Promise<VerifiedSparkRefillPayment> {
  const verified = await verifyEntryPaidPaymentTx({
    walletAddress,
    txHash,
    contractAddress: SPARK_REFILL_CONTRACT_ADDRESS,
    abi: SPARK_REFILL_ABI,
    usdcAddress: BASE_USDC,
    contractLabel: "SparkRefill",
  });

  return { ...verified, token: "USDC" };
}
