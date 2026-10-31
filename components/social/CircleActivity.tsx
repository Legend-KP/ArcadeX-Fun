"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Circle = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  memberCount: number;
};

type Post = {
  id: string;
  circleId: string;
  circleName?: string;
  authorName: string;
  body: string;
  createdAt: number;
};

export default function CircleActivity() {
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/social/circles/activity", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        const data = (await res.json()) as {
          circles?: Circle[];
          posts?: Post[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Could not load activity.");
        if (cancelled) return;
        setCircles(data.circles ?? []);
        setPosts(data.posts ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCircles([]);
        setError(err instanceof Error ? err.message : "Could not load activity.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="soc-notes" aria-label="Activity">
      <h1>Activity</h1>
      {error && <p className="board-error">{error}</p>}
      <h2>Your circles</h2>
      {circles === null && <p className="soc-note">Loading circles…</p>}
      {circles && circles.length === 0 && (
        <p className="soc-note">
          You have not joined a circle yet. <Link href="/circles">Open circles</Link>
        </p>
      )}
      {circles && circles.length > 0 && (
        <ul className="soc-challenge-list">
          {circles.map((circle) => (
            <li key={circle.id} className="soc-challenge">
              <p>
                <Link href={`/circle/${circle.id}`}>
                  <strong>{circle.name}</strong>
                </Link>
                <span>
                  {" "}
                  · {circle.memberCount} members ·{" "}
                  {circle.visibility === "private" ? "Private" : "Public"}
                </span>
              </p>
              <p>{circle.description}</p>
            </li>
          ))}
        </ul>
      )}
      <h2>Posts in your circles</h2>
      {posts.length === 0 && circles !== null && (
        <p className="soc-note">No posts in your circles yet.</p>
      )}
      <ul className="soc-challenge-list">
        {posts.map((post) => (
          <li key={post.id} className="soc-challenge">
            <p>
              <strong>{post.authorName}</strong>
              {post.circleName && (
                <>
                  {" "}
                  in{" "}
                  <Link href={`/circle/${post.circleId}`}>{post.circleName}</Link>
                </>
              )}
            </p>
            <p>{post.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
