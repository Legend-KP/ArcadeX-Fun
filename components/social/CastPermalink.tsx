"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import WebHeader from "@/components/WebHeader";
import SocialSidebar from "@/components/social/SocialSidebar";
import ShareLink from "@/components/social/ShareLink";
import { useSocialMe } from "@/components/social/useSocialMe";
import { socialIdentity } from "@/components/farcaster/social-me";
import { profileHref } from "@/lib/farcaster/public-profile";
import type { TextPost } from "@/lib/social-board";

export default function CastPermalink({ id }: { id: string }) {
  const router = useRouter();
  const { me, ready } = useSocialMe();
  const [post, setPost] = useState<TextPost | null>(null);
  const [error, setError] = useState("");
  const viewer = me ? socialIdentity(me) : null;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/social/posts/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json()) as { post?: TextPost; error?: string };
        if (!res.ok) throw new Error(data.error || "Post not found.");
        if (!cancelled) setPost(data.post ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Post not found.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const authorHref = post
    ? profileHref({ username: post.authorHandle, fid: post.fid })
    : null;

  return (
    <div className="home">
      <div className="home-shell">
        <WebHeader profileName={viewer?.displayName} profileImage={viewer?.pfpUrl} />
        <div className="soc-body">
          <SocialSidebar
            active="home"
            me={me}
            ready={ready}
            onSelect={(section) => {
              if (section === "games") {
                router.push("/");
                return;
              }
              if (section === "home") {
                router.push("/?section=activity");
                return;
              }
              router.push(`/?section=${section}`);
            }}
          />
          <div className="soc-main">
            <p className="soc-note">
              <Link href="/?section=activity">Back to Activity</Link>
            </p>
            {error && <p className="board-error">{error}</p>}
            {!post && !error && <p className="soc-note">Loading cast…</p>}
            {post && (
              <article className="board-post board-cast">
                <div className="board-cast__main">
                  <header>
                    {authorHref ? (
                      <Link href={authorHref} className="board-cast__profile">
                        <strong>{post.authorName}</strong>
                      </Link>
                    ) : (
                      <strong>{post.authorName}</strong>
                    )}
                    {post.authorHandle && (
                      <span className="board-cast__handle">
                        @{post.authorHandle.replace(/^@/, "")}
                      </span>
                    )}
                  </header>
                  <p className="board-cast__body">{post.body}</p>
                  <ShareLink
                    path={`/post/${post.id}`}
                    title={`${post.authorName} on ArcadeX`}
                    text={post.body}
                  />
                </div>
              </article>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
