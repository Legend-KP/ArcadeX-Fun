"use client";

import type { ShopProductId } from "@/lib/shop";

const STORAGE_KEY = "arcadex_shop_purchase_pending_v1";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

export type PendingShopPurchaseTx = {
  playerId: string;
  productId: ShopProductId;
  txHash: string;
  tokenAddress: string;
  network: "base" | "avalanche" | "vara" | "sui";
  savedAt: number;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function savePendingShopPurchaseTx(entry: PendingShopPurchaseTx): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...entry,
        savedAt: Date.now(),
      })
    );
  } catch {
    // Private mode / quota
  }
}

export function readPendingShopPurchaseTx(
  playerId: string,
  productId: ShopProductId
): PendingShopPurchaseTx | null {
  if (!canUseStorage()) return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PendingShopPurchaseTx;
    if (parsed.playerId !== playerId) return null;
    if (parsed.productId !== productId) return null;
    if (!parsed.txHash) return null;
    if (Date.now() - Number(parsed.savedAt) > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingShopPurchaseTx(): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}
