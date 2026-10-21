"use client";

import { useState } from "react";
import type { PostComment, ReactionSummary } from "@/lib/social-reactions";

type Props = {
  postId: string;
  text: string;
  reaction: ReactionSummary;
  onChange: (next: ReactionSummary) => void;
};

const EMPTY: ReactionSummary = {
  likes: 0,
  liked: false,
  comments: 0,
  shares: 0,
  shared: false,
};

async function react(
  action: "like" | "share" | "comment" | "comments",
  id: string,
  body?: string
) {
  const res = await fetch("/api/social/reactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({ action, id, body }),
  });
  const data = (await res.json()) as {
    reaction?: ReactionSummary;
    comments?: PostComment[];
    comment?: PostComment;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || "Could not update the post.");
  return data;
}

export default function CastActions({ postId, text, reaction, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const current = reaction ?? EMPTY;

  async function loadComments() {
    const data = await react("comments", postId);
    setComments(data.comments ?? []);
  }

  async function onCommentClick() {
    setNote("");
    const next = !open;
    setOpen(next);
    if (next && comments === null) {
      try {
        await loadComments();
      } catch (err) {
        setNote(err instanceof Error ? err.message : "Could not load comments.");
      }
    }
  }

  async function onLike() {
    setNote("");
    try {
      const data = await react("like", postId);
      if (data.reaction) onChange(data.reaction);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not like this post.");
    }
  }

  async function onShare() {
    setNote("");
    const url = `${window.location.origin}/`;
    const payload = { title: "ArcadeX", text, url };
    try {
      if (navigator.share) {
        await navigator.share(payload);
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setNote("Copied");
      }
      const data = await react("share", postId);
      if (data.reaction) onChange(data.reaction);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setNote(err instanceof Error ? err.message : "Could not share this post.");
    }
  }

  async function onReply(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    setNote("");
    try {
      const data = await react("comment", postId, draft);
      if (data.comment) setComments((list) => [...(list ?? []), data.comment!]);
      if (data.reaction) onChange(data.reaction);
      setDraft("");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not comment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cast-actions">
      <div className="cast-actions__row">
        <button type="button" onClick={() => void onCommentClick()} aria-label="Comment">
          <CommentIcon />
          {current.comments > 0 && <span>{current.comments}</span>}
        </button>
        <button
          type="button"
          className={current.shared ? "is-shared" : undefined}
          onClick={() => void onShare()}
          aria-label="Share"
        >
          <ShareIcon />
          {current.shares > 0 && <span>{current.shares}</span>}
        </button>
        <button
          type="button"
          className={current.liked ? "is-liked" : undefined}
          onClick={() => void onLike()}
          aria-pressed={current.liked}
          aria-label="Like"
        >
          <LikeIcon filled={current.liked} />
          {current.likes > 0 && <span>{current.likes}</span>}
        </button>
      </div>
      {note && <p className="cast-actions__note">{note}</p>}
      {open && (
        <div className="cast-actions__thread">
          {comments === null ? (
            <p className="cast-actions__note">Loading comments…</p>
          ) : (
            comments.map((comment) => (
              <p key={comment.id}>
                <strong>{comment.authorName}</strong>
                {comment.authorHandle ? <span> @{comment.authorHandle.replace(/^@/, "")}</span> : null}
                {" "}
                {comment.body}
              </p>
            ))
          )}
          <form onSubmit={(event) => void onReply(event)}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Post your reply"
              maxLength={280}
            />
            <button type="submit" disabled={busy || !draft.trim()}>
              Reply
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        d="M6 16.5 4.5 19.5c1.8-.4 3.2-1.2 4.2-2.1A8 8 0 1 0 6 16.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        d="M12 4v10M8.5 7.5 12 4l3.5 3.5M6 13.5V19h12v-5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LikeIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        d="M12 19.2 5.6 13a3.8 3.8 0 0 1 5.4-5.4L12 8.6l1-1a3.8 3.8 0 0 1 5.4 5.4L12 19.2Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
