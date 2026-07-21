import { SHOP_TOKEN_DECIMALS, shopPriceToAmount } from "@/lib/shop";

/** Public leaderboard score submission price (USD). */
export const SCORE_SUBMIT_PRICE_USD = 0.05;

export function scoreSubmitPriceToAmount(): bigint {
  return shopPriceToAmount(SCORE_SUBMIT_PRICE_USD, SHOP_TOKEN_DECIMALS);
}

export function formatScoreSubmitPrice(): string {
  return `$${SCORE_SUBMIT_PRICE_USD.toFixed(2)}`;
}
