"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildContestEditPayload,
  buildContestStartPayload,
  CONTEST_DURATION_OPTIONS,
  formatContestCountdown,
} from "@/lib/contest";
import {
  applyContestForChain,
  CONTEST_CHAIN_KEYS,
  CONTEST_CHAIN_LABELS,
  contestChainId,
  getChainContestState,
} from "@/lib/contest-chains";
import { fetchLeaderboardData } from "@/lib/leaderboard-client";
import { updateAdminGame } from "@/lib/admin-api";
import {
  ContestChainKey,
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
  const [chainKey, setChainKey] = useState<ContestChainKey>("base");
  const [durationDays, setDurationDays] = useState<ContestDurationDays>(1);
  const [task, setTask] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [countdownMs, setCountdownMs] = useState(0);

  const chainGame = useMemo(
    () => applyContestForChain(game, chainKey),
    [game, chainKey]
  );
  const contestStatus = getContestStatus(chainGame);
  const isLive = gameHasContestLive(chainGame);
  const isEnded = contestStatus === "ended";
  const isPlanning = !contestStatus;
  const chainId = contestChainId(chainKey);

  useEffect(() => {
    if (!open) return;
    const state = getChainContestState(game, chainKey);
    setDurationDays(state.contestDurationDays ?? 1);
    setTask(state.contestTask ?? "");
    setError("");
  }, [open, game, chainKey]);

  useEffect(() => {
    if (!open || !chainGame.contestStartedAt) {
      setEntries([]);
      return;
    }

    setLoadingEntries(true);
    fetchLeaderboardData(game.id, { chainId })
      .then((data) => setEntries(data.contest?.entries ?? []))
      .catch(() => setEntries([]))
      .finally(() => setLoadingEntries(false));
  }, [
    open,
    game.id,
    chainId,
    chainGame.contestStartedAt,
    chainGame.contestEndsAt,
  ]);

  useEffect(() => {
    if (!open || !isLive || !chainGame.contestEndsAt) return;

    const tick = () =>
      setCountdownMs(Math.max(0, chainGame.contestEndsAt! - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [open, isLive, chainGame.contestEndsAt]);

  if (!open) return null;

  async function handleStartContest() {
    if (!task.trim()) {
      setError("Contest task description is required.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await updateAdminGame(game.id, {
        contestChainKey: chainKey,
        ...buildContestStartPayload({ task, durationDays }),
      });
      onUpdated();
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
    if (typeof chainGame.contestStartedAt !== "number") return;

    setSaving(true);
    setError("");
    try {
      await updateAdminGame(game.id, {
        contestChainKey: chainKey,
        ...buildContestEditPayload({
          task,
          durationDays,
          startedAt: chainGame.contestStartedAt,
        }),
      });
      onUpdated();
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
      await updateAdminGame(game.id, {
        contestChainKey: chainKey,
        ...buildContestStartPayload({ task, durationDays }),
      });
      onUpdated();
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

        <div className="admin-contest-form">
          <label className="form-label">Chain</label>
          <div className="admin-contest-chains" role="tablist" aria-label="Contest chain">
            {CONTEST_CHAIN_KEYS.map((key) => {
              const status = getContestStatus(getChainContestState(game, key));
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={chainKey === key}
                  className={`admin-contest-chain${
                    chainKey === key ? " is-selected" : ""
                  }`}
                  onClick={() => setChainKey(key)}
                  disabled={saving}
                >
                  <span>{CONTEST_CHAIN_LABELS[key]}</span>
                  {status === "live" && (
                    <span className="admin-contest-chain-badge">Live</span>
                  )}
                  {status === "ended" && (
                    <span className="admin-contest-chain-badge is-ended">
                      Ended
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {isLive && (
            <div className="admin-contest-banner admin-contest-banner--live">
              {CONTEST_CHAIN_LABELS[chainKey]} contest live ·{" "}
              {formatContestCountdown(countdownMs)} remaining
            </div>
          )}

          {isEnded && (
            <div className="admin-contest-banner admin-contest-banner--ended">
              {CONTEST_CHAIN_LABELS[chainKey]} contest ended
            </div>
          )}

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
            placeholder={`Describe how players compete on ${CONTEST_CHAIN_LABELS[chainKey]}…`}
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
              {saving
                ? "Starting…"
                : `Start Contest on ${CONTEST_CHAIN_LABELS[chainKey]}`}
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
              {saving
                ? "Starting…"
                : `Start New Contest on ${CONTEST_CHAIN_LABELS[chainKey]}`}
            </button>
          )}
        </div>

        {(isLive || isEnded) && (
          <div className="admin-contest-results">
            <h3 className="admin-contest-results-title">
              {isLive
                ? `${CONTEST_CHAIN_LABELS[chainKey]} · Current top 10`
                : `${CONTEST_CHAIN_LABELS[chainKey]} · Final top 10`}
            </h3>
            {loadingEntries && <p className="admin-loading">Loading scores…</p>}
            {!loadingEntries && entries.length === 0 && (
              <p className="admin-contest-empty">No contest scores yet.</p>
            )}
            {!loadingEntries &&
              entries.map((entry, index) => (
                <div
                  key={`${entry.walletAddress ?? entry.name}-${index}`}
                  className="admin-contest-row"
                >
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
