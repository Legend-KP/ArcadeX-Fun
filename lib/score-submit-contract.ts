import type { Address } from "viem";
import {
  BASE_USDC,
  ERC20_ABI,
  SPARK_REFILL_ABI,
  STABLECOIN_DECIMALS,
} from "@/lib/spark-refill";
import {
  BASE_MAINNET_DEPLOYMENTS,
  envAddress,
} from "@/lib/base-deployments";

/** On-chain leaderboard score-submit contract (Base + USDC). */
export const SCORE_SUBMIT_CONTRACT_ADDRESS = envAddress(
  process.env.NEXT_PUBLIC_SCORE_SUBMIT_CONTRACT,
  BASE_MAINNET_DEPLOYMENTS.scoreSubmit
);

export type ScoreSubmitPaymentToken = "USDC";

export const SCORE_SUBMIT_ABI = SPARK_REFILL_ABI;

export { BASE_USDC, ERC20_ABI, STABLECOIN_DECIMALS };

export function tokenAddress(_token?: ScoreSubmitPaymentToken): Address {
  return BASE_USDC;
}

export function isScoreSubmitContractConfigured(): boolean {
  return (
    SCORE_SUBMIT_CONTRACT_ADDRESS !==
    "0x0000000000000000000000000000000000000000"
  );
}
