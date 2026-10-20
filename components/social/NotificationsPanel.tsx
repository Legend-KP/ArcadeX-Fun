"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { socialIdentity, type SocialMe } from "@/components/farcaster/social-me";
import {
  castChallengeResult,
  challengeDeadline,
  challengesForViewer,
  createChallenge,
  readChallenges,
  setChallengeStatus,
  subscribeSocialChallenges,
  viewerKeys,
  type ChallengeExpiryHours,
  type SocialChallenge,
} from "@/lib/social-challenges";
import type { Game } from "@/types";

type Props = {
  games: Game[];
  me: SocialMe | null;
  ready: boolean;
};

function formatWhen(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function Timeline({ challenge }: { challenge: SocialChallenge }) {
  const deadline = challengeDeadline(challenge);
  if (!deadline || !challenge.acceptedAt) return null;
  const now = Date.now();
  const span = deadline - challenge.acceptedAt;
  const used = Math.min(1, Math.max(0, (now - challenge.acceptedAt) / span));
  const open = now < deadline;

  return (
    <div className="soc-timeline">
      <div className="soc-timeline__meta">
        <span>Accepted {formatWhen(challenge.acceptedAt)}</span>
        <span>{open ? `Finish by ${formatWhen(deadline)}` : "Window closed"}</span>
      </div>
      <div className="soc-timeline__track" aria-hidden>
        <span style={{ width: `${Math.round(used * 100)}%` }} />
      </div>
      <p>
        {open
          ? `${challenge.expiryHours} hour window is running.`
          : `The ${challenge.expiryHours} hour window has ended.`}
      </p>
    </div>
  );
}

function ResultComposer({
  challenge,
  authorName,
}: {
  challenge: SocialChallenge;
  authorName: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(
    `finished a ${challenge.gameName} challenge`
  );

  if (challenge.resultCastId) {
    return <p className="soc-note">Result posted on Home.</p>;
  }

  if (!open) {
    return (
      <button type="button" className="soc-text-btn" onClick={() => setOpen(true)}>
        Cast result
      </button>
    );
  }

  return (
    <form
      className="soc-challenge-form"
      onSubmit={(event) => {
        event.preventDefault();
        castChallengeResult(challenge, text, authorName);
      }}
    >
      <label>
        Result post
        <input value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <button type="submit" className="connect-btn" disabled={!text.trim()}>
        Post to Home
      </button>
    </form>
  );
}

export default function NotificationsPanel({ games, me, ready }: Props) {
  const challenges = useSyncExternalStore(
    subscribeSocialChallenges,
    readChallenges,
    readChallenges
  );
  const identity = me ? socialIdentity(me) : null;
  const keys = viewerKeys([
    identity?.fid,
    identity?.username,
    identity?.displayName,
    identity?.playerId,
  ]);
  const incoming = challengesForViewer(challenges, keys).filter(
    (challenge) => challenge.status !== "declined"
  );
  const outgoing = useMemo(() => {
    const id = identity?.fid ? String(identity.fid) : identity?.username || "";
    if (!id) return [];
    return challenges.filter(
      (challenge) =>
        challenge.challengerId.toLowerCase() === id.toLowerCase() &&
        !keys.includes(challenge.targetId.trim().toLowerCase())
    );
  }, [challenges, identity?.fid, identity?.username, keys]);

  const [targetId, setTargetId] = useState("");
  const [gameId, setGameId] = useState(games[0]?.id ?? "");
  const [expiryHours, setExpiryHours] = useState<ChallengeExpiryHours>(24);

  return (
    <section className="soc-notes" aria-label="Notifications">
      <h1>Notifications</h1>
      <p className="soc-note">Challenges stay here. They are not posts on Home.</p>

      {incoming.length === 0 && (
        <p className="no-games">No incoming challenges.</p>
      )}

      <ul className="soc-challenge-list">
        {incoming.map((challenge) => (
          <li key={challenge.id} className="soc-challenge">
            <p>
              <strong>{challenge.challengerName}</strong> challenged you
            </p>
            <p>
              <Link href={`/game/${challenge.gameId}`}>{challenge.gameName}</Link>
              <span> · {challenge.expiryHours}h after accept</span>
            </p>
            {challenge.status === "pending" && (
              <div className="soc-challenge__actions">
                <button
                  type="button"
                  className="connect-btn"
                  onClick={() => setChallengeStatus(challenge.id, "accepted")}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="soc-decline"
                  onClick={() => setChallengeStatus(challenge.id, "declined")}
                >
                  Decline
                </button>
              </div>
            )}
            {challenge.status === "accepted" && (
              <>
                <Timeline challenge={challenge} />
                <ResultComposer
                  challenge={challenge}
                  authorName={identity?.displayName || "Player"}
                />
              </>
            )}
          </li>
        ))}
      </ul>

      {outgoing.length > 0 && (
        <>
          <h2>Sent</h2>
          <ul className="soc-challenge-list">
            {outgoing.map((challenge) => (
              <li key={challenge.id} className="soc-challenge">
                <p>
                  Waiting on <strong>{challenge.targetId}</strong>
                </p>
                <p>
                  {challenge.gameName} · {challenge.expiryHours}h · {challenge.status}
                </p>
                {challenge.status === "accepted" && (
                  <>
                    <Timeline challenge={challenge} />
                    <ResultComposer
                  challenge={challenge}
                  authorName={identity?.displayName || "Player"}
                />
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Challenge a player</h2>
      {!ready ? (
        <p className="soc-note">
          <Link href="/social">Sign in with Farcaster</Link> to send a challenge.
        </p>
      ) : (
        <form
          className="soc-challenge-form"
          onSubmit={(event) => {
            event.preventDefault();
            const game = games.find((item) => item.id === gameId);
            if (!game || !identity) return;
            createChallenge({
              challengerName: identity.displayName,
              challengerId: String(identity.fid ?? identity.username ?? identity.playerId),
              targetId,
              gameId: game.id,
              gameName: game.name,
              expiryHours,
            });
            setTargetId("");
          }}
        >
          <label>
            Their FID or username
            <input
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              placeholder="kushal or 1234"
            />
          </label>
          <label>
            Game
            <select value={gameId} onChange={(event) => setGameId(event.target.value)}>
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Time to finish after they accept</legend>
            <label>
              <input
                type="radio"
                name="expiry"
                checked={expiryHours === 24}
                onChange={() => setExpiryHours(24)}
              />
              24 hours
            </label>
            <label>
              <input
                type="radio"
                name="expiry"
                checked={expiryHours === 72}
                onChange={() => setExpiryHours(72)}
              />
              72 hours
            </label>
          </fieldset>
          <button type="submit" className="connect-btn" disabled={!targetId.trim() || !gameId}>
            Send challenge
          </button>
        </form>
      )}
    </section>
  );
}
