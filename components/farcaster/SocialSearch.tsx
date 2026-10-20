"use client";

import { useState } from "react";
import Link from "next/link";

type PublicProfile = {
  username?: string;
  displayName?: string;
  fname?: string;
  pfpUrl?: string;
  fid?: number;
};

type LookupResult = {
  fid?: number | null;
  username?: string;
  address?: string;
  profile?: PublicProfile | null;
  neynar?: {
    fid?: number;
    username?: string;
    display_name?: string;
    pfp_url?: string;
  } | null;
  error?: string;
};

function resultHref(result: LookupResult): string | null {
  const username = result.profile?.username;
  const fid = result.fid ?? result.profile?.fid ?? result.neynar?.fid;
  if (username) return `/u/${username}`;
  if (fid) return `/fid/${fid}`;
  return null;
}

export default function SocialSearch() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function search() {
    const q = query.trim().replace(/^@/, "");
    if (!q) return;
    setLoading(true);
    setResult(null);
    try {
      const params = new URLSearchParams();
      if (/^\d+$/.test(q)) params.set("fid", q);
      else if (q.startsWith("0x")) params.set("address", q);
      else params.set("username", q);
      const res = await fetch(`/api/farcaster/lookup?${params}`);
      const data = (await res.json()) as LookupResult;
      setResult(data);
    } catch (err) {
      setResult({
        error: err instanceof Error ? err.message : "Search failed.",
      });
    } finally {
      setLoading(false);
    }
  }

  const href = result ? resultHref(result) : null;
  const name =
    result?.profile?.displayName ||
    result?.neynar?.display_name ||
    result?.profile?.username ||
    result?.neynar?.username ||
    (result?.fid ? `FID ${result.fid}` : "");
  const pfp = result?.profile?.pfpUrl || result?.neynar?.pfp_url;
  const empty =
    result &&
    !result.error &&
    !result.profile &&
    !result.neynar &&
    !result.fid;

  return (
    <section className="sx-card">
      <h2>Search</h2>
      <p className="sx-muted">
        Find someone by ArcadeX username, FID, or custody address.
      </p>
      <div className="sx-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="username, FID, or 0x…"
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
        />
        <button type="button" onClick={() => void search()} disabled={loading}>
          {loading ? "…" : "Search"}
        </button>
      </div>
      {result?.error && <p className="sx-error">{result.error}</p>}
      {empty && <p className="sx-muted">No ArcadeX or Farcaster match.</p>}
      {result && !result.error && name && (
        href ? (
          <Link className="sx-result" href={href}>
            {pfp ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pfp} alt="" />
            ) : (
              <div className="sx-avatar">{name.charAt(0).toUpperCase()}</div>
            )}
            <div>
              <strong>{name}</strong>
              <p className="sx-meta">
                {result.profile?.username
                  ? `@${result.profile.username}`
                  : result.neynar?.username
                    ? `Farcaster @${result.neynar.username}`
                    : "Open profile"}
                {result.profile ? "" : " · not on ArcadeX yet"}
              </p>
            </div>
          </Link>
        ) : (
          <p className="sx-muted">No profile link for that result.</p>
        )
      )}
    </section>
  );
}
