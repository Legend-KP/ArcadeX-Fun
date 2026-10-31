"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadScoreCasts, type ScoreCast } from "@/lib/score-casts";
import type { TextPost } from "@/lib/social-board";
import type { Game } from "@/types";

type Props = {
  games: Game[];
  fid?: number | null;
  mine?: { names: string[]; wallet?: string | null };
};

export default function ScoreCastFeed({ games, fid, mine }: Props) {
  const [casts, setCasts] = useState<ScoreCast[] | null>(null);
  const [posts, setPosts] = useState<TextPost[]>([]);

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

  useEffect(() => {
    if (!fid) {
      setPosts([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/social/posts?fid=${fid}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        const data = (await res.json()) as { posts?: TextPost[] };
        if (!cancelled && res.ok) setPosts(data.posts ?? []);
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fid]);

  const names = new Set((mine?.names ?? []).map((name) => name.toLowerCase()));
  const wallet = mine?.wallet?.toLowerCase() ?? "";

  const scoreItems = (casts ?? []).filter((cast) => {
    if (!mine) return true;
    if (wallet && cast.walletAddress?.toLowerCase() === wallet) return true;
    return names.has(cast.playerName.toLowerCase());
  });

  const empty = casts !== null && scoreItems.length === 0 && posts.length === 0;

  return (
    <section className="soc-feed" aria-label={mine ? "Your casts" : "Home"}>
      {casts === null && <p className="no-games">Loading casts…</p>}
      {empty && (
        <p className="no-games">
          No casts yet. Submit a score from a game menu and it will show up here.
        </p>
      )}
      {posts.map((post) => (
        <article key={post.id} className="cast-card">
          <p className="cast-card__text">
            <strong>{post.authorName}</strong> {post.body}
          </p>
        </article>
      ))}
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
