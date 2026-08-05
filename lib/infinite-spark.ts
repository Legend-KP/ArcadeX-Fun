import {
  BASE_USDC,
  ERC20_ABI,
  SPARK_REFILL_ABI,
  STABLECOIN_DECIMALS,
  type SparkRefillPaymentToken,
  tokenAddress,
} from "@/lib/spark-refill";
import {
  BASE_MAINNET_DEPLOYMENTS,
  envAddress,
} from "@/lib/base-deployments";

export const INFINITE_SPARK_CONTRACT_ADDRESS = envAddress(
  process.env.NEXT_PUBLIC_INFINITE_SPARK_CONTRACT,
  BASE_MAINNET_DEPLOYMENTS.infiniteSpark
);

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
