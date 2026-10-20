"use client";

import { useCallback, useEffect, useState } from "react";
import CreateFidPanel from "@/components/farcaster/CreateFidPanel";
import EmailVerifyForm from "@/components/farcaster/EmailVerifyForm";
import SignInWithFarcasterButton from "@/components/farcaster/SignInWithFarcasterButton";
import SocialChrome from "@/components/farcaster/SocialChrome";
import SocialProfileCard from "@/components/farcaster/SocialProfileCard";
import SocialSearch from "@/components/farcaster/SocialSearch";
import UsernameForm from "@/components/farcaster/UsernameForm";
import type { SocialProfile } from "@/types";

type MeResponse = {
  signedIn?: boolean;
  fid?: number;
  address?: string;
  profile?: SocialProfile | null;
  usernameSkipped?: boolean;
  custody?: string | null;
  recovery?: string | null;
  custodyChanged?: boolean;
  neynar?: {
    username?: string;
    display_name?: string;
    pfp_url?: string;
  } | null;
  error?: string;
};

const STEPS = ["Account", "Email", "Username", "Search"] as const;

export default function SocialShell() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/farcaster/me");
      if (res.status === 401) {
        setMe(null);
        return;
      }
      const data = (await res.json()) as MeResponse;
      if (!res.ok) throw new Error(data.error || "Could not load your profile.");
      setMe(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe(null);
  }

  const profile = me?.profile;
  const emailVerified = Boolean(profile?.emailVerifiedAt);
  const hasUsername = Boolean(profile?.username);
  const usernameDone = hasUsername || Boolean(me?.usernameSkipped);
  const step = !me?.fid ? 0 : !emailVerified ? 1 : !usernameDone ? 2 : 3;

  const displayName =
    profile?.displayName || me?.neynar?.display_name || profile?.fname;
  const fname = profile?.fname || me?.neynar?.username;
  const pfpUrl = profile?.pfpUrl || me?.neynar?.pfp_url;

  return (
    <SocialChrome>
      <h1>ArcadeX Social</h1>
      <p className="sx-muted">
        Sign in with Farcaster, confirm your email, then search players. Posting
        comes later.
      </p>
      <ol className="sx-steps">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? "is-on" : undefined}>
            {label}
          </li>
        ))}
      </ol>
      {error && <p className="sx-error">{error}</p>}
      {loading && <p className="sx-muted">Loading…</p>}

      {!loading && step === 0 && (
        <>
          <section className="sx-card">
            <h2>Already have a FID</h2>
            <p className="sx-muted">
              Scan the QR in Warpcast. ArcadeX stores your FID after the
              signature checks out.
            </p>
            <div style={{ marginTop: 12 }}>
              <SignInWithFarcasterButton onSuccess={() => void refresh()} />
            </div>
          </section>
          <CreateFidPanel onCreated={() => void refresh()} />
        </>
      )}

      {!loading && me?.fid && (
        <SocialProfileCard
          displayName={displayName}
          fname={fname}
          username={profile?.username}
          fid={me.fid}
          pfpUrl={pfpUrl}
          custody={me.custody || profile?.custodyAddress || me.address}
          recovery={me.recovery}
          email={profile?.email}
          emailVerified={emailVerified}
          custodyChanged={me.custodyChanged}
        />
      )}

      {!loading && step === 1 && (
        <EmailVerifyForm onVerified={() => void refresh()} />
      )}
      {!loading && step === 2 && (
        <UsernameForm onDone={() => void refresh()} />
      )}
      {!loading && step === 3 && <SocialSearch />}

      {!loading && me?.fid && (
        <div className="sx-row">
          <button type="button" className="sx-ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      )}
    </SocialChrome>
  );
}
