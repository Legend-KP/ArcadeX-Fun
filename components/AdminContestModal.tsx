"use client";

import { useEffect, useState } from "react";
import {
  buildContestEditPayload,
  buildContestStartPayload,
  CONTEST_DURATION_OPTIONS,
  formatContestCountdown,
} from "@/lib/contest";
import { fetchLeaderboardData } from "@/lib/leaderboard-client";
import { updateAdminGame } from "@/lib/admin-api";
import {
  ContestDurationDays,
  Game,
  gameHasContestLive,
  getContestStatus,
  LeaderboardEntry,
} from "@/types";

interface AdminContestModalProps {
  game: Game;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

export default function AdminContestModal({
  game,
  open,
  onClose,
  onUpdated,
}: AdminContestModalProps) {
  const [durationDays, setDurationDays] = useState<ContestDurationDays>(
    game.contestDurationDays ?? 1
  );
  const [task, setTask] = useState(game.contestTask ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [countdownMs, setCountdownMs] = useState(0);

  const contestStatus = getContestStatus(game);
  const isLive = gameHasContestLive(game);
  const isEnded = contestStatus === "ended";
  const isPlanning = !contestStatus;

  useEffect(() => {
    if (!open) return;
    setDurationDays(game.contestDurationDays ?? 1);
    setTask(game.contestTask ?? "");
    setError("");
  }, [open, game]);

  useEffect(() => {
    if (!open || !game.contestStartedAt) return;

    setLoadingEntries(true);
    fetchLeaderboardData(game.id)
      .then((data) => setEntries(data.contest?.entries ?? []))
      .catch(() => setEntries([]))
      .finally(() => setLoadingEntries(false));
  }, [open, game.id, game.contestStartedAt, game.contestEndsAt]);

  useEffect(() => {
    if (!open || !isLive || !game.contestEndsAt) return;

    const tick = () => setCountdownMs(Math.max(0, game.contestEndsAt! - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [open, isLive, game.contestEndsAt]);

  if (!open) return null;

  async function handleStartContest() {
    if (!task.trim()) {
      setError("Contest task description is required.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await updateAdminGame(game.id, buildContestStartPayload({ task, durationDays }));
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start contest.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!task.trim()) {
      setError("Contest task description is required.");
      return;
    }
    if (typeof game.contestStartedAt !== "number") return;

    setSaving(true);
    setError("");
    try {
      await updateAdminGame(
        game.id,
        buildContestEditPayload({
          task,
          durationDays,
          startedAt: game.contestStartedAt,
        })
      );
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update contest.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStartNewContest() {
    if (!task.trim()) {
      setError("Contest task description is required.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await updateAdminGame(game.id, buildContestStartPayload({ task, durationDays }));
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start contest.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-contest-backdrop" onClick={onClose} role="presentation">
      <div
        className="admin-contest-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-contest-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-contest-header">
          <h2 id="admin-contest-title">Contest — {game.name}</h2>
          <button type="button" className="admin-contest-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {isLive && (
          <div className="admin-contest-banner admin-contest-banner--live">
            Contest live · {formatContestCountdown(countdownMs)} remaining
          </div>
        )}

        {isEnded && (
          <div className="admin-contest-banner admin-contest-banner--ended">
            Contest ended
          </div>
        )}

        <div className="admin-contest-form">
          <label className="form-label">Duration</label>
          <div className="admin-contest-durations">
            {CONTEST_DURATION_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                className={`admin-contest-duration${
                  durationDays === days ? " is-selected" : ""
                }`}
                onClick={() => setDurationDays(days)}
                disabled={saving}
              >
                {days}d
              </button>
            ))}
          </div>

          <label className="form-label" htmlFor="contest-task">
            Contest task
          </label>
          <textarea
            id="contest-task"
            className="form-input admin-contest-task"
            rows={4}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe how players compete in this contest…"
            disabled={saving}
          />

          {error && (
            <p className="error-msg" role="alert">
              {error}
            </p>
          )}

          {isPlanning && (
            <button
              type="button"
              className="add-submit-btn"
              onClick={() => void handleStartContest()}
              disabled={saving}
            >
              {saving ? "Starting…" : "Start Contest"}
            </button>
          )}

          {isLive && (
            <button
              type="button"
              className="add-submit-btn"
              onClick={() => void handleSaveEdit()}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          )}

          {isEnded && (
            <button
              type="button"
              className="add-submit-btn"
              onClick={() => void handleStartNewContest()}
              disabled={saving}
            >
              {saving ? "Starting…" : "Start New Contest"}
            </button>
          )}
        </div>

        {(isLive || isEnded) && (
          <div className="admin-contest-results">
            <h3 className="admin-contest-results-title">
              {isLive ? "Current top 10" : "Final top 10"}
            </h3>
            {loadingEntries && <p className="admin-loading">Loading scores…</p>}
            {!loadingEntries && entries.length === 0 && (
              <p className="admin-contest-empty">No contest scores yet.</p>
            )}
            {!loadingEntries &&
              entries.map((entry, index) => (
                <div key={`${entry.walletAddress ?? entry.name}-${index}`} className="admin-contest-row">
                  <span>#{index + 1}</span>
                  <span>{entry.name}</span>
                  <span>{entry.score.toLocaleString()}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
