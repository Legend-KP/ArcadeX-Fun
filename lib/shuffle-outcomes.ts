import { randomInt } from "crypto";
import { REWARD_OFFCHAIN, REWARD_USDC } from "@/lib/arcadex-rewards";
import { BASE_USDC_ADDRESS } from "@/lib/chains";

/** USDC on Base uses 6 decimals. */
export const USDC_DECIMALS = 6;

/**
 * Hard daily USDC spend ceiling (human units). Must be ≥ jackpot (1) so the
 * 1 USDC prize can still pay. Soft odds target ~0.35 on non-jackpot days at
 * 10k shuffles; the hard gate stops further USDC once this is hit.
 */
export const SHUFFLE_DAILY_USDC_BUDGET = Number(
  process.env.SHUFFLE_DAILY_USDC_BUDGET?.trim() ||
    process.env.SHUFFLE_DAILY_USDT_BUDGET?.trim() ||
    "1"
);

/** Integer micro-USDC (6 decimals) helpers for budget math. */
export function usdcToMicro(amount: number): number {
  return Math.round(amount * 10 ** USDC_DECIMALS);
}

export function microToUsdc(micro: number): number {
  return micro / 10 ** USDC_DECIMALS;
}

/** @deprecated Use usdcToMicro */
export const usdtToMicro = usdcToMicro;
/** @deprecated Use microToUsdc */
export const microToUsdt = microToUsdc;

export const SHUFFLE_DAILY_USDC_BUDGET_MICRO = usdcToMicro(
  SHUFFLE_DAILY_USDC_BUDGET
);

export type ShuffleOutcomeType = "usdc" | "spark" | "none";

export interface ShuffleOutcomeDef {
  id: string;
  type: ShuffleOutcomeType;
  /** Display amount for USDC (human units). */
  amount: number | null;
  /** Relative integer weight (sum = SHUFFLE_WEIGHT_TOTAL). */
  weight: number;
  label: string;
  sub: string;
  glyph: string;
  rarity: "legendary" | "rare" | "uncommon" | "spark" | "none";
}

/**
 * Weight base chosen so rare odds are exact integers:
 * 1/15k, 1/10k, 1/2k all divide 30_000.
 *
 * At 10k daily shuffles (soft EV, before hard daily cap):
 * - 1 USDC @ 1/15k     → ~0.67 expected (often blocked by daily cap)
 * - 0.05 USDC @ 1/10k  → ~0.05
 * - 0.001 USDC @ 3%    → ~0.30  (maximizes unique USDC winners)
 * - Infinite Spark @ 1/2k → ~5 winners
 * Non-jackpot USDC ≈ 0.35/day; hard cap clamps total spend to budget.
 */
export const SHUFFLE_WEIGHT_TOTAL = 30_000;

/**
 * Server-only odds table. Client may mirror labels for theater, but never
 * trust a client-supplied outcome.
 */
export const SHUFFLE_OUTCOMES: ShuffleOutcomeDef[] = [
  {
    id: "usdc_1",
    type: "usdc",
    amount: 1,
    weight: 2, // 2/30000 = 1/15000
    label: "1 USDC",
    sub: "Jackpot",
    glyph: "Ⓤ",
    rarity: "legendary",
  },
  {
    id: "usdc_p05",
    type: "usdc",
    amount: 0.05,
    weight: 3, // 3/30000 = 1/10000
    label: "0.05 USDC",
    sub: "Big win",
    glyph: "Ⓤ",
    rarity: "rare",
  },
  {
    id: "usdc_p001",
    type: "usdc",
    amount: 0.001,
    weight: 900, // 900/30000 = 3%
    label: "0.001 USDC",
    sub: "Small win",
    glyph: "Ⓤ",
    rarity: "uncommon",
  },
  {
    id: "spark",
    type: "spark",
    amount: null,
    weight: 15, // 15/30000 = 1/2000
    label: "Infinite Spark",
    sub: "Unlimited plays · 24h",
    glyph: "⚡",
    rarity: "spark",
  },
  {
    id: "blnt1",
    type: "none",
    amount: null,
    weight: 14_540,
    label: "Better luck next time",
    sub: "Try again tomorrow",
    glyph: "✦",
    rarity: "none",
  },
  {
    id: "blnt2",
    type: "none",
    amount: null,
    weight: 14_540,
    label: "Better luck next time",
    sub: "So close!",
    glyph: "✦",
    rarity: "none",
  },
];

export function usdcToBaseUnits(amount: number): bigint {
  return BigInt(usdcToMicro(amount));
}

export function secureWeightedPick(
  outcomes: ShuffleOutcomeDef[] = SHUFFLE_OUTCOMES
): ShuffleOutcomeDef {
  if (outcomes.length === 0) {
    throw new Error("No shuffle outcomes available.");
  }
  const total = outcomes.reduce((a, o) => a + o.weight, 0);
  if (total <= 0) {
    throw new Error("Shuffle outcome weights must be positive.");
  }
  const roll = randomInt(0, total);
  let cursor = 0;
  for (let i = 0; i < outcomes.length; i++) {
    cursor += outcomes[i].weight;
    if (roll < cursor) return outcomes[i];
  }
  return outcomes[outcomes.length - 1];
}

/**
 * Pick an outcome. USDC prizes that cannot fit in the remaining daily budget
 * are excluded so more users can still win smaller amounts within the cap.
 */
export function pickShuffleOutcome(opts: {
  /** Remaining daily USDC budget in human units. */
  remainingUsdc: number;
}): ShuffleOutcomeDef {
  const remainingMicro = usdcToMicro(opts.remainingUsdc);
  const pool = SHUFFLE_OUTCOMES.filter((o) => {
    if (o.type !== "usdc") return true;
    if (o.amount == null) return false;
    return usdcToMicro(o.amount) <= remainingMicro;
  });
  return secureWeightedPick(
    pool.length > 0 ? pool : SHUFFLE_OUTCOMES.filter((o) => o.type !== "usdc")
  );
}

export function outcomeToOnChainReward(outcome: ShuffleOutcomeDef): {
  rewardMode: number;
  rewardTarget: `0x${string}`;
  rewardAmount: bigint;
} {
  if (outcome.type === "usdc" && outcome.amount != null) {
    return {
      rewardMode: REWARD_USDC,
      rewardTarget: BASE_USDC_ADDRESS,
      rewardAmount: usdcToBaseUnits(outcome.amount),
    };
  }
  return {
    rewardMode: REWARD_OFFCHAIN,
    rewardTarget: "0x0000000000000000000000000000000000000000",
    rewardAmount: BigInt(0),
  };
}

/** Public labels for the theater grid (no weights). */
export function getShuffleTheaterCards() {
  return SHUFFLE_OUTCOMES.map(
    ({ id, type, amount, label, sub, glyph, rarity }) => ({
      id,
      type,
      amount,
      label,
      sub,
      glyph,
      rarity,
    })
  );
}
