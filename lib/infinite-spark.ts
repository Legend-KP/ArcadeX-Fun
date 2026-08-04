import type { Address } from "viem";
import {
  BASE_USDC,
  ERC20_ABI,
  SPARK_REFILL_ABI,
  STABLECOIN_DECIMALS,
  type SparkRefillPaymentToken,
  tokenAddress,
} from "@/lib/spark-refill";

export const INFINITE_SPARK_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_INFINITE_SPARK_CONTRACT?.trim() ||
  "0x0000000000000000000000000000000000000000"
) as Address;

export function isInfiniteSparkConfigured(): boolean {
  return (
    Boolean(INFINITE_SPARK_CONTRACT_ADDRESS) &&
    INFINITE_SPARK_CONTRACT_ADDRESS !==
      "0x0000000000000000000000000000000000000000"
  );
}

export {
  BASE_USDC,
  ERC20_ABI,
  SPARK_REFILL_ABI as INFINITE_SPARK_ABI,
  STABLECOIN_DECIMALS,
  tokenAddress,
};
export type { SparkRefillPaymentToken as InfiniteSparkPaymentToken };
