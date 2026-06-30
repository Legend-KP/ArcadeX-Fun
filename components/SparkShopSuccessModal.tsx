"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { megaeth } from "@/lib/chains";
import { SUI_SHOP_EXPLORER_TX_URL } from "@/lib/shop-sui";
import {
  formatShopPrice,
  SHOP_PRODUCTS,
  type ShopPurchaseSuccess,
} from "@/lib/shop";

interface SparkShopSuccessModalProps {
  open: boolean;
  purchase: ShopPurchaseSuccess | null;
  onClose: () => void;
}

export default function SparkShopSuccessModal({
  open,
  purchase,
  onClose,
}: SparkShopSuccessModalProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !purchase) return null;

  const product = SHOP_PRODUCTS[purchase.productId];
  const explorerUrl =
    purchase.network === "sui"
      ? `${SUI_SHOP_EXPLORER_TX_URL}/${purchase.txHash}`
      : megaeth.blockExplorers?.default.url
        ? `${megaeth.blockExplorers.default.url}/tx/${purchase.txHash}`
        : null;

  const modal = (
    <div
      className="spark-shop-success-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="spark-shop-success"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spark-shop-success-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="spark-shop-success__icon" aria-hidden>
          ✓
        </div>

        <p className="spark-shop-success__eyebrow">Purchase successful</p>
        <h2 id="spark-shop-success-title" className="spark-shop-success__title">
          {product.successTitle}
        </h2>
        <p className="spark-shop-success__message">{product.successMessage}</p>

        <div className="spark-shop-success__meta">
          <span>{product.name}</span>
          <span>{formatShopPrice(product.priceUsd)}</span>
          <span>paid with {purchase.tokenSymbol}</span>
        </div>

        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="spark-shop-success__link"
          >
            View transaction
          </a>
        ) : null}

        <button
          type="button"
          className="spark-shop-success__btn"
          onClick={onClose}
        >
          Continue playing
        </button>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : null;
}
