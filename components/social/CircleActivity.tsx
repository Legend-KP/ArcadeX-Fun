"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import CastActions from "@/components/social/CastActions";
import { socialIdentity, type SocialMe } from "@/components/farcaster/social-me";
import { profileHref } from "@/lib/farcaster/public-profile";
import type { TextPost } from "@/lib/social-board";
import type { ReactionSummary } from "@/lib/social-reactions";

type FeedFilter = "all" | "circles" | "general";

type Circle = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  memberCount: number;
};

type CirclePost = {
  id: string;
  circleId: string;
  circleName?: string;
  fid: number;
  authorName: string;
  authorHandle: string | null;
  pfpUrl: string | null;
  body: string;
  createdAt: number;
};

type FeedItem =
  | { kind: "general"; createdAt: number; post: TextPost }
  | { kind: "circle"; createdAt: number; post: CirclePost };

const EMPTY_REACTION: ReactionSummary = {
  likes: 0,
  liked: false,
  comments: 0,
  shares: 0,
  shared: false,
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

function Avatar({ name, src }: { name: string; src?: string | null }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="board-avatar" src={src} alt="" />
    );
  }
  return <span className="board-avatar">{name.charAt(0).toUpperCase()}</span>;
}

export default function CircleActivity({
  me,
  search,
}: {
  me: SocialMe;
  search: string;
}) {
  const identity = socialIdentity(me);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [circlePosts, setCirclePosts] = useState<CirclePost[]>([]);
  const [general, setGeneral] = useState<TextPost[] | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [reactions, setReactions] = useState<Record<string, ReactionSummary>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/social/circles/activity", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        const data = (await res.json()) as {
          circles?: Circle[];
          posts?: CirclePost[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Could not load circle activity.");
        if (cancelled) return;
        setCircles(data.circles ?? []);
        setCirclePosts(data.posts ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCircles([]);
        setError(err instanceof Error ? err.message : "Could not load circle activity.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/social/posts", { cache: "no-store", credentials: "same-origin" })
      .then(async (res) => {
        const data = (await res.json()) as { posts?: TextPost[]; error?: string };
        if (!res.ok) throw new Error(data.error || "Could not load general posts.");
        if (!cancelled) setGeneral(data.posts ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setGeneral([]);
        setError(err instanceof Error ? err.message : "Could not load general posts.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const query = search.trim().toLowerCase();

  const items = useMemo(() => {
    const circleItems: FeedItem[] = circlePosts.map((post) => ({
      kind: "circle",
      createdAt: post.createdAt,
      post,
    }));
    const generalItems: FeedItem[] = (general ?? []).map((post) => ({
      kind: "general",
      createdAt: post.createdAt,
      post,
    }));
    const source =
      filter === "circles" ? circleItems : filter === "general" ? generalItems : [...circleItems, ...generalItems];
    return source
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((item) => {
        if (!query) return true;
        const body = item.post.body.toLowerCase();
        const name = item.post.authorName.toLowerCase();
        const circle = item.kind === "circle" ? (item.post.circleName ?? "").toLowerCase() : "general";
        return body.includes(query) || name.includes(query) || circle.includes(query);
      });
  }, [circlePosts, general, filter, query]);

  const reactionKey = items
    .filter((item) => item.kind === "general")
    .map((item) => item.post.id)
    .join("\n");

  useEffect(() => {
    const ids = reactionKey.split("\n").filter(Boolean);
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
        const data = (await res.json()) as { reactions?: Record<string, ReactionSummary> };
        if (!cancelled && res.ok && data.reactions) setReactions(data.reactions);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reactionKey]);

  async function publishGeneral(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError("");
    try {
      const res = await fetch("/api/social/posts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await res.json()) as { post?: TextPost; error?: string };
      if (!res.ok || !data.post) throw new Error(data.error || "Could not publish.");
      setGeneral((current) => [data.post as TextPost, ...(current ?? [])]);
      setDraft("");
      setFilter("general");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish.");
    } finally {
      setPosting(false);
    }
  }

  const loading = circles === null || general === null;

  return (
    <div className="board-feed activity-feed">
      <header className="activity-head">
        <h1>Activity</h1>
        <p>Circle posts stay with your circles. General posts are for everyone.</p>
      </header>

      {error && <p className="board-error">{error}</p>}

      <div className="board-tabs" role="tablist" aria-label="Activity">
        {(
          [
            ["all", "All"],
            ["circles", "Circles"],
            ["general", "General"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={filter === id ? "is-on" : undefined}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {filter !== "general" && (
        <section className="activity-circles" aria-label="Your circles">
          {circles === null && <p className="soc-note">Loading circles…</p>}
          {circles && circles.length === 0 && (
            <p className="soc-note">
              You have not joined a circle yet. <Link href="/circles">Open circles</Link>
            </p>
          )}
          {circles && circles.length > 0 && (
            <ul>
              {circles.map((circle) => (
                <li key={circle.id}>
                  <Link href={`/circle/${circle.id}`}>
                    <strong>{circle.name}</strong>
                    <small>
                      {circle.memberCount} · {circle.visibility === "private" ? "Private" : "Public"}
                    </small>
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/circles" className="activity-circles__more">
                  All circles
                </Link>
              </li>
            </ul>
          )}
        </section>
      )}

      {filter !== "circles" && (
        <form className="activity-composer" onSubmit={(event) => void publishGeneral(event)}>
          <Avatar name={identity.displayName} src={identity.pfpUrl} />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={280}
            placeholder="Post to everyone, outside your circles"
            aria-label="Write a general post"
          />
          <button type="submit" className="connect-btn" disabled={posting || !draft.trim()}>
            {posting ? "Posting…" : "Post"}
          </button>
        </form>
      )}

      {loading ? (
        <p className="board-empty">Loading posts…</p>
      ) : items.length === 0 ? (
        <p className="board-empty">
          {query
            ? "No posts match your search."
            : filter === "circles"
              ? "No posts in your circles yet."
              : filter === "general"
                ? "No general posts yet. Write the first one."
                : "No posts yet. Write a general post, or post inside a circle."}
        </p>
      ) : (
        <div className="board-posts">
          {items.map((item) => {
            const href = profileHref({
              username: item.post.authorHandle,
              fid: item.post.fid,
            });
            return (
              <article key={`${item.kind}:${item.post.id}`} className="board-post board-cast">
                {href ? (
                  <Link href={href} className="board-cast__profile">
                    <Avatar name={item.post.authorName} src={item.post.pfpUrl} />
                  </Link>
                ) : (
                  <Avatar name={item.post.authorName} src={item.post.pfpUrl} />
                )}
                <div className="board-cast__main">
                  <header>
                    {href ? (
                      <Link href={href}>
                        <strong>{item.post.authorName}</strong>
                      </Link>
                    ) : (
                      <strong>{item.post.authorName}</strong>
                    )}
                    {item.post.authorHandle && (
                      <span className="board-cast__handle">
                        @{item.post.authorHandle.replace(/^@/, "")}
                      </span>
                    )}
                    {item.kind === "circle" ? (
                      <Link className="activity-source" href={`/circle/${item.post.circleId}`}>
                        {item.post.circleName || "Circle"}
                      </Link>
                    ) : (
                      <span className="activity-source activity-source--general">General</span>
                    )}
                    <time dateTime={new Date(item.post.createdAt).toISOString()}>
                      {timeAgo(item.post.createdAt)}
                    </time>
                  </header>
                  <p className="board-cast__body">{item.post.body}</p>
                  {item.kind === "general" && (
                    <CastActions
                      postId={item.post.id}
                      text={item.post.body}
                      sharePath={`/post/${item.post.id}`}
                      reaction={reactions[item.post.id] ?? EMPTY_REACTION}
                      onChange={(next) =>
                        setReactions((current) => ({ ...current, [item.post.id]: next }))
                      }
                    />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
