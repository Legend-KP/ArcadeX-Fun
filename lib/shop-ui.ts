import { primaryEvmChain } from "@/lib/chains";
import {
  getChainKeyForEvmChainId,
  getChainRegistryEntry,
} from "@/lib/chain-registry";
import type { WalletEcosystem } from "@/types";

export type ShopPaymentEcosystem = "evm" | "sui" | "vara";

export function isShopPaymentEcosystem(
  ecosystem: WalletEcosystem | null
): ecosystem is ShopPaymentEcosystem {
  return ecosystem === "evm" || ecosystem === "sui" || ecosystem === "vara";
}

export interface ShopPanelCopy {
  networkLabel: string;
  paymentHint: string;
  priceSuffix: string;
  disabledHint: string;
  unsupportedHint: string;
  getBuyButtonLabel: (params: {
    isAuthenticated: boolean;
    shopEnabled: boolean;
  }) => string;
}

function getEvmNetworkLabel(chainId?: number): string {
  if (!chainId) return primaryEvmChain.name;
  const key = getChainKeyForEvmChainId(chainId);
  if (!key) return primaryEvmChain.name;
  return getChainRegistryEntry(key).name;
}

export function getShopPanelCopy(
  ecosystem: WalletEcosystem | null,
  chainId?: number
): ShopPanelCopy | null {
  if (!ecosystem || !isShopPaymentEcosystem(ecosystem)) {
    return null;
  }

  const buyButtonLabel = ({
    isAuthenticated,
    shopEnabled,
  }: {
    isAuthenticated: boolean;
    shopEnabled: boolean;
  }) => {
    if (shopEnabled) return "Buy";
    if (!isAuthenticated) return "Connect wallet";
    return "Shop unavailable";
  };

  switch (ecosystem) {
    case "evm": {
      const networkLabel = getEvmNetworkLabel(chainId);
      return {
        networkLabel,
        paymentHint: `Pay with USDm or USDT0 on ${networkLabel}.`,
        priceSuffix: `on ${networkLabel}`,
        disabledHint: `Shop purchases on ${networkLabel} are currently unavailable.`,
        unsupportedHint: `Shop purchases are available with an EVM wallet on MegaETH.`,
        getBuyButtonLabel: buyButtonLabel,
      };
    }
    case "sui":
      return {
        networkLabel: "Sui",
        paymentHint: "Pay with USDC on Sui.",
        priceSuffix: "on Sui",
        disabledHint: "Shop purchases on Sui are currently unavailable.",
        unsupportedHint: "Shop purchases are available with a Sui wallet.",
        getBuyButtonLabel: buyButtonLabel,
      };
    case "vara":
      return {
        networkLabel: "Vara",
        paymentHint: "Pay with WUSDC or WUSDT on Vara.",
        priceSuffix: "on Vara",
        disabledHint: "Shop purchases on Vara are currently unavailable.",
        unsupportedHint: "Shop purchases are available with a Vara wallet.",
        getBuyButtonLabel: buyButtonLabel,
      };
  }
}

export function formatShopPriceForNetwork(
  priceUsd: number,
  copy: ShopPanelCopy | null
): string {
  const price = `$${priceUsd.toFixed(2)}`;
  return copy ? `${price} ${copy.priceSuffix}` : price;
}
