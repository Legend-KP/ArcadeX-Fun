"use client";

import { useEffect, useState } from "react";
import { useSparks } from "@/components/SparkProvider";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import {
  formatSparkCountdown,
  formatSparkDuration,
} from "@/lib/spark";

export default function SparkBatteryBar() {
  const { sparks, loading } = useSparks();
  const { isAuthenticated } = usePlayerProfile();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const displayAvailable = isAuthenticated ? sparks.available : sparks.max;
  const showInfinite = isAuthenticated && sparks.hasInfinite;

  return (
    <>
      <button
        type="button"
        className="spark-battery"
        onClick={() => setOpen(true)}
        aria-label={`${displayAvailable} of ${sparks.max} Sparks available`}
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

      {open && (
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

            {!showInfinite && sparks.regeneratingCount > 0 && (
              <div className="spark-panel__timers">
                {sparks.regeneratingCount === 1 ? (
                  <p>
                    Refills in{" "}
                    <strong>{formatSparkCountdown(sparks.timeToNextMs)}</strong>
                  </p>
                ) : (
                  <>
                    <p>
                      Next Spark in{" "}
                      <strong>
                        {formatSparkCountdown(sparks.timeToNextMs)}
                      </strong>
                    </p>
                    <p>
                      All Sparks ready in{" "}
                      <strong>{formatSparkDuration(sparks.timeToFullMs)}</strong>
                    </p>
                  </>
                )}
              </div>
            )}

            {loading && (
              <p className="spark-panel__loading">Syncing Sparks…</p>
            )}

            <div className="spark-panel__shop">
              <h3 className="spark-panel__shop-title">Shop</h3>
              <div className="spark-shop-cards">
                <div className="spark-shop-card">
                  <div className="spark-shop-card__info">
                    <span className="spark-shop-card__name">Spark Refill</span>
                    <span className="spark-shop-card__price">$0.04</span>
                  </div>
                  <p className="spark-shop-card__desc">
                    Instantly refill all Sparks
                  </p>
                  <button type="button" className="spark-shop-card__btn" disabled>
                    Coming soon
                  </button>
                </div>
                <div className="spark-shop-card">
                  <div className="spark-shop-card__info">
                    <span className="spark-shop-card__name">Infinite 24h</span>
                    <span className="spark-shop-card__price">$0.10</span>
                  </div>
                  <p className="spark-shop-card__desc">
                    Unlimited game entries for 24 hours
                  </p>
                  <button type="button" className="spark-shop-card__btn" disabled>
                    Coming soon
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
