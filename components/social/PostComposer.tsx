"use client";

import { useRef, useState } from "react";
import SignerApproval from "@/components/farcaster/SignerApproval";
import { socialIdentity, type SocialMe } from "@/components/farcaster/social-me";
import type { TextPost } from "@/lib/social-board";

type Props = {
  me: SocialMe;
  onPosted: (post: TextPost) => void;
};

export default function PostComposer({ me, onPosted }: Props) {
  const identity = socialIdentity(me);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  function growField() {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 120)}px`;
  }

  async function publish() {
    const body = draft.trim();
    if (!body || publishing) return;
    setPublishing(true);
    setError("");
    try {
      const res = await fetch("/api/social/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await res.json()) as {
        post?: TextPost;
        error?: string;
        farcaster?: { published?: boolean; reason?: string; error?: string };
      };
      if (!res.ok || !data.post) {
        throw new Error(data.error || "Could not publish.");
      }
      onPosted(data.post);
      setDraft("");
      if (fieldRef.current) fieldRef.current.style.height = "auto";
      if (data.farcaster?.published) {
        setError("");
      } else if (data.farcaster?.reason === "approval_required") {
        setError("Saved in ArcadeX. Approve the Farcaster signer to also publish it on your profile.");
      } else if (data.farcaster?.error) {
        setError(data.farcaster.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="web-header__post">
      <form
        className="board-composer board-composer--header"
        onSubmit={(event) => event.preventDefault()}
      >
        {identity.pfpUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="board-avatar" src={identity.pfpUrl} alt="" />
        ) : (
          <span className="board-avatar">{identity.displayName.charAt(0).toUpperCase()}</span>
        )}
        <textarea
          ref={fieldRef}
          value={draft}
          rows={1}
          onChange={(event) => {
            setDraft(event.target.value);
            growField();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.stopPropagation();
          }}
          maxLength={280}
          placeholder="What's on your mind? Share a game, a score or just say hi..."
          aria-label="Write a text post"
        />
        <button
          type="button"
          disabled={publishing || draft.trim().length === 0}
          onClick={() => void publish()}
        >
          {publishing ? "Posting" : "Post"}
        </button>
      </form>
      {error && <p className="board-error web-header__post-error">{error}</p>}
      <SignerApproval />
    </div>
  );
}
