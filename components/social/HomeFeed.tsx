"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadScoreCasts, type ScoreCast } from "@/lib/score-casts";
import type { TextPost } from "@/lib/social-board";
import type { Game } from "@/types";

type FeedTab =
  | "all"
  | "friends"
  | "players"
  | "highlights"
  | "announcements";

const TABS: { id: FeedTab; label: string }[] = [
  { id: "all", label: "All Posts" },
  { id: "friends", label: "My Friends" },
  { id: "players", label: "Top Players" },
  { id: "highlights", label: "Game Highlights" },
  { id: "announcements", label: "Announcements" },
];

type FeedItem =
  | { kind: "text"; createdAt: number; post: TextPost }
  | { kind: "score"; createdAt: number; cast: ScoreCast };

type Props = {
  games: Game[];
  search: string;
  posted: TextPost | null;
};

function timeAgo(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function Avatar({ name, src }: { name: string; src?: string | null }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="board-avatar" src={src} alt="" />
    );
  }
  return <span className="board-avatar">{name.charAt(0).toUpperCase()}</span>;
}

export default function HomeFeed({ games, search, posted }: Props) {
  const [tab, setTab] = useState<FeedTab>("all");
  const [posts, setPosts] = useState<TextPost[] | null>(null);
  const [casts, setCasts] = useState<ScoreCast[] | null>(null);
  const [postError, setPostError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/social/posts", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json()) as { posts?: TextPost[]; error?: string };
        if (!res.ok) throw new Error(data.error || "Could not load posts.");
        if (!cancelled) setPosts(data.posts ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPosts([]);
        setPostError(err instanceof Error ? err.message : "Could not load posts.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadScoreCasts(games).then((next) => {
      if (!cancelled) setCasts(next);
    });
    return () => {
      cancelled = true;
    };
  }, [games]);

  useEffect(() => {
    if (!posted) return;
    setPosts((current) => {
      if (current?.some((item) => item.id === posted.id)) return current;
      return [posted, ...(current ?? [])];
    });
    setTab("all");
  }, [posted]);

  const query = search.trim().toLowerCase();

  const items = useMemo(() => {
    const textItems: FeedItem[] = (posts ?? []).map((post) => ({
      kind: "text",
      createdAt: post.createdAt,
      post,
    }));
    const scoreItems: FeedItem[] = (casts ?? []).map((cast) => ({
      kind: "score",
      createdAt: cast.createdAt,
      cast,
    }));
    return [...textItems, ...scoreItems]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((item) => {
        if (!query) return true;
        if (item.kind === "text") {
          return (
            item.post.body.toLowerCase().includes(query) ||
            item.post.authorName.toLowerCase().includes(query)
          );
        }
        return (
          item.cast.playerName.toLowerCase().includes(query) ||
          item.cast.gameName.toLowerCase().includes(query)
        );
      });
  }, [posts, casts, query]);

  const matchedGames = useMemo(() => {
    if (!query) return [];
    return games
      .filter((game) => game.name.toLowerCase().includes(query))
      .slice(0, 4);
  }, [games, query]);

  return (
    <div className="board-feed">
      <section className="board-hero" aria-label="The Social Arcade">
        <div className="board-hero__copy">
          <h1>
            THE SOCIAL
            <br />
            ARCADE
          </h1>
          <p>Play · Share · Compete · Earn</p>
          <p className="board-hero__tag">Good games, better friends.</p>
        </div>
      </section>

      {postError && <p className="board-error">{postError}</p>}

      <div className="board-tabs" role="tablist" aria-label="Feed">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "is-on" : undefined}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
        <span className="board-tabs__sort">Latest</span>
      </div>

      {query && matchedGames.length > 0 && (
        <ul className="board-search-games">
          {matchedGames.map((game) => (
            <li key={game.id}>
              <Link href={`/game/${game.id}`}>{game.name}</Link>
            </li>
          ))}
        </ul>
      )}

      {tab !== "all" ? (
        <p className="board-empty">Nothing here yet.</p>
      ) : posts === null || casts === null ? (
        <p className="board-empty">Loading posts…</p>
      ) : items.length === 0 ? (
        <p className="board-empty">
          {query
            ? "No posts match your search."
            : "No posts yet. Share a text post to get the feed started."}
        </p>
      ) : (
        <div className="board-posts">
          {items.map((item) =>
            item.kind === "text" ? (
              <article key={item.post.id} className="board-post">
                <header>
                  <Avatar name={item.post.authorName} src={item.post.pfpUrl} />
                  <div>
                    <strong>{item.post.authorName}</strong>
                    <span>{timeAgo(item.post.createdAt)}</span>
                  </div>
                </header>
                <p>{item.post.body}</p>
              </article>
            ) : (
              <article key={item.cast.id} className="board-post">
                <header>
                  <Avatar name={item.cast.playerName} />
                  <div>
                    <strong>
                      {item.cast.playerName}{" "}
                      <span className="board-post__score">
                        scored {item.cast.score.toLocaleString()} in {item.cast.gameName}
                      </span>
                    </strong>
                    {item.cast.createdAt > 0 && <span>{timeAgo(item.cast.createdAt)}</span>}
                  </div>
                </header>
                {item.cast.thumbnail ? (
                  <Link href={`/game/${item.cast.gameId}`} className="board-post__media">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.cast.thumbnail} alt={item.cast.gameName} />
                  </Link>
                ) : (
                  <Link href={`/game/${item.cast.gameId}`} className="board-post__game">
                    {item.cast.gameName}
                  </Link>
                )}
              </article>
            )
          )}
        </div>
      )}
    </div>
  );
}
