import { normalizeSuiAddress } from "@/lib/sui-address-lite";

export const SUI_USDC_COIN_TYPE =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

export const SUI_SHOP_RECIPIENT_ADDRESS = normalizeSuiAddress(
  process.env.NEXT_PUBLIC_SUI_SHOP_RECIPIENT_ADDRESS?.trim() ||
    "0x2b482d28dc11673506f79ec6781f9b79c29435eca36bfbb69f3fc5db6df887ca"
);

export const SUI_SHOP_EXPLORER_TX_URL = "https://suiscan.xyz/mainnet/tx";

export interface SuiShopPaymentToken {
  id: "usdc";
  symbol: "USDC";
  coinType: typeof SUI_USDC_COIN_TYPE;
}

export const SUI_SHOP_PAYMENT_TOKEN: SuiShopPaymentToken = {
  id: "usdc",
  symbol: "USDC",
  coinType: SUI_USDC_COIN_TYPE,
};

const SUI_TX_DIGEST_RE = /^[1-9A-HJ-NP-Za-km-z]{43,90}$/;

export function isValidSuiTxDigest(value: string): boolean {
  return SUI_TX_DIGEST_RE.test(value.trim());
}

export function normalizeSuiTxDigest(value: string): string {
  const digest = value.trim();
  if (!isValidSuiTxDigest(digest)) {
    throw new Error("Invalid Sui transaction digest.");
  }
  return digest;
}
