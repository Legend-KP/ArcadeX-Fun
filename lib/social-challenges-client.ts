import type { SocialChallenge } from "@/lib/social-challenges-server";

export type { SocialChallenge };

const EMPTY: SocialChallenge[] = [];
const listeners = new Set<() => void>();

let challenges: SocialChallenge[] = EMPTY;

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeChallenges(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readChallengeList(): SocialChallenge[] {
  return challenges;
}

export function readChallengeSnapshot(): SocialChallenge[] {
  return EMPTY;
}

export async function loadChallenges(): Promise<string | null> {
  const res = await fetch("/api/social/challenges", {
    cache: "no-store",
    credentials: "same-origin",
  });
  const data = (await res.json()) as {
    challenges?: SocialChallenge[];
    error?: string;
  };
  if (!res.ok) {
    return data.error || "Could not load challenges.";
  }
  challenges = data.challenges ?? EMPTY;
  emit();
  return null;
}

export async function sendChallenge(input: {
  target: string;
  gameId: string;
  gameName: string;
  expiryHours: 24 | 72;
}): Promise<string | null> {
  const res = await fetch("/api/social/challenges", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) return data.error || "Could not send the challenge.";
  await loadChallenges();
  return null;
}

export async function respondToChallenge(
  id: string,
  action: "accept" | "decline" | "result",
  text?: string
): Promise<string | null> {
  const res = await fetch(`/api/social/challenges/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action, text }),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) return data.error || "Could not update the challenge.";
  await loadChallenges();
  return null;
}

export function pendingChallengeCount(
  list: SocialChallenge[],
  fid: number | null | undefined
): number {
  if (!fid) return 0;
  return list.filter(
    (challenge) => challenge.targetFid === fid && challenge.status === "pending"
  ).length;
}

export function challengeDeadline(challenge: SocialChallenge): number | null {
  if (challenge.status !== "accepted" || !challenge.acceptedAt) return null;
  return challenge.acceptedAt + challenge.expiryHours * 60 * 60 * 1000;
}
