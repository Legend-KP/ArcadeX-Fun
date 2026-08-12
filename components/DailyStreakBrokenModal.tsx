"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type DailyStreakBroken = {
  previousDays: number;
  requiredDays?: number;
};

interface DailyStreakBrokenModalProps {
  open: boolean;
  result: DailyStreakBroken | null;
  onContinue: () => void;
}

function FlipDigit({
  from,
  to,
  play,
}: {
  from: number;
  to: number;
  play: boolean;
}) {
  return (
    <div
      className={`daily-streak-broken__flip${
        play ? " daily-streak-broken__flip--play" : ""
      }`}
      aria-hidden
    >
      <div className="daily-streak-broken__flip-card">
        <div className="daily-streak-broken__flip-face daily-streak-broken__flip-face--front">
          <span>{from}</span>
        </div>
        <div className="daily-streak-broken__flip-face daily-streak-broken__flip-face--back">
          <span>{to}</span>
        </div>
      </div>
    </div>
  );
}

export default function DailyStreakBrokenModal({
  open,
  result,
  onContinue,
}: DailyStreakBrokenModalProps) {
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    if (!open) {
      setFlipped(false);
      return;
    }
    setFlipped(false);
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delay = reduceMotion ? 80 : 520;
    const t = window.setTimeout(() => setFlipped(true), delay);
    return () => window.clearTimeout(t);
  }, [open, result?.previousDays]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onContinue();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onContinue]);

  if (!open || !result) return null;

  const previousDays = Math.max(1, Math.floor(result.previousDays));
  const requiredDays = result.requiredDays ?? 7;
  const dayLabel = previousDays === 1 ? "day" : "days";

  const modal = (
    <div
      className="spark-shop-success-backdrop"
      role="presentation"
      onClick={onContinue}
    >
      <div
        className="spark-shop-success daily-streak-broken"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-streak-broken-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="spark-shop-success__eyebrow daily-streak-broken__eyebrow">
          Daily Streak
        </p>
        <p className="daily-streak-broken__status">Streak paused</p>

        <div
          className="daily-streak-broken__counter"
          aria-label={`Streak reset from ${previousDays} to 0`}
        >
          <FlipDigit from={previousDays} to={0} play={flipped} />
          <p className="daily-streak-broken__counter-label">Day streak</p>
        </div>

        <h2
          id="daily-streak-broken-title"
          className="spark-shop-success__title"
        >
          Fresh run unlocked
        </h2>
        <p className="spark-shop-success__message">
          Nice {previousDays}-{dayLabel} run. A day slipped by, so the counter
          resets — check in today and you&apos;re back on track toward Infinite
          Spark.
        </p>

        <div className="spark-shop-success__meta">
          <span>
            Day 1 of {requiredDays} starts with today&apos;s check-in
          </span>
        </div>

        <button
          type="button"
          className="spark-shop-success__btn"
          onClick={onContinue}
          autoFocus
        >
          Start fresh
        </button>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : null;
}
