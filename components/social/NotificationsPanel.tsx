"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { socialIdentity, type SocialMe } from "@/components/farcaster/social-me";
import {
  challengeDeadline,
  loadChallenges,
  readChallengeList,
  readChallengeSnapshot,
  respondToChallenge,
  sendChallenge,
  subscribeChallenges,
  type SocialChallenge,
} from "@/lib/social-challenges-client";
import type { Game } from "@/types";

type Props = {
  games: Game[];
  me: SocialMe | null;
  ready: boolean;
  title?: string;
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
  onPosted,
}: {
  challenge: SocialChallenge;
  onPosted: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(`finished a ${challenge.gameName} challenge`);
  const [busy, setBusy] = useState(false);

  if (challenge.resultPostId) {
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
        setBusy(true);
        void respondToChallenge(challenge.id, "result", text).then((message) => {
          setBusy(false);
          onPosted(message);
          if (!message) setOpen(false);
        });
      }}
    >
      <label>
        Result post
        <input value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <button type="submit" className="connect-btn" disabled={busy || !text.trim()}>
        Post to Home
      </button>
    </form>
  );
}

export default function NotificationsPanel({
  games,
  me,
  ready,
  title = "Notifications",
}: Props) {
  const challenges = useSyncExternalStore(
    subscribeChallenges,
    readChallengeList,
    readChallengeSnapshot
  );
  const identity = me ? socialIdentity(me) : null;
  const fid = identity?.fid ?? null;
  const incoming = challenges.filter(
    (challenge) => challenge.targetFid === fid && challenge.status !== "declined"
  );
  const outgoing = useMemo(
    () =>
      challenges.filter(
        (challenge) =>
          fid != null &&
          challenge.challengerFid === fid &&
          challenge.targetFid !== fid
      ),
    [challenges, fid]
  );

  const [targetId, setTargetId] = useState("");
  const [gameId, setGameId] = useState("");
  const [expiryHours, setExpiryHours] = useState<24 | 72>(24);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!gameId && games[0]?.id) setGameId(games[0].id);
  }, [gameId, games]);

  useEffect(() => {
    if (!ready) return;
    void loadChallenges().then((message) => {
      if (message) setError(message);
    });
  }, [ready]);

  return (
    <section className="soc-notes" aria-label="Notifications">
      <h1>{title}</h1>
      <p className="soc-note">
        Send a challenge with the other player&apos;s username or FID. They see it here
        when they sign in.
      </p>
      {error && <p className="board-error">{error}</p>}

      {incoming.length === 0 && <p className="no-games">No incoming challenges.</p>}

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
                  onClick={() => {
                    void respondToChallenge(challenge.id, "accept").then((message) => {
                      if (message) setError(message);
                    });
                  }}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="soc-decline"
                  onClick={() => {
                    void respondToChallenge(challenge.id, "decline").then((message) => {
                      if (message) setError(message);
                    });
                  }}
                >
                  Decline
                </button>
              </div>
            )}
            {challenge.status === "accepted" && (
              <>
                <Timeline challenge={challenge} />
                <ResultComposer challenge={challenge} onPosted={(message) => setError(message ?? "")} />
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
                  Waiting on <strong>{challenge.targetLabel}</strong>
                </p>
                <p>
                  {challenge.gameName} · {challenge.expiryHours}h · {challenge.status}
                </p>
                {challenge.status === "accepted" && (
                  <>
                    <Timeline challenge={challenge} />
                    <ResultComposer
                      challenge={challenge}
                      onPosted={(message) => setError(message ?? "")}
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
            if (!game) return;
            setBusy(true);
            setError("");
            void sendChallenge({
              target: targetId,
              gameId: game.id,
              gameName: game.name,
              expiryHours,
            }).then((message) => {
              setBusy(false);
              if (message) {
                setError(message);
                return;
              }
              setTargetId("");
            });
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
          <button
            type="submit"
            className="connect-btn"
            disabled={busy || !targetId.trim() || !gameId}
          >
            Send challenge
          </button>
        </form>
      )}
    </section>
  );
}
