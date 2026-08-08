/**
 * Vara payment program IDs + fees (SparkRefill / ScoreSubmit / InfiniteSpark).
 * Env preferred; empty until you deploy and set Program IDs (or fall back later).
 */
import type { HexString } from "@/lib/shop-vara";
import { VARA_RPC_URL } from "@/lib/shop-vara";
import {
  envProgramId,
  VARA_MAINNET_DEPLOYMENTS,
} from "@/lib/vara-deployments";

export type VaraPaymentKind = "spark-refill" | "score-submit" | "infinite-spark";
export type VaraPaymentToken = "wusdt" | "wusdc";

export const VARA_PAYMENT_FEES = {
  "spark-refill": BigInt(50_000),
  "score-submit": BigInt(50_000),
  "infinite-spark": BigInt(100_000),
} as const;

export const VARA_PAYMENT_SERVICE_ROUTE: Record<VaraPaymentKind, string> = {
  "spark-refill": "SparkRefill",
  "score-submit": "ScoreSubmit",
  "infinite-spark": "InfiniteSpark",
};

const ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as HexString;

/** Env preferred; fall back to checked-in mainnet IDs in vara-deployments. */
export const VARA_SPARK_REFILL_PROGRAM_ID = envProgramId(
  process.env.NEXT_PUBLIC_VARA_SPARK_REFILL_PROGRAM,
  (VARA_MAINNET_DEPLOYMENTS.sparkRefillProgramId ||
    "") as HexString
);

export const VARA_SCORE_SUBMIT_PROGRAM_ID = envProgramId(
  process.env.NEXT_PUBLIC_VARA_SCORE_SUBMIT_PROGRAM,
  (VARA_MAINNET_DEPLOYMENTS.scoreSubmitProgramId ||
    "") as HexString
);

export const VARA_INFINITE_SPARK_PROGRAM_ID = envProgramId(
  process.env.NEXT_PUBLIC_VARA_INFINITE_SPARK_PROGRAM,
  (VARA_MAINNET_DEPLOYMENTS.infiniteSparkProgramId ||
    "") as HexString
);

export function getVaraPaymentProgramId(kind: VaraPaymentKind): HexString {
  const id =
    kind === "spark-refill"
      ? VARA_SPARK_REFILL_PROGRAM_ID
      : kind === "score-submit"
        ? VARA_SCORE_SUBMIT_PROGRAM_ID
        : VARA_INFINITE_SPARK_PROGRAM_ID;
  if (!id) {
    throw new Error(
      `Vara ${kind} program is not configured. Deploy it and set NEXT_PUBLIC_VARA_*_PROGRAM.`
    );
  }
  return id;
}

export function isVaraPaymentProgramConfigured(kind: VaraPaymentKind): boolean {
  try {
    getVaraPaymentProgramId(kind);
    return true;
  } catch {
    return false;
  }
}

export function varaPaymentTokenProgramId(token: VaraPaymentToken): HexString {
  return token === "wusdc"
    ? VARA_MAINNET_DEPLOYMENTS.wUsdc
    : VARA_MAINNET_DEPLOYMENTS.wUsdt;
}

export function varaPaymentFee(kind: VaraPaymentKind): bigint {
  return VARA_PAYMENT_FEES[kind];
}

/** Encode helper re-export surface for clients. */
export { VARA_RPC_URL, ZERO as VARA_ZERO_ACTOR };
