"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatChainError } from "@/lib/base-public-client";
import { isPaymentStillConfirmingError } from "@/lib/payment-tx-verify";
import { getDailyPlayNetworkCopy, getDailyCheckInTxExplorerUrl } from "@/lib/daily-play-ui";
import {
  confirmExistingCheckIn,
  fetchStreakStatus,
  getPendingDailyCheckInTx,
  performDailyCheckIn,
  recoverPendingDailyCheckIn,
  refreshSessionFromCheckIn,
  type StreakStatus,
} from "@/lib/streak-client";
import { readCompletedCheckIn } from "@/lib/streak-done";
import { isPlausibleEvmTxHash } from "@/lib/tx-hash";

interface DailyCheckInModalProps {
  open: boolean;
  walletAddress: string;
  chainId?: number;
  status: StreakStatus | null;
  onComplete: (result?: {
    day: number;
    milestone: boolean;
    infiniteSparkGranted: boolean;
  }) => void;
}

function FlameIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2c1.5 3.2-.2 5.2-1.6 6.7C8.8 10.3 8 12 8 14.2 8 17.4 10.2 20 13 20c2.6 0 4.7-2 4.9-4.6.2-2.2-.8-3.6-1.7-4.7-.5-.6-.9-1.2-1-2-.1 1.4.5 2.5 1.1 3.4 1.4 2 1.7 3.5 1.6 4.9C17.7 20.3 15.1 22.5 12 22.5 8.1 22.5 5 19.3 5 15.2c0-2.6 1.1-4.5 2.5-6C9 7.5 10.4 5.6 12 2z"
        fill="currentColor"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M5 10.5 8.2 14 15 6.5"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChestIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="4" y="14" width="24" height="14" rx="3" fill="#b45309" />
      <path d="M4 16h24v5H4z" fill="#f59e0b" />
      <rect x="6" y="8" width="20" height="8" rx="2" fill="#d97706" />
      <circle cx="16" cy="19" r="2.2" fill="#fde68a" />
      <circle cx="10" cy="12" r="1.6" fill="#34d399" />
      <circle cx="22" cy="11" r="1.4" fill="#60a5fa" />
      <circle cx="16" cy="9" r="1.5" fill="#f472b6" />
    </svg>
  );
}

function InfinitySparkIcon({ gradientId }: { gradientId: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden>
      <circle cx="20" cy="20" r="18" fill={`url(#${gradientId})`} />
      <path
        d="M20 8.5 22.4 16H30l-6.2 4.4L26.2 28 20 23.4 13.8 28l2.4-7.6L10 16h7.6L20 8.5z"
        fill="#fff"
      />
      <defs>
        <linearGradient id={gradientId} x1="6" y1="6" x2="34" y2="34">
          <stop stopColor="#fbbf24" />
          <stop offset="0.55" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 2.5 16 5v4.8c0 3.7-2.4 6.2-6 7.7-3.6-1.5-6-4-6-7.7V5l6-2.5z"
        fill="rgba(255,255,255,0.28)"
        stroke="#fff"
        strokeWidth="1.2"
      />
      <path
        d="M7.2 10.1 9.1 12l3.8-4.2"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function dayNodeState(
  day: number,
  currentDay: number,
  checkInDay: number,
  wouldReset: boolean
): "done" | "today" | "upcoming" {
  if (wouldReset) {
    return day === 1 ? "today" : "upcoming";
  }
  if (currentDay >= day) return "done";
  if (checkInDay === day) return "today";
  return "upcoming";
}

export default function DailyCheckInModal({
  open,
  walletAddress,
  chainId,
  status,
  onComplete,
}: DailyCheckInModalProps) {
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<"wallet" | "sync" | null>(
    null
  );
  const [error, setError] = useState("");
  const [liveStatus, setLiveStatus] = useState<StreakStatus | null>(status);
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null);
  const infinityGradId = useId().replace(/:/g, "");
  const recoverAttemptedRef = useRef(false);

  useEffect(() => {
    setLiveStatus(status);
  }, [status]);

  // Load status on open only when parent had none. If already checked in, mint session and dismiss.
  useEffect(() => {
    if (!open || !walletAddress || recoverAttemptedRef.current) return;
    recoverAttemptedRef.current = true;

    const campaignId = status?.campaignId;
    const storedPending = getPendingDailyCheckInTx(
      walletAddress,
      campaignId,
      chainId
    );
    if (storedPending && isPlausibleEvmTxHash(storedPending)) {
      setPendingTxHash(storedPending);
    } else if (storedPending) {
      setPendingTxHash(null);
    }

    const completed =
      typeof campaignId === "number" && typeof chainId === "number"
        ? readCompletedCheckIn(walletAddress, chainId, campaignId)
        : null;
    if (completed && !storedPending) {
      let cancelled = false;
      (async () => {
        try {
          await refreshSessionFromCheckIn(
            walletAddress,
            campaignId,
            chainId,
            completed.txHash
          );
        } catch {
          // Still dismiss — local done flag means ceremony already finished.
        }
        if (!cancelled) onComplete();
      })();
      return () => {
        cancelled = true;
      };
    }

    // Parent already loaded a check-in-needed status — skip another fresh RPC.
    if (status?.canCheckIn && !storedPending) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const recovered = await recoverPendingDailyCheckIn(
          walletAddress,
          campaignId,
          chainId
        );
        if (cancelled) return;
        if (recovered) {
          setPendingTxHash(null);
          onComplete({
            day: recovered.day,
            milestone: recovered.milestone,
            infiniteSparkGranted: Boolean(recovered.reward?.granted),
          });
          return;
        }

        const fresh = await fetchStreakStatus(walletAddress, campaignId, {
          fresh: true,
          chainId,
        });
        if (cancelled) return;
        setLiveStatus(fresh);

        if (!fresh.canCheckIn && fresh.lastCheckInAt > 0) {
          try {
            await refreshSessionFromCheckIn(
              walletAddress,
              campaignId,
              chainId,
              storedPending ?? completed?.txHash ?? undefined
            );
          } catch {
            // Session mint is best-effort; still dismiss the ceremony.
          }
          if (!cancelled) onComplete();
        }
      } catch {
        // Still need a check-in / user action
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, walletAddress, status, chainId, onComplete]);

  useEffect(() => {
    if (!open) {
      recoverAttemptedRef.current = false;
      setError("");
      setLoadingPhase(null);
    }
  }, [open]);

  // Never trap the user on an endless "Confirming…" spinner.
  useEffect(() => {
    if (!loading) return;
    const watchdog = window.setTimeout(() => {
      setLoading(false);
      setLoadingPhase(null);
      setError(
        pendingTxHash
          ? "Sync is taking longer than expected. Tap Confirm check-in below — do not send another transaction."
          : "Check-in is taking longer than expected. If your wallet already confirmed, wait a moment and tap the button again."
      );
    }, 35_000);
    return () => window.clearTimeout(watchdog);
  }, [loading, pendingTxHash]);

  if (!open || typeof document === "undefined") return null;

  const view = liveStatus ?? status;
  const network = getDailyPlayNetworkCopy(chainId);
  const { label: chainLabel, explorerName } = network;
  const requiredDays = view?.campaign.requiredDays ?? 7;
  const currentDay = view?.currentDay ?? 0;
  const wouldReset = Boolean(view?.streakWouldReset);
  const checkInDay = wouldReset
    ? 1
    : currentDay === 0
      ? 1
      : Math.min(currentDay + 1, requiredDays);
  const displayStreak = wouldReset ? 0 : currentDay;
  const isFinalDay = checkInDay >= requiredDays;
  const days = Array.from({ length: requiredDays }, (_, i) => i + 1);
  const alreadyCheckedInToday = Boolean(
    view && !view.canCheckIn && view.lastCheckInAt > 0
  );

  const streakHint = wouldReset
    ? "You missed a day — check in to start fresh."
    : displayStreak <= 0
      ? "Check in today to begin your 7-day run."
      : isFinalDay
        ? "Final check-in unlocks Infinite Spark!"
        : displayStreak === 1
          ? "Nice! Come back tomorrow 🔥"
          : "Good start! Keep it going! 🔥";

  const nextRewardTitle = isFinalDay
    ? `Day ${requiredDays} Reward`
    : `Day ${requiredDays} Milestone`;
  const nextRewardDetail = "Infinite Spark · 24 hours";
  const nextRewardBadge = isFinalDay
    ? "Today"
    : displayStreak > 0
      ? `${requiredDays - displayStreak} days left`
      : `Day ${requiredDays}`;

  async function finishWithResult(result: {
    day: number;
    milestone: boolean;
    infiniteSparkGranted: boolean;
  }) {
    setPendingTxHash(null);
    onComplete(result);
  }

  async function handleCheckIn() {
    setLoading(true);
    setLoadingPhase(pendingTxHash ? "sync" : "wallet");
    setError("");
    try {
      const result = await performDailyCheckIn(
        walletAddress,
        view?.campaignId ?? status?.campaignId,
        chainId,
        {
          onTxSubmitted: (txHash) => {
            if (isPlausibleEvmTxHash(txHash)) {
              setPendingTxHash(txHash);
            }
            setLoadingPhase("sync");
          },
        }
      );
      await finishWithResult({
        day: result.day,
        milestone: result.milestone,
        infiniteSparkGranted: Boolean(result.reward?.granted),
      });
    } catch (err) {
      const maybeHash =
        err && typeof err === "object" && "txHash" in err
          ? String((err as { txHash?: string }).txHash ?? "")
          : pendingTxHash ?? "";
      if (maybeHash && isPlausibleEvmTxHash(maybeHash)) {
        setPendingTxHash(maybeHash);
      }

      // Tx may have landed even when the UI error path fired — recover session.
      try {
        const recovered = await recoverPendingDailyCheckIn(
          walletAddress,
          view?.campaignId ?? status?.campaignId,
          chainId
        );
        if (recovered) {
          await finishWithResult({
            day: recovered.day,
            milestone: recovered.milestone,
            infiniteSparkGranted: Boolean(recovered.reward?.granted),
          });
          return;
        }

        const fresh = await fetchStreakStatus(
          walletAddress,
          view?.campaignId ?? status?.campaignId,
          { fresh: true, chainId }
        );
        setLiveStatus(fresh);
        if (!fresh.canCheckIn && fresh.lastCheckInAt > 0) {
          await refreshSessionFromCheckIn(
            walletAddress,
            view?.campaignId ?? status?.campaignId,
            chainId,
            maybeHash || undefined
          );
          await finishWithResult({
            day: fresh.currentDay,
            milestone: fresh.milestoneReached,
            infiniteSparkGranted: false,
          });
          return;
        }
      } catch {
        // Keep original error for the user.
      }
      setError(
        isPaymentStillConfirmingError(err)
          ? "Check-in submitted on-chain. Tap Confirm check-in below — do not send another tx."
          : formatChainError(err) || "Check-in failed. Try again."
      );
    } finally {
      setLoading(false);
      setLoadingPhase(null);
    }
  }

  async function handleConfirmPendingTx() {
    if (!pendingTxHash) return;
    setLoading(true);
    setLoadingPhase("sync");
    setError("");
    try {
      const result = await confirmExistingCheckIn(
        walletAddress,
        pendingTxHash,
        view?.campaignId ?? status?.campaignId,
        chainId
      );
      await finishWithResult({
        day: result.day,
        milestone: result.milestone,
        infiniteSparkGranted: Boolean(result.reward?.granted),
      });
    } catch (err) {
      try {
        const recovered = await recoverPendingDailyCheckIn(
          walletAddress,
          view?.campaignId ?? status?.campaignId,
          chainId
        );
        if (recovered) {
          await finishWithResult({
            day: recovered.day,
            milestone: recovered.milestone,
            infiniteSparkGranted: Boolean(recovered.reward?.granted),
          });
          return;
        }

        const fresh = await fetchStreakStatus(
          walletAddress,
          view?.campaignId ?? status?.campaignId,
          { fresh: true, chainId }
        );
        setLiveStatus(fresh);
        if (!fresh.canCheckIn && fresh.lastCheckInAt > 0) {
          await refreshSessionFromCheckIn(
            walletAddress,
            view?.campaignId ?? status?.campaignId,
            chainId,
            pendingTxHash
          );
          await finishWithResult({
            day: fresh.currentDay,
            milestone: fresh.milestoneReached,
            infiniteSparkGranted: false,
          });
          return;
        }
      } catch {
        // keep error
      }
      setError(
        isPaymentStillConfirmingError(err)
          ? "Still syncing your check-in. Wait a few seconds and tap Confirm check-in again."
          : formatChainError(err) || "Could not sync check-in."
      );
    } finally {
      setLoading(false);
      setLoadingPhase(null);
    }
  }

  const txExplorerUrl = pendingTxHash
    ? getDailyCheckInTxExplorerUrl(chainId, pendingTxHash)
    : null;
  const loadingLabel =
    loadingPhase === "wallet"
      ? "Approve in your wallet…"
      : loadingPhase === "sync"
        ? "Syncing check-in…"
        : "Confirming…";
  const loadingSubLabel =
    loadingPhase === "wallet"
      ? `Confirm the ${chainLabel} transaction`
      : pendingTxHash
        ? `Verifying tx on ${explorerName}`
        : `Syncing your ${chainLabel} check-in`;

  return createPortal(
    <div className="player-modal-backdrop" role="dialog" aria-modal="true">
      <div className="player-modal daily-checkin-modal">
        <h2 className="daily-checkin-heading">
          <FlameIcon className="daily-checkin-heading-flame" />
          Daily Streak
          <FlameIcon className="daily-checkin-heading-flame" />
        </h2>
        <p className="daily-checkin-network" aria-label={`Network ${chainLabel}`}>
          on {chainLabel}
        </p>
        <p className="daily-checkin-sub">
          Check in once per day (resets 00:00 UTC) to keep your streak alive and
          earn <span className="daily-checkin-sub-accent">Infinite Spark.</span>
        </p>

        <section className="daily-checkin-hero-card">
          <div className="daily-checkin-hero-flame" aria-hidden>
            <FlameIcon />
          </div>
          <div className="daily-checkin-hero-copy">
            <p className="daily-checkin-section-label daily-checkin-section-label--light">
              Your streak
            </p>
            <p className="daily-checkin-streak-value">
              {displayStreak > 0 ? (
                <>
                  <span className="daily-checkin-streak-num">
                    {displayStreak}
                  </span>{" "}
                  <span className="daily-checkin-streak-unit">
                    Day{displayStreak === 1 ? "" : "s"}
                  </span>
                </>
              ) : (
                <span className="daily-checkin-streak-unit">Start today</span>
              )}
            </p>
            <p className="daily-checkin-streak-hint">{streakHint}</p>
          </div>
        </section>

        <section
          className="daily-checkin-timeline"
          aria-label={`${requiredDays}-day streak progress`}
        >
          {days.map((day) => {
            const state = dayNodeState(
              day,
              currentDay,
              checkInDay,
              wouldReset
            );
            const isMilestone = day === requiredDays;

            return (
              <div
                key={day}
                className={`daily-checkin-day daily-checkin-day--${state}${
                  isMilestone ? " daily-checkin-day--milestone" : ""
                }`}
              >
                <div className="daily-checkin-day-node">
                  {state === "done" ? (
                    <span className="daily-checkin-check">
                      <CheckIcon />
                    </span>
                  ) : isMilestone ? (
                    <span className="daily-checkin-day-chest" aria-hidden>
                      <ChestIcon />
                    </span>
                  ) : (
                    <span className="daily-checkin-day-num">{day}</span>
                  )}
                </div>
                {state === "today" ? (
                  <span className="daily-checkin-day-today">Today</span>
                ) : (
                  <span className="daily-checkin-day-label">Day {day}</span>
                )}
              </div>
            );
          })}
        </section>

        <section className="daily-checkin-reward-card">
          <div className="daily-checkin-reward-row">
            <div className="daily-checkin-reward-icon">
              <InfinitySparkIcon gradientId={`inf-${infinityGradId}`} />
            </div>
            <div className="daily-checkin-reward-copy">
              <p className="daily-checkin-section-label">Next reward</p>
              <p className="daily-checkin-reward-title">{nextRewardTitle}</p>
              <p className="daily-checkin-reward-detail">{nextRewardDetail}</p>
            </div>
            <span className="daily-checkin-reward-badge">{nextRewardBadge}</span>
          </div>
        </section>

        {error ? <p className="daily-checkin-error">{error}</p> : null}

        {pendingTxHash && !loading ? (
          <p className="daily-checkin-streak-hint" style={{ marginBottom: 10 }}>
            Tx {pendingTxHash.slice(0, 10)}…{pendingTxHash.slice(-8)} is on{" "}
            {chainLabel}.{" "}
            {txExplorerUrl ? (
              <a
                href={txExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="daily-checkin-sub-accent"
              >
                View on {explorerName}
              </a>
            ) : null}{" "}
            Confirm below — do not check in again.
          </p>
        ) : null}

        <button
          type="button"
          className="daily-checkin-btn"
          disabled={loading || !walletAddress}
          onClick={() => {
            if (alreadyCheckedInToday) {
              onComplete();
              return;
            }
            if (pendingTxHash) {
              void handleConfirmPendingTx();
              return;
            }
            void handleCheckIn();
          }}
        >
          <span className="daily-checkin-btn-main">
            <ShieldCheckIcon />
            {loading
              ? loadingLabel
              : alreadyCheckedInToday
                ? "Continue"
                : pendingTxHash
                  ? "Confirm check-in (no extra tx)"
                  : "Daily Check In (Free)"}
          </span>
          <span className="daily-checkin-btn-sub">
            {loading
              ? loadingSubLabel
              : alreadyCheckedInToday
                ? "Come back tomorrow"
                : pendingTxHash
                  ? `Uses your confirmed ${explorerName} transaction`
                  : network.gasHint}
          </span>
        </button>
      </div>
    </div>,
    document.body
  );
}
