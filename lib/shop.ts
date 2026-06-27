import { getAddress } from "viem";

export const SHOP_RECIPIENT_ADDRESS = getAddress(
  process.env.NEXT_PUBLIC_SHOP_RECIPIENT_ADDRESS?.trim() ||
    "0x11015f39Ac7389201aEc778Be8e3D84f2aF44A70"
);

export const INFINITE_SPARKS_MS = 24 * 60 * 60 * 1000;

export type ShopProductId = "spark-refill" | "infinite-24h";

export interface ShopProduct {
  id: ShopProductId;
  name: string;
  description: string;
  priceUsd: number;
  successTitle: string;
  successMessage: string;
}

export interface ShopPurchaseSuccess {
  productId: ShopProductId;
  txHash: string;
  tokenSymbol: string;
}

export const SHOP_TOKEN_DECIMALS = 6;

export const SHOP_PRODUCTS: Record<ShopProductId, ShopProduct> = {
  "spark-refill": {
    id: "spark-refill",
    name: "Spark Refill",
    description: "Instantly refill all Sparks",
    priceUsd: 0.2,
    successTitle: "Sparks refilled!",
    successMessage:
      "Payment received. All Sparks are ready — jump back in and play.",
  },
  "infinite-24h": {
    id: "infinite-24h",
    name: "Infinite 24h",
    description: "Unlimited game entries for 24 hours",
    priceUsd: 0.5,
    successTitle: "Infinite Sparks unlocked!",
    successMessage:
      "Payment received. Unlimited game entries are active for the next 24 hours.",
  },
};

export interface ShopPaymentToken {
  id: "usdm" | "usdt0";
  symbol: string;
  address: `0x${string}`;
}

export const SHOP_PAYMENT_TOKENS: ShopPaymentToken[] = [
  {
    id: "usdm",
    symbol: "USDm",
    address: "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
  },
  {
    id: "usdt0",
    symbol: "USDT0",
    address: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
  },
];

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

export function shopPriceToAmount(priceUsd: number, decimals: number): bigint {
  const scale = 10 ** decimals;
  return BigInt(Math.round(priceUsd * scale));
}

export function formatShopPrice(priceUsd: number): string {
  return `$${priceUsd.toFixed(2)}`;
}

export function isShopProductId(value: string): value is ShopProductId {
  return value === "spark-refill" || value === "infinite-24h";
}

export function findShopPaymentToken(
  address: string
): ShopPaymentToken | undefined {
  try {
    const normalized = getAddress(address);
    return SHOP_PAYMENT_TOKENS.find(
      (token) => getAddress(token.address) === normalized
    );
  } catch {
    return undefined;
  }
}
