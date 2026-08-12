/** Play-session binding for progress + paid score submit. */

export const PLAY_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
export const PLAY_SESSION_ID_RE = /^[a-f0-9]{32}$/;

export type PlaySessionStatus = "active" | "consumed";

export type PlaySessionRecord = {
  playerId: string;
  gameId: string;
  walletAddress: string;
  startedAt: number;
  expiresAt: number;
  status: PlaySessionStatus;
  /** Set when public leaderboard submit consumes the session. */
  consumedAt?: number;
};

export type ScoreBounds = {
  /** Absolute ceiling — scores above this are anomalous. */
  maxPossibleScore?: number;
  /** Minimum wall-clock ms to reach a near-max score. */
  minTimeToMaxMs?: number;
};

export type ScoreAnomalyResult = {
  flagged: boolean;
  reasons: string[];
};

/** Soft-launch anomaly checks (log by default; hard-reject when SCORE_BOUNDS_ENFORCE=true). */
export function evaluateScoreAnomaly(params: {
  score: number;
  scoreBounds?: ScoreBounds | null;
  sessionStartedAt: number;
  now?: number;
}): ScoreAnomalyResult {
  const reasons: string[] = [];
  const now = params.now ?? Date.now();
  const elapsed = Math.max(0, now - params.sessionStartedAt);
  const bounds = params.scoreBounds;

  if (params.score > 0 && elapsed < 2_000) {
    reasons.push("too_fast");
  }

  if (bounds?.maxPossibleScore != null && Number.isFinite(bounds.maxPossibleScore)) {
    if (params.score > bounds.maxPossibleScore) {
      reasons.push("score_above_max");
    }

    if (
      bounds.minTimeToMaxMs != null &&
      Number.isFinite(bounds.minTimeToMaxMs) &&
      bounds.maxPossibleScore > 0 &&
      params.score >= bounds.maxPossibleScore * 0.8 &&
      elapsed < bounds.minTimeToMaxMs
    ) {
      reasons.push("implausible_time_to_score");
    }
  }

  return { flagged: reasons.length > 0, reasons };
}

export function shouldEnforceScoreBounds(): boolean {
  const raw = process.env.SCORE_BOUNDS_ENFORCE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isValidPlaySessionId(value: string | null | undefined): boolean {
  return Boolean(value && PLAY_SESSION_ID_RE.test(value.trim()));
}

export function generatePlaySessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
