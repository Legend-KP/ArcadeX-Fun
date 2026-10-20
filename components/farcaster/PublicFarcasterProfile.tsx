"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SocialChrome from "@/components/farcaster/SocialChrome";
import SocialProfileCard from "@/components/farcaster/SocialProfileCard";

type PublicProfile = {
  username?: string;
  displayName?: string;
  fname?: string;
  pfpUrl?: string;
  fid?: number;
  custodyAddress?: string;
  recoveryAddress?: string;
  emailVerified?: boolean;
};

type Lookup = {
  fid?: number | null;
  profile?: PublicProfile | null;
  neynar?: {
    fid?: number;
    username?: string;
    display_name?: string;
    pfp_url?: string;
    custody_address?: string;
  } | null;
  custody?: string | null;
  recovery?: string | null;
  error?: string;
};

type Props = {
  kind: "fid" | "username";
  value: string;
};

export default function PublicFarcasterProfile({ kind, value }: Props) {
  const [data, setData] = useState<Lookup | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (kind === "fid") params.set("fid", value);
    else params.set("username", value);

    fetch(`/api/farcaster/lookup?${params}`)
      .then(async (res) => {
        const body = (await res.json()) as Lookup;
        if (!res.ok) throw new Error(body.error || "Profile not found.");
        if (!cancelled) setData(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Profile not found.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [kind, value]);

  const profile = data?.profile;
  const neynar = data?.neynar;
  const fid = data?.fid ?? profile?.fid ?? neynar?.fid;
  const missing = data && !profile && !neynar && !fid;

  return (
    <SocialChrome>
      <p className="sx-muted">
        <Link href="/social">Back to social</Link>
      </p>
      {error && <p className="sx-error">{error}</p>}
      {!data && !error && <p className="sx-muted">Loading…</p>}
      {missing && <p className="sx-muted">No profile for that search.</p>}
      {data && !missing && !error && (
        <SocialProfileCard
          displayName={profile?.displayName || neynar?.display_name}
          fname={profile?.fname || neynar?.username}
          username={profile?.username}
          fid={fid}
          pfpUrl={profile?.pfpUrl || neynar?.pfp_url}
          custody={
            data.custody || profile?.custodyAddress || neynar?.custody_address
          }
          recovery={data.recovery || profile?.recoveryAddress}
          emailVerified={profile?.emailVerified}
        />
      )}
    </SocialChrome>
  );
}
