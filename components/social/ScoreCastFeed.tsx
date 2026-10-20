"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadScoreCasts, type ScoreCast } from "@/lib/score-casts";
import {
  readResultCasts,
  subscribeSocialChallenges,
} from "@/lib/social-challenges";
import type { Game } from "@/types";

type Props = {
  games: Game[];
  mine?: { names: string[]; wallet?: string | null };
};

export default function ScoreCastFeed({ games, mine }: Props) {
  const [casts, setCasts] = useState<ScoreCast[] | null>(null);
  const [results, setResults] = useState(readResultCasts);

  useEffect(() => subscribeSocialChallenges(() => setResults(readResultCasts())), []);

  useEffect(() => {
    let cancelled = false;
    setCasts(null);
    loadScoreCasts(games).then((next) => {
      if (!cancelled) setCasts(next);
    });
    return () => {
      cancelled = true;
    };
  }, [games]);

  const names = new Set((mine?.names ?? []).map((name) => name.toLowerCase()));
  const wallet = mine?.wallet?.toLowerCase() ?? "";

  const scoreItems = (casts ?? []).filter((cast) => {
    if (!mine) return true;
    if (wallet && cast.walletAddress?.toLowerCase() === wallet) return true;
    return names.has(cast.playerName.toLowerCase());
  });

  const resultItems = results.filter((cast) => {
    if (!mine) return true;
    return names.has(cast.playerName.toLowerCase());
  });

  const empty = casts !== null && scoreItems.length === 0 && resultItems.length === 0;

  return (
    <section className="soc-feed" aria-label={mine ? "Your casts" : "Home"}>
      {casts === null && <p className="no-games">Loading casts…</p>}
      {empty && (
        <p className="no-games">
          No casts yet. Submit a score from a game menu and it will show up here.
        </p>
      )}
      {resultItems.map((cast) => {
        const game = games.find((item) => item.id === cast.gameId);
        const thumb = scoreItems.find((item) => item.gameId === cast.gameId)?.thumbnail
          || game?.thumbnail
          || "";
        return (
          <article key={cast.id} className="cast-card">
            <p className="cast-card__text">
              <strong>{cast.playerName}</strong> {cast.text}
            </p>
            {thumb ? (
              <Link href={`/game/${cast.gameId}`} className="cast-card__frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb} alt={cast.gameName} />
              </Link>
            ) : (
              <Link href={`/game/${cast.gameId}`} className="cast-card__game">
                {cast.gameName}
              </Link>
            )}
          </article>
        );
      })}
      {scoreItems.map((cast) => (
        <article key={cast.id} className="cast-card">
          <p className="cast-card__text">
            <strong>{cast.playerName}</strong> scored {cast.score.toLocaleString()} in{" "}
            {cast.gameName}
          </p>
          <Link href={`/game/${cast.gameId}`} className="cast-card__frame">
            {cast.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cast.thumbnail} alt={cast.gameName} />
            ) : (
              <span className="cast-card__fallback">{cast.gameName}</span>
            )}
          </Link>
        </article>
      ))}
    </section>
  );
}
