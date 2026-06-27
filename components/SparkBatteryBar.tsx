"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSparks } from "@/components/SparkProvider";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import SparkShopPaymentModal from "@/components/SparkShopPaymentModal";
import SparkShopSuccessModal from "@/components/SparkShopSuccessModal";
import {
  formatShopPrice,
  SHOP_PRODUCTS,
  type ShopProductId,
  type ShopPurchaseSuccess,
} from "@/lib/shop";
import { formatSparkCountdown } from "@/lib/spark";

export default function SparkBatteryBar() {
  const { sparks, loading, refresh } = useSparks();
  const { isAuthenticated, playerId, ecosystem, openConnect } =
    usePlayerProfile();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [paymentProductId, setPaymentProductId] =
    useState<ShopProductId | null>(null);
  const [successPurchase, setSuccessPurchase] =
    useState<ShopPurchaseSuccess | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const displayAvailable = isAuthenticated ? sparks.available : sparks.max;
  const showInfinite = isAuthenticated && sparks.hasInfinite;
  const shopEnabled = isAuthenticated && ecosystem === "evm";

  function handleBuy(productId: ShopProductId) {
    if (!isAuthenticated) {
      openConnect();
      return;
    }

    if (ecosystem !== "evm") {
      return;
    }

    setOpen(false);
    setPaymentProductId(productId);
  }

  const panel = open ? (
    <div
      className="spark-panel-backdrop"
      role="presentation"
      onClick={() => setOpen(false)}
    >
      <div
        className="spark-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spark-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="spark-panel__close"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          ×
        </button>

        <h2 id="spark-panel-title" className="spark-panel__title">
          Sparks
        </h2>

        <p className="spark-panel__status">
          {showInfinite ? (
            <>Infinite Sparks active</>
          ) : (
            <>
              <strong>{displayAvailable}</strong> / {sparks.max} ready
            </>
          )}
        </p>

        {!isAuthenticated && (
          <p className="spark-panel__hint">
            Connect your wallet to track and spend Sparks.
          </p>
        )}

        {isAuthenticated && ecosystem !== "evm" && (
          <p className="spark-panel__hint">
            Shop purchases are available with an EVM wallet on MegaETH.
          </p>
        )}

        <div className="spark-panel__slots">
          {sparks.slots.map((slot) => (
            <div key={slot.index} className="spark-panel__slot">
              <div
                className={`spark-panel__slot-bar${
                  slot.status === "ready" ? " is-ready" : ""
                }`}
              >
                <div
                  className="spark-panel__slot-fill"
                  style={{ height: `${slot.fillPercent}%` }}
                />
              </div>
              <span className="spark-panel__slot-label">
                {slot.status === "ready"
                  ? "Ready"
                  : formatSparkCountdown(slot.timeRemainingMs)}
              </span>
            </div>
          ))}
        </div>

        {loading && (
          <p className="spark-panel__loading">Syncing Sparks…</p>
        )}

        <div className="spark-panel__shop">
          <h3 className="spark-panel__shop-title">Shop</h3>
          <div className="spark-shop-cards">
            <div className="spark-shop-card">
              <div className="spark-shop-card__info">
                <span className="spark-shop-card__name">
                  {SHOP_PRODUCTS["spark-refill"].name}
                </span>
                <span className="spark-shop-card__price">
                  {formatShopPrice(SHOP_PRODUCTS["spark-refill"].priceUsd)}
                </span>
              </div>
              <p className="spark-shop-card__desc">
                {SHOP_PRODUCTS["spark-refill"].description}
              </p>
              <button
                type="button"
                className="spark-shop-card__btn"
                disabled={!shopEnabled}
                onClick={() => handleBuy("spark-refill")}
              >
                {shopEnabled ? "Buy" : "Connect EVM wallet"}
              </button>
            </div>
            <div className="spark-shop-card">
              <div className="spark-shop-card__info">
                <span className="spark-shop-card__name">
                  {SHOP_PRODUCTS["infinite-24h"].name}
                </span>
                <span className="spark-shop-card__price">
                  {formatShopPrice(SHOP_PRODUCTS["infinite-24h"].priceUsd)}
                </span>
              </div>
              <p className="spark-shop-card__desc">
                {SHOP_PRODUCTS["infinite-24h"].description}
              </p>
              <button
                type="button"
                className="spark-shop-card__btn"
                disabled={!shopEnabled}
                onClick={() => handleBuy("infinite-24h")}
              >
                {shopEnabled ? "Buy" : "Connect EVM wallet"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className="spark-battery"
        onClick={() => setOpen(true)}
        aria-label={`${displayAvailable} of ${sparks.max} Sparks available`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="spark-battery__icon" aria-hidden>
          ⚡
        </span>
        <span className="spark-battery__segments" aria-hidden>
          {sparks.slots.map((slot) => (
            <span
              key={slot.index}
              className={`spark-battery__segment${
                slot.status === "ready" ? " is-ready" : " is-regenerating"
              }`}
            />
          ))}
        </span>
        {showInfinite && (
          <span className="spark-battery__infinite" aria-hidden>
            ∞
          </span>
        )}
      </button>

      {mounted && panel ? createPortal(panel, document.body) : null}

      <SparkShopPaymentModal
        open={paymentProductId !== null}
        productId={paymentProductId}
        playerId={playerId}
        onClose={() => setPaymentProductId(null)}
        onSuccess={(purchase) => {
          void refresh();
          setSuccessPurchase(purchase);
        }}
      />

      <SparkShopSuccessModal
        open={successPurchase !== null}
        purchase={successPurchase}
        onClose={() => setSuccessPurchase(null)}
      />
    </>
  );
}
