"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";

const SignInWithFarcasterButton = dynamic(
  () => import("@/components/farcaster/SignInWithFarcasterButton"),
  { ssr: false }
);

type LookupResult = {
  fid?: number | null;
  username?: string;
  address?: string;
  profile?: {
    playerId?: string;
    fid?: number;
    username?: string;
    displayName?: string;
    fname?: string;
    pfpUrl?: string;
  } | null;
  neynar?: {
    fid?: number;
    username?: string;
    display_name?: string;
    pfp_url?: string;
  } | null;
  error?: string;
};

/**
 * Minimal social shell (P4): SIWF + search by FID / ArcadeX username / address.
 */
export default function SocialPage() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setResult(null);
    try {
      const params = new URLSearchParams();
      if (/^\d+$/.test(q)) {
        params.set("fid", q);
      } else if (q.startsWith("0x")) {
        params.set("address", q);
      } else {
        params.set("username", q);
      }
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
  }, [query]);

  return (
    <main style={{ maxWidth: 560, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>ArcadeX Social</h1>
      <p>Sign in with Farcaster, then search by FID, username, or custody address.</p>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Sign in</h2>
        <SignInWithFarcasterButton />
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Search</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="FID, @username, or 0x…"
            style={{ flex: 1, padding: "0.5rem" }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
          />
          <button type="button" onClick={() => void search()} disabled={loading}>
            {loading ? "…" : "Search"}
          </button>
        </div>
        {result && (
          <pre
            style={{
              marginTop: "1rem",
              padding: "0.75rem",
              overflow: "auto",
              background: "rgba(0,0,0,0.06)",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </section>
    </main>
  );
}
