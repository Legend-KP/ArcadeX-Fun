"use client";

import { useEffect, useRef, useState } from "react";
import { formatContestCountdown } from "@/lib/contest";
import { fetchLeaderboardData } from "@/lib/leaderboard-client";
import {
  CONTEST_TOP_MAX_ENTRIES,
  LEADERBOARD_MAX_ENTRIES,
  LeaderboardEntry,
  LeaderboardResponse,
} from "@/types";

export type LeaderboardMode = "default" | "postSubmit";

interface LeaderboardProps {
  gameId: string;
  gameName: string;
  open: boolean;
  onClose: () => void;
  mode?: LeaderboardMode;
  walletAddress?: string;
  playerName?: string;
  playerId?: string;
  chainId?: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];
const SWIPE_THRESHOLD = 60;
const TASK_PREVIEW_LEN = 72;

export default function Leaderboard({
  gameId,
  gameName,
  open,
  onClose,
  mode = "default",
  walletAddress,
  playerName,
  playerId,
  chainId,
}: LeaderboardProps) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [taskExpanded, setTaskExpanded] = useState(false);
  const [countdownMs, setCountdownMs] = useState(0);
  const touchStartY = useRef<number | null>(null);

  const isPostSubmit = mode === "postSubmit";
  const showContestBoard = data?.contest?.status === "live";
  const contestEnded =
    data?.contest?.status === "ended" && Boolean(data.contest);

  const displayEntries = showContestBoard
    ? (data?.contest?.entries ?? []).slice(0, CONTEST_TOP_MAX_ENTRIES)
    : (data?.entries ?? []).slice(0, LEADERBOARD_MAX_ENTRIES);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchLeaderboardData(gameId, {
      walletAddress,
      playerName,
      playerId,
      chainId,
    })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, gameId, walletAddress, playerName, playerId, chainId]);

  useEffect(() => {
    if (!open || !showContestBoard || !data?.contest?.endsAt) return;

    const tick = () => {
      setCountdownMs(Math.max(0, data.contest!.endsAt - Date.now()));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [open, showContestBoard, data?.contest?.endsAt]);

  useEffect(() => {
    if (!open) {
      setTaskExpanded(false);
    }
  }, [open]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isPostSubmit) return;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isPostSubmit) return;
    if (touchStartY.current === null) return;
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    touchStartY.current = null;
    if (delta > SWIPE_THRESHOLD) onClose();
  };

  const handleBackdropClick = () => {
    if (isPostSubmit) return;
    onClose();
  };

  if (!open) return null;

  const contestTask = data?.contest?.task ?? "";
  const taskNeedsExpand = contestTask.length > TASK_PREVIEW_LEN;
  const taskDisplay =
    taskNeedsExpand && !taskExpanded
      ? `${contestTask.slice(0, TASK_PREVIEW_LEN)}…`
      : contestTask;

  const emptyMessage = showContestBoard
    ? "No contest scores yet — be the first!"
    : "No scores yet — be the first!";

  return (
    <div
      className="lb-backdrop"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={[
          "lb-sheet",
          showContestBoard && "lb-sheet--contest",
          isPostSubmit && "lb-sheet--post-submit",
        ]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={`${gameName} leaderboard`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {isPostSubmit && (
          <div className="lb-post-submit-banner" role="status">
            Score submitted!
          </div>
        )}

        <div className="lb-header">
          <div className="lb-title-wrap">
            <span className="lb-trophy" aria-hidden="true">
              🏆
            </span>
            <span className="lb-title">{gameName}</span>
          </div>
          {!isPostSubmit && (
            <button
              type="button"
              className="lb-close"
              onClick={onClose}
              aria-label="Close leaderboard"
            >
              ✕
            </button>
          )}
        </div>

        {showContestBoard && (
          <div className="lb-contest-live-badge" aria-live="polite">
            <span className="lb-contest-live-dot" aria-hidden />
            CONTEST LIVE
          </div>
        )}

        {contestEnded && (
          <div className="lb-contest-coming-soon">Contest Coming Soon…</div>
        )}

        {showContestBoard && data?.contest && (
          <div className="lb-contest-timer">
            <span className="lb-contest-timer-label">Time remaining</span>
            <span className="lb-contest-timer-value">
              {formatContestCountdown(countdownMs)}
            </span>
          </div>
        )}

        {showContestBoard && (
          <div className="lb-contest-columns" aria-hidden>
            <span>#</span>
            <span>PLAYER</span>
            <span>SCORE</span>
          </div>
        )}

        <div className="lb-list">
          {loading && <p className="lb-empty">Loading...</p>}
          {!loading && displayEntries.length === 0 && (
            <p className="lb-empty">{emptyMessage}</p>
          )}
          {!loading &&
            displayEntries.map((e: LeaderboardEntry, i: number) => (
              <div
                key={`${e.walletAddress ?? e.name}-${i}`}
                className={`lb-row${i === 0 ? " lb-row--first" : ""}${i < 3 ? " lb-row--podium" : ""}`}
              >
                <span
                  className={`lb-pos ${i < 3 ? ["gold", "silver", "bronze"][i] : "other"}`}
                >
                  {i < 3 ? MEDALS[i] : `#${i + 1}`}
                </span>
                <span className="lb-name">{e.name}</span>
                <span className="lb-score">
                  {showContestBoard && (
                    <span className="lb-score-coin" aria-hidden>
                      🪙
                    </span>
                  )}
                  {e.score.toLocaleString()}
                </span>
              </div>
            ))}
        </div>

        {showContestBoard && displayEntries.length > 0 && (
          <p className="lb-contest-stats">
            {displayEntries.length} Total Participants
          </p>
        )}

        {showContestBoard && contestTask && (
          <div className="lb-contest-task">
            <p className="lb-contest-task-label">How it works</p>
            <p className="lb-contest-task-text">{taskDisplay}</p>
            {taskNeedsExpand && (
              <button
                type="button"
                className="lb-contest-task-toggle"
                onClick={() => setTaskExpanded((v) => !v)}
              >
                {taskExpanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}

        {!showContestBoard &&
          typeof data?.submittedBest === "number" &&
          data.submittedBest > 0 && (
            <p className="lb-submitted-best">
              Your best submitted score:{" "}
              <strong>{data.submittedBest.toLocaleString()}</strong>
            </p>
          )}

        {isPostSubmit && (
          <button
            type="button"
            className="lb-continue-btn"
            onClick={onClose}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
