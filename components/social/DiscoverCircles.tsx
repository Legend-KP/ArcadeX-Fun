"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Circle = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  memberCount: number;
  joined: boolean;
  requested: boolean;
};

export default function DiscoverCircles() {
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/social/circles/discover", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        const data = (await res.json()) as { circles?: Circle[]; error?: string };
        if (!res.ok) throw new Error(data.error || "Could not load circles.");
        if (!cancelled) setCircles(data.circles ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCircles([]);
          setError(err instanceof Error ? err.message : "Could not load circles.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function act(circle: Circle) {
    const path = circle.visibility === "private" ? "request" : "join";
    setBusyId(circle.id);
    setError("");
    try {
      const res = await fetch(`/api/social/circles/${encodeURIComponent(circle.id)}/${path}`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not update this circle.");
      setCircles((current) =>
        (current ?? []).map((item) =>
          item.id === circle.id
            ? {
                ...item,
                joined: item.visibility === "public" ? true : item.joined,
                requested: item.visibility === "private" ? true : item.requested,
                memberCount:
                  item.visibility === "public" && !item.joined
                    ? item.memberCount + 1
                    : item.memberCount,
              }
            : item
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this circle.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="board-card discover-circles">
      <header>
        <h2>Discover circles</h2>
      </header>
      {error && <p className="board-error">{error}</p>}
      {circles === null && !error && <p className="board-empty">Loading circles…</p>}
      {circles && circles.length === 0 && (
        <p className="board-empty">No circles yet. Create the first one.</p>
      )}
      {circles && circles.length > 0 && (
        <ul className="discover-circles__list">
          {circles.map((circle) => {
            const pending = circle.visibility === "private" && circle.requested && !circle.joined;
            const label = circle.joined ? "Joined" : pending ? "Pending" : circle.visibility === "private" ? "Request" : "Join";
            return (
              <li key={circle.id}>
                <div className="discover-circles__row">
                  <span className="games-rail__avatar" aria-hidden>
                    {circle.name.charAt(0).toUpperCase()}
                  </span>
                  <p>
                  <strong>
                    <Link href={`/circle/${circle.id}`}>{circle.name}</Link>
                    {circle.visibility === "private" && (
                      <span className="discover-circles__lock" aria-label="Private">
                        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
                          <rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                          <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="1.8" />
                        </svg>
                      </span>
                    )}
                  </strong>
                    <small>{circle.memberCount} members</small>
                  </p>
                  <button
                    type="button"
                    disabled={busyId === circle.id || circle.joined || pending}
                    onClick={() => void act(circle)}
                  >
                    {label}
                  </button>
                </div>
                <p className="discover-circles__about">{circle.description}</p>
              </li>
            );
          })}
        </ul>
      )}
      <Link className="discover-circles__more" href="/circles">
        Explore more circles
      </Link>
    </section>
  );
}
