"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import CastActions from "@/components/social/CastActions";
import { loadScoreCasts, type ScoreCast } from "@/lib/score-casts";
import type { TextPost } from "@/lib/social-board";
import type { ReactionSummary } from "@/lib/social-reactions";
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
  viewerFid?: number | null;
  followingFids?: number[] | null;
};

function timeAgo(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function postedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
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

export default function HomeFeed({
  games,
  search,
  posted,
  viewerFid = null,
  followingFids = null,
}: Props) {
  const [tab, setTab] = useState<FeedTab>("all");
  const [posts, setPosts] = useState<TextPost[] | null>(null);
  const [casts, setCasts] = useState<ScoreCast[] | null>(null);
  const [postError, setPostError] = useState("");
  const [reactions, setReactions] = useState<Record<string, ReactionSummary>>({});

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
    const followed = followingFids ? new Set(followingFids) : null;
    return [...textItems, ...scoreItems]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((item) => {
        if (
          followed &&
          item.kind === "text" &&
          item.post.fid !== viewerFid &&
          !followed.has(item.post.fid)
        ) {
          return false;
        }
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
  }, [posts, casts, query, followingFids, viewerFid]);

  const reactionIds = items
    .map((item) => (item.kind === "text" ? item.post.id : item.cast.id))
    .join("\n");

  useEffect(() => {
    const ids = reactionIds.split("\n").filter(Boolean);
    if (ids.length === 0) return;
    let cancelled = false;
    fetch("/api/social/reactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ action: "list", ids }),
    })
      .then(async (res) => {
        const data = (await res.json()) as {
          reactions?: Record<string, ReactionSummary>;
        };
        if (!cancelled && res.ok && data.reactions) setReactions(data.reactions);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reactionIds]);

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
          <p className="board-hero__tag">
            People you follow on Farcaster, plus ArcadeX scores.
          </p>
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
              <article key={item.post.id} className="board-post board-cast">
                <Avatar name={item.post.authorName} src={item.post.pfpUrl} />
                <div className="board-cast__main">
                  <header>
                    <strong>{item.post.authorName}</strong>
                    {item.post.authorHandle && (
                      <span className="board-cast__handle">
                        @{item.post.authorHandle.replace(/^@/, "")}
                      </span>
                    )}
                    <time
                      dateTime={new Date(item.post.createdAt).toISOString()}
                      title={postedAt(item.post.createdAt)}
                    >
                      {timeAgo(item.post.createdAt)}
                    </time>
                  </header>
                  <p className="board-cast__body">{item.post.body}</p>
                  <CastActions
                    postId={item.post.id}
                    text={item.post.body}
                    reaction={
                      reactions[item.post.id] ?? {
                        likes: 0,
                        liked: false,
                        comments: 0,
                        shares: 0,
                        shared: false,
                      }
                    }
                    onChange={(next) =>
                      setReactions((current) => ({ ...current, [item.post.id]: next }))
                    }
                  />
                </div>
              </article>
            ) : (
              <article key={item.cast.id} className="board-post board-cast">
                <Avatar name={item.cast.playerName} />
                <div className="board-cast__main">
                  <header>
                    <strong>{item.cast.playerName}</strong>
                    {item.cast.createdAt > 0 && (
                      <time
                        dateTime={new Date(item.cast.createdAt).toISOString()}
                        title={postedAt(item.cast.createdAt)}
                      >
                        {timeAgo(item.cast.createdAt)}
                      </time>
                    )}
                  </header>
                  <p className="board-cast__body">
                    scored {item.cast.score.toLocaleString()} in {item.cast.gameName}
                  </p>
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
                  <CastActions
                    postId={item.cast.id}
                    text={`scored ${item.cast.score.toLocaleString()} in ${item.cast.gameName}`}
                    reaction={
                      reactions[item.cast.id] ?? {
                        likes: 0,
                        liked: false,
                        comments: 0,
                        shares: 0,
                        shared: false,
                      }
                    }
                    onChange={(next) =>
                      setReactions((current) => ({ ...current, [item.cast.id]: next }))
                    }
                  />
                </div>
              </article>
            )
          )}
        </div>
      )}
    </div>
  );
}
