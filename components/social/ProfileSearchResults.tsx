"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Hit = {
  fid: number | null;
  name: string;
  handle: string | null;
  pfpUrl: string | null;
  href: string;
};

export default function ProfileSearchResults({ query }: { query: string }) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState("");
  const q = query.trim();

  useEffect(() => {
    if (!q) {
      setHits(null);
      setError("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/farcaster/search?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
      })
        .then(async (res) => {
          const data = (await res.json()) as { players?: Hit[]; error?: string };
          if (!res.ok) throw new Error(data.error || "Could not search players.");
          if (!cancelled) {
            setHits(data.players ?? []);
            setError("");
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setHits([]);
          setError(err instanceof Error ? err.message : "Could not search players.");
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q]);

  if (!q) return null;

  return (
    <section className="profile-search" aria-label="Players">
      <h2>Players</h2>
      {error && <p className="board-error">{error}</p>}
      {!error && hits === null && <p className="soc-note">Searching players…</p>}
      {hits && hits.length === 0 && !error && (
        <p className="soc-note">No players match that search.</p>
      )}
      {hits && hits.length > 0 && (
        <ul>
          {hits.map((hit) => (
            <li key={hit.href}>
              <Link href={hit.href}>
                {hit.pfpUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={hit.pfpUrl} alt="" />
                ) : (
                  <span>{hit.name.charAt(0).toUpperCase()}</span>
                )}
                <p>
                  <strong>{hit.name}</strong>
                  {hit.handle && <small>{hit.handle}</small>}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
