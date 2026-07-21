"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSparks } from "@/components/SparkProvider";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { useChainSettings } from "@/components/ChainSettingsProvider";
import SparkShopPaymentModal from "@/components/SparkShopPaymentModal";
import SparkShopSuiPaymentModal from "@/components/SparkShopSuiPaymentModal";
import SparkShopVaraPaymentModal from "@/components/SparkShopVaraPaymentModal";
import SparkShopSuccessModal from "@/components/SparkShopSuccessModal";
import {
  SHOP_PRODUCTS,
  type ShopProductId,
  type ShopPurchaseSuccess,
} from "@/lib/shop";
import {
  formatShopPriceForNetwork,
  getShopPanelCopy,
  isShopPaymentEcosystem,
} from "@/lib/shop-ui";
import { formatSparkCountdown, SPARK_REGEN_MS } from "@/lib/spark";

function formatRegenHours(ms: number): string {
  const hours = Math.round(ms / (60 * 60 * 1000));
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export default function SparkBatteryBar() {
  const { sparks, loading, refresh } = useSparks();
  const { isAuthenticated, playerId, ecosystem, chainId, walletAddress, openConnect } =
    usePlayerProfile();
  const { isShopPaymentsEnabled } = useChainSettings();
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
  const allReady =
    isAuthenticated && !showInfinite && sparks.available === sparks.max;
  const shopEnabled =
    isAuthenticated &&
    ecosystem !== null &&
    isShopPaymentsEnabled(ecosystem, chainId);

  const shopCopy = getShopPanelCopy(ecosystem, chainId);

  function handleBuy(productId: ShopProductId) {
    if (!isAuthenticated) {
      openConnect();
      return;
    }

    if (!ecosystem || !isShopPaymentsEnabled(ecosystem, chainId)) {
      return;
    }

    setPaymentProductId(productId);
  }

  const panel = open ? (
    <div
      className="spark-panel-backdrop"
      role="presentation"
      onClick={() => setOpen(false)}
    >
      <div
        className="spark-panel spark-panel--v2"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spark-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="spark-panel__orb" aria-hidden>
          ⚡
        </div>

        <button
          type="button"
          className="spark-panel__close spark-panel__close--v2"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          ×
        </button>

        <div className="spark-panel__body">
        <h2 id="spark-panel-title" className="spark-panel__title spark-panel__title--v2">
          <span aria-hidden>✦</span> SPARKS <span aria-hidden>✦</span>
        </h2>

        <p className="spark-panel__tagline">
          Use Sparks to play any game. Once inside, play freely and infinitely!
        </p>

        <div className="spark-panel__status-card">
          <p className="spark-panel__status-label">YOUR SPARKS</p>

          <p className="spark-panel__balance">
            <span className="spark-panel__balance-icon" aria-hidden>
              ⚡
            </span>
            {showInfinite ? (
              <>
                <strong>∞</strong> Infinite Sparks active
              </>
            ) : (
              <>
                <strong>{displayAvailable}</strong> / {sparks.max} Sparks Available
              </>
            )}
          </p>

          {!showInfinite && (
            <div className="spark-panel__bars">
              {sparks.slots.map((slot) => (
                <div key={slot.index} className="spark-panel__bar-col">
                  <div
                    className={`spark-panel__bar${
                      slot.status === "ready" ? " is-ready" : ""
                    }`}
                  >
                    <div
                      className="spark-panel__bar-fill"
                      style={{ width: `${slot.fillPercent}%` }}
                    />
                  </div>
                  <span
                    className={`spark-panel__bar-label${
                      slot.status === "ready" ? " is-ready" : ""
                    }`}
                  >
                    {slot.status === "ready"
                      ? "READY"
                      : formatSparkCountdown(slot.timeRemainingMs)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {allReady && (
            <p className="spark-panel__full-badge">All Sparks are full! ✦</p>
          )}

          <p className="spark-panel__info-box">
            <span className="spark-panel__info-icon" aria-hidden>
              ℹ
            </span>
            1 Spark = 1 game entry. Each Spark refills in{" "}
            {formatRegenHours(SPARK_REGEN_MS)}.
          </p>
        </div>

        {loading && (
          <p className="spark-panel__loading">Syncing Sparks…</p>
        )}

        {!isAuthenticated && (
          <p className="spark-panel__hint spark-panel__hint--v2">
            Connect your wallet to track and spend Sparks.
          </p>
        )}

        {isAuthenticated && shopEnabled && shopCopy && (
          <p className="spark-panel__hint spark-panel__hint--v2">
            {shopCopy.paymentHint}
          </p>
        )}

        {isAuthenticated && !shopEnabled && isShopPaymentEcosystem(ecosystem) && shopCopy && (
          <p className="spark-panel__hint spark-panel__hint--v2">
            {shopCopy.disabledHint}
          </p>
        )}

        <div className="spark-panel__shop spark-panel__shop--v2">
          <h3 className="spark-panel__shop-title spark-panel__shop-title--v2">
            ✦ GET MORE SPARKS ✦
          </h3>

          <div className="spark-shop-cards spark-shop-cards--v2">
            <article className="spark-shop-card spark-shop-card--refill">
              <div className="spark-shop-card__icon spark-shop-card__icon--coin" aria-hidden>
                ⚡
              </div>
              <div className="spark-shop-card__content">
                <p className="spark-shop-card__name">Spark Refill</p>
                <p className="spark-shop-card__desc">
                  Instantly refill your Spark bar to full.
                </p>
                <span className="spark-shop-card__badge spark-shop-card__badge--gold">
                  Best for quick top-up
                </span>
              </div>
              <button
                type="button"
                className="spark-shop-card__price-btn spark-shop-card__price-btn--gold"
                disabled={isAuthenticated && !shopEnabled}
                onClick={() => handleBuy("spark-refill")}
              >
                {formatShopPriceForNetwork(
                  SHOP_PRODUCTS["spark-refill"].priceUsd,
                  shopCopy
                )}
                <span aria-hidden>›</span>
              </button>
            </article>

            <article className="spark-shop-card spark-shop-card--infinite">
              <div className="spark-shop-card__icon spark-shop-card__icon--infinite" aria-hidden>
                ∞
              </div>
              <div className="spark-shop-card__content">
                <p className="spark-shop-card__name">Infinite Spark (24h)</p>
                <p className="spark-shop-card__desc">
                  Unlimited game access for 24 hours.
                </p>
                <span className="spark-shop-card__badge spark-shop-card__badge--purple">
                  Play without limits
                </span>
              </div>
              <button
                type="button"
                className="spark-shop-card__price-btn spark-shop-card__price-btn--purple"
                disabled={isAuthenticated && !shopEnabled}
                onClick={() => handleBuy("infinite-24h")}
              >
                {formatShopPriceForNetwork(
                  SHOP_PRODUCTS["infinite-24h"].priceUsd,
                  shopCopy
                )}
                <span aria-hidden>›</span>
              </button>
            </article>
          </div>

          <p className="spark-panel__shop-footnote">
            <span aria-hidden>🛡</span> Infinite Spark removes the entry gate only.
            Weekly leaderboard attempt limits still apply.
          </p>
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
        open={paymentProductId !== null && ecosystem === "evm"}
        productId={paymentProductId}
        playerId={playerId}
        onClose={() => setPaymentProductId(null)}
        onSuccess={(purchase) => {
          void refresh();
          setSuccessPurchase(purchase);
        }}
      />

      <SparkShopSuiPaymentModal
        open={paymentProductId !== null && ecosystem === "sui"}
        productId={paymentProductId}
        playerId={playerId}
        walletAddress={walletAddress}
        onClose={() => setPaymentProductId(null)}
        onSuccess={(purchase) => {
          void refresh();
          setSuccessPurchase(purchase);
        }}
      />

      <SparkShopVaraPaymentModal
        open={paymentProductId !== null && ecosystem === "vara"}
        productId={paymentProductId}
        playerId={playerId}
        walletAddress={walletAddress}
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
