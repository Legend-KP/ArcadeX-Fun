import type { Address, Hash } from "viem";
import {
  BASE_USDC,
  INFINITE_SPARK_ABI,
  INFINITE_SPARK_CONTRACT_ADDRESS,
  type InfiniteSparkPaymentToken,
} from "@/lib/infinite-spark";
import { verifyEntryPaidPaymentTx } from "@/lib/payment-tx-verify";

export interface VerifiedInfiniteSparkPayment {
  player: Address;
  token: InfiniteSparkPaymentToken;
  amount: bigint;
}

export async function verifyInfiniteSparkPaymentTx(
  walletAddress: string,
  txHash: Hash
): Promise<VerifiedInfiniteSparkPayment> {
  const verified = await verifyEntryPaidPaymentTx({
    walletAddress,
    txHash,
    contractAddress: INFINITE_SPARK_CONTRACT_ADDRESS,
    abi: INFINITE_SPARK_ABI,
    usdcAddress: BASE_USDC,
    contractLabel: "InfiniteSpark",
  });

  return { ...verified, token: "USDC" };
}
