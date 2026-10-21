"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import CreateFidPanel from "@/components/farcaster/CreateFidPanel";
import EmailVerifyForm from "@/components/farcaster/EmailVerifyForm";
import SignInWithFarcasterButton from "@/components/farcaster/SignInWithFarcasterButton";
import SocialChrome from "@/components/farcaster/SocialChrome";
import SocialProfileCard from "@/components/farcaster/SocialProfileCard";
import UsernameForm from "@/components/farcaster/UsernameForm";
import {
  isSocialProfileReady,
  type SocialMe,
} from "@/components/farcaster/social-me";

const STEPS = ["Account", "Email", "Username"] as const;

export default function SocialShell() {
  const router = useRouter();
  const [me, setMe] = useState<SocialMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/farcaster/me", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (res.status === 401) {
        setMe(null);
        return;
      }
      const data = (await res.json()) as SocialMe;
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
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) void refresh();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
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
  const profileReady = isSocialProfileReady(me);

  const displayName =
    profile?.displayName || me?.neynar?.display_name || profile?.fname;
  const fname = profile?.fname || me?.neynar?.username;
  const pfpUrl = profile?.pfpUrl || me?.neynar?.pfp_url;

  useEffect(() => {
    if (!loading && profileReady) router.replace("/");
  }, [loading, profileReady, router]);

  if (!loading && profileReady) {
    return (
      <SocialChrome scene>
        <p className="sx-muted sx-lead">Opening home…</p>
      </SocialChrome>
    );
  }

  return (
    <SocialChrome scene>
      <div className="sx-lead">
        <Logo variant="login" />
        <p>
          Sign in with Farcaster, confirm your email, then choose a username.
        </p>
        <ol className="sx-steps">
          {STEPS.map((label, index) => (
            <li key={label} className={index === step ? "is-on" : undefined}>
              {label}
            </li>
          ))}
        </ol>
      </div>
      {error && <p className="sx-error">{error}</p>}
      {loading && <p className="sx-muted">Loading…</p>}

      {!loading && step === 0 && (
        <>
          <section className="sx-card">
            <div className="sx-card__head">
              <span className="sx-ico" aria-hidden>
                <svg viewBox="0 0 24 24" width="22" height="22">
                  <path
                    d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <h2>Already have a FID</h2>
            </div>
            <p className="sx-muted">
              Scan the QR in Warpcast. ArcadeX stores your FID after the
              signature checks out.
            </p>
            <SignInWithFarcasterButton onSuccess={() => void refresh()} />
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
