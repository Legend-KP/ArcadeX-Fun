"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

export type DailyStreakSuccess = {
  day: number;
  milestone: boolean;
  infiniteSparkGranted: boolean;
  requiredDays?: number;
};

interface DailyStreakSuccessModalProps {
  open: boolean;
  result: DailyStreakSuccess | null;
  onClose: () => void;
}

export default function DailyStreakSuccessModal({
  open,
  result,
  onClose,
}: DailyStreakSuccessModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !result) return null;

  const requiredDays = result.requiredDays ?? 7;
  const title = result.milestone
    ? `Day ${result.day} complete!`
    : `Day ${result.day} checked in!`;
  const message = result.infiniteSparkGranted
    ? "Infinite Spark unlocked for 24 hours. Go play."
    : result.milestone
      ? "Streak milestone reached. Come back tomorrow to keep going."
      : result.day >= requiredDays
        ? "Full streak locked for today."
        : `${requiredDays - result.day} day${
            requiredDays - result.day === 1 ? "" : "s"
          } left to unlock Infinite Spark.`;

  const modal = (
    <div
      className="spark-shop-success-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="spark-shop-success daily-streak-success"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-streak-success-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="spark-shop-success__icon daily-streak-success__icon" aria-hidden>
          {result.infiniteSparkGranted ? "∞" : "✓"}
        </div>

        <p className="spark-shop-success__eyebrow">Daily Streak</p>
        <h2
          id="daily-streak-success-title"
          className="spark-shop-success__title"
        >
          {title}
        </h2>
        <p className="spark-shop-success__message">{message}</p>

        <div className="spark-shop-success__meta">
          <span>
            Day {result.day} of {requiredDays}
          </span>
          {result.infiniteSparkGranted ? (
            <span>Infinite Spark · 24h</span>
          ) : (
            <span>Come back after 00:00 UTC</span>
          )}
        </div>

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
