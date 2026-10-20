export type ChallengeExpiryHours = 24 | 72;

export type ChallengeStatus = "pending" | "accepted" | "declined";

export type SocialChallenge = {
  id: string;
  challengerName: string;
  challengerId: string;
  targetId: string;
  gameId: string;
  gameName: string;
  expiryHours: ChallengeExpiryHours;
  createdAt: number;
  status: ChallengeStatus;
  acceptedAt?: number;
  resultCastId?: string;
};

export type ResultCast = {
  id: string;
  challengeId: string;
  playerName: string;
  gameId: string;
  gameName: string;
  text: string;
  createdAt: number;
};

const CHALLENGE_KEY = "arcadex_social_challenges_v1";
const CAST_KEY = "arcadex_social_result_casts_v1";

const listeners = new Set<() => void>();

let challengeCache: SocialChallenge[] = [];
let challengeRaw: string | null = null;
let castCache: ResultCast[] = [];
let castRaw: string | null = null;

function emit() {
  listeners.forEach((listener) => listener());
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  window.localStorage.setItem(key, value);
  emit();
}

export function subscribeSocialChallenges(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readChallenges(): SocialChallenge[] {
  const raw = readStorage(CHALLENGE_KEY);
  if (raw === challengeRaw) return challengeCache;
  challengeRaw = raw;
  if (!raw) {
    challengeCache = [];
    return challengeCache;
  }
  try {
    const parsed = JSON.parse(raw) as SocialChallenge[];
    challengeCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    challengeCache = [];
  }
  return challengeCache;
}

export function readResultCasts(): ResultCast[] {
  const raw = readStorage(CAST_KEY);
  if (raw === castRaw) return castCache;
  castRaw = raw;
  if (!raw) {
    castCache = [];
    return castCache;
  }
  try {
    const parsed = JSON.parse(raw) as ResultCast[];
    castCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    castCache = [];
  }
  return castCache;
}

export function viewerKeys(ids: Array<string | number | null | undefined>): string[] {
  return ids
    .map((value) => (value == null ? "" : String(value).trim().toLowerCase()))
    .filter(Boolean);
}

export function challengesForViewer(
  challenges: SocialChallenge[],
  keys: string[]
): SocialChallenge[] {
  if (keys.length === 0) return [];
  return challenges.filter((challenge) =>
    keys.includes(challenge.targetId.trim().toLowerCase())
  );
}

export function pendingChallengeCount(
  challenges: SocialChallenge[],
  keys: string[]
): number {
  return challengesForViewer(challenges, keys).filter(
    (challenge) => challenge.status === "pending"
  ).length;
}

function saveChallenges(next: SocialChallenge[]) {
  challengeCache = next;
  challengeRaw = JSON.stringify(next);
  writeStorage(CHALLENGE_KEY, challengeRaw);
}

export function createChallenge(input: {
  challengerName: string;
  challengerId: string;
  targetId: string;
  gameId: string;
  gameName: string;
  expiryHours: ChallengeExpiryHours;
}) {
  const targetId = input.targetId.trim().replace(/^@/, "");
  if (!targetId || !input.gameId) return;
  const next: SocialChallenge = {
    id: `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    challengerName: input.challengerName.trim() || "Player",
    challengerId: input.challengerId,
    targetId,
    gameId: input.gameId,
    gameName: input.gameName,
    expiryHours: input.expiryHours,
    createdAt: Date.now(),
    status: "pending",
  };
  saveChallenges([next, ...readChallenges()]);
}

export function setChallengeStatus(
  id: string,
  status: "accepted" | "declined"
) {
  saveChallenges(
    readChallenges().map((challenge) => {
      if (challenge.id !== id || challenge.status !== "pending") return challenge;
      if (status === "accepted") {
        return { ...challenge, status, acceptedAt: Date.now() };
      }
      return { ...challenge, status };
    })
  );
}

export function castChallengeResult(
  challenge: SocialChallenge,
  text: string,
  authorName: string
) {
  const body = text.trim();
  if (!body || challenge.resultCastId) return;
  const cast: ResultCast = {
    id: `rc_${Date.now().toString(36)}`,
    challengeId: challenge.id,
    playerName: authorName.trim() || challenge.challengerName,
    gameId: challenge.gameId,
    gameName: challenge.gameName,
    text: body,
    createdAt: Date.now(),
  };
  castCache = [cast, ...readResultCasts()];
  castRaw = JSON.stringify(castCache);
  writeStorage(CAST_KEY, castRaw);
  saveChallenges(
    readChallenges().map((item) =>
      item.id === challenge.id ? { ...item, resultCastId: cast.id } : item
    )
  );
}

export function challengeDeadline(challenge: SocialChallenge): number | null {
  if (challenge.status !== "accepted" || !challenge.acceptedAt) return null;
  return challenge.acceptedAt + challenge.expiryHours * 60 * 60 * 1000;
}
