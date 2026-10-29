"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import WebHeader from "@/components/WebHeader";
import SocialSidebar from "@/components/social/SocialSidebar";
import { useSocialMe } from "@/components/social/useSocialMe";
import { socialIdentity } from "@/components/farcaster/social-me";

type Preview = {
  valid: boolean;
  signedIn?: boolean;
  member?: boolean;
  inviterName?: string | null;
  circle?: {
    id: string;
    name: string;
    description: string;
    visibility: "public" | "private";
    memberCount: number;
  };
  error?: string;
};

export default function InviteLanding({ token }: { token: string }) {
  const router = useRouter();
  const { me, ready } = useSocialMe();
  const viewer = me ? socialIdentity(me) : null;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/social/invites/${encodeURIComponent(token)}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        const data = (await res.json()) as Preview;
        if (!res.ok) throw new Error(data.error || "Could not open this invite.");
        if (!cancelled) setPreview(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not open this invite.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const signInHref = `/social?next=${encodeURIComponent(`/invite/${token}`)}`;
  const circle = preview?.valid ? preview.circle : null;

  async function accept() {
    if (!me?.fid || !ready) {
      router.push(signInHref);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/social/invites/${encodeURIComponent(token)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      const data = (await res.json()) as { circleId?: string; error?: string };
      if (!res.ok || !data.circleId) {
        throw new Error(data.error || "This invite is no longer valid.");
      }
      router.push(`/circle/${data.circleId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "This invite is no longer valid.");
      setBusy(false);
    }
  }

  return (
    <div className="home">
      <div className="home-shell">
        <WebHeader profileName={viewer?.displayName} profileImage={viewer?.pfpUrl} />
        <div className="soc-body">
          <SocialSidebar
            active="circles"
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
            {error && <p className="board-error">{error}</p>}
            {!preview && !error && <p className="soc-note">Opening invite…</p>}
            {preview && !preview.valid && (
              <section className="invite-banner">
                <h1>This invite is no longer valid</h1>
                <p>The link may have expired, been revoked, or reached its use limit.</p>
                <Link href="/circles">Your circles</Link>
              </section>
            )}
            {circle && (
              <section className="invite-banner">
                <p className="invite-banner__badge">
                  {circle.visibility === "private" ? "Private" : "Public"}
                  <span> · {circle.memberCount} members</span>
                </p>
                <h1>{circle.name}</h1>
                <p>{circle.description}</p>
                {preview?.inviterName && (
                  <p className="soc-note">{preview.inviterName} invited you.</p>
                )}
                {preview?.member ? (
                  <p>
                    You are already in this circle.{" "}
                    <Link href={`/circle/${circle.id}`}>Open it</Link>
                  </p>
                ) : declined ? (
                  <p className="soc-note">
                    You declined this invite.
                    {circle.visibility === "private"
                      ? " Posts stay hidden."
                      : " You can still read this public circle without joining."}
                  </p>
                ) : (
                  <div className="soc-challenge__actions">
                    <button type="button" className="connect-btn" disabled={busy} onClick={() => void accept()}>
                      {busy ? "Joining…" : me?.fid && ready ? "Accept" : "Sign in to accept"}
                    </button>
                    <button type="button" className="soc-decline" onClick={() => setDeclined(true)}>
                      Decline
                    </button>
                  </div>
                )}
                {circle.visibility === "private" && !preview?.member && (
                  <p className="soc-note">Posts and mini challenges stay hidden until you accept.</p>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
