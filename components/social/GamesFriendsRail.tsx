"use client";

import { useEffect, useMemo, useState } from "react";
import { sendChallenge } from "@/lib/social-challenges-client";
import type { RailActivity, RailFriend } from "@/lib/friends-rail";
import type { Game } from "@/types";

type Props = {
  games: Game[];
};

type Rail = {
  online: RailFriend[];
  activity: RailActivity[];
  suggestions: RailFriend[];
};

const EMPTY: Rail = { online: [], activity: [], suggestions: [] };

function Avatar({ name, src }: { name: string; src?: string | null }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" />
    );
  }
  return <span>{name.charAt(0).toUpperCase()}</span>;
}

export default function GamesFriendsRail({ games }: Props) {
  const [rail, setRail] = useState<Rail>(EMPTY);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [note, setNote] = useState("");
  const [promptIndex, setPromptIndex] = useState(0);

  const fallbackGame = useMemo(
    () => games.find((game) => game.live !== false) ?? games[0] ?? null,
    [games]
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/social/friends-rail", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        const data = (await res.json()) as Rail & { error?: string };
        if (!res.ok) throw new Error(data.error || "Could not load friends.");
        if (!cancelled) setRail(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load friends.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const quiet = rail.online.length === 0;
  const suggestions = rail.suggestions;

  useEffect(() => {
    if (!quiet || suggestions.length < 2) return;
    const timer = window.setInterval(() => {
      setPromptIndex((index) => (index + 1) % suggestions.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [quiet, suggestions.length]);

  const prompt = suggestions[promptIndex % Math.max(suggestions.length, 1)] ?? null;

  async function challenge(friend: RailFriend, game: { id: string; name: string } | null) {
    if (!game) return;
    const key = `${friend.fid}:${game.id}`;
    setBusyKey(key);
    setNote("");
    const message = await sendChallenge({
      target: friend.handle || String(friend.fid),
      gameId: game.id,
      gameName: game.name,
      expiryHours: 24,
    });
    setBusyKey("");
    setNote(message || `Challenge sent to ${friend.name}.`);
  }

  return (
    <aside className="board-aside games-rail" aria-label="Friends">
      <section className="board-card">
        <header>
          <h2>Friends online</h2>
        </header>
        {rail.online.length === 0 ? (
          <p className="board-empty">No friends online right now.</p>
        ) : (
          <ul className="games-rail__online">
            {rail.online.map((friend) => (
              <li key={friend.fid}>
                <span className="games-rail__avatar">
                  <Avatar name={friend.name} src={friend.pfpUrl} />
                </span>
                <strong>{friend.name}</strong>
                <button
                  type="button"
                  disabled={!fallbackGame || busyKey === `${friend.fid}:${fallbackGame?.id}`}
                  onClick={() => void challenge(friend, fallbackGame)}
                >
                  Challenge
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="board-card">
        <header>
          <h2>Recent games</h2>
        </header>
        {rail.activity.length === 0 ? (
          <p className="board-empty">No recent friend games yet.</p>
        ) : (
          <ul className="games-rail__activity">
            {rail.activity.map((item) => {
              const friend: RailFriend = {
                fid: item.fid,
                name: item.name,
                handle: item.handle,
                pfpUrl: item.pfpUrl,
              };
              return (
                <li key={item.id}>
                  <span className="games-rail__avatar">
                    <Avatar name={item.name} src={item.pfpUrl} />
                  </span>
                  <p>
                    <strong>{item.name}</strong>
                    <small>{item.gameName}</small>
                  </p>
                  <button
                    type="button"
                    disabled={busyKey === `${item.fid}:${item.gameId}`}
                    onClick={() =>
                      void challenge(friend, { id: item.gameId, name: item.gameName })
                    }
                  >
                    Rematch
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {quiet && (
        <section className="board-card games-rail__prompt" aria-live="polite">
          <header>
            <h2>Play with someone</h2>
          </header>
          {prompt ? (
            <>
              <div className="games-rail__prompt-person">
                <span className="games-rail__avatar">
                  <Avatar name={prompt.name} src={prompt.pfpUrl} />
                </span>
                <p>
                  Challenge <strong>{prompt.name}</strong>
                  {fallbackGame ? ` to ${fallbackGame.name}` : ""}.
                </p>
              </div>
              <button
                type="button"
                disabled={!fallbackGame || busyKey === `${prompt.fid}:${fallbackGame?.id}`}
                onClick={() => void challenge(prompt, fallbackGame)}
              >
                Challenge
              </button>
            </>
          ) : (
            <p className="board-empty">
              When friends are quiet, suggestions to play will show up here.
            </p>
          )}
        </section>
      )}

      {error && <p className="board-error">{error}</p>}
      {note && <p className="board-note">{note}</p>}
    </aside>
  );
}
