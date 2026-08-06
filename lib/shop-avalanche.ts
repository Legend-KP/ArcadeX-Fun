import { getAddress } from "viem";
import {
  AVALANCHE_MAINNET_DEPLOYMENTS,
  avalancheEnvAddress,
} from "@/lib/avalanche-deployments";
import { shopPriceToAmount, type ShopProductId } from "@/lib/shop";

export const AVALANCHE_SHOP_RECIPIENT_ADDRESS = getAddress(
  avalancheEnvAddress(
    process.env.NEXT_PUBLIC_AVALANCHE_SHOP_RECIPIENT_ADDRESS,
    AVALANCHE_MAINNET_DEPLOYMENTS.shopRecipient
  )
);

export const AVALANCHE_USDC_ADDRESS = getAddress(
  avalancheEnvAddress(
    process.env.NEXT_PUBLIC_AVALANCHE_USDC_ADDRESS,
    AVALANCHE_MAINNET_DEPLOYMENTS.usdc
  )
);

export const AVALANCHE_SHOP_TOKEN_DECIMALS = 6;

export const AVALANCHE_SHOP_EXPLORER_TX_URL = "https://snowtrace.io/tx";

export type AvalancheShopPaymentToken = {
  id: "usdc";
  symbol: string;
  address: `0x${string}`;
};

export const AVALANCHE_SHOP_PAYMENT_TOKENS: AvalancheShopPaymentToken[] = [
  {
    id: "usdc",
    symbol: "USDC",
    address: AVALANCHE_USDC_ADDRESS,
  },
];

export function findAvalancheShopPaymentToken(
  address: string
): AvalancheShopPaymentToken | undefined {
  try {
    const normalized = getAddress(address);
    return AVALANCHE_SHOP_PAYMENT_TOKENS.find(
      (token) => getAddress(token.address) === normalized
    );
  } catch {
    return undefined;
  }
}

export function avalancheShopAmountForProduct(
  productId: ShopProductId
): bigint {
  const priceUsd = productId === "spark-refill" ? 0.2 : 0.5;
  return shopPriceToAmount(priceUsd, AVALANCHE_SHOP_TOKEN_DECIMALS);
}
