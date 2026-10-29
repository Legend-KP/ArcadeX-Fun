"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import WebHeader from "@/components/WebHeader";
import SocialSidebar from "@/components/social/SocialSidebar";
import { useSocialMe } from "@/components/social/useSocialMe";
import { socialIdentity } from "@/components/farcaster/social-me";

type Circle = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  memberCount: number;
};

type LinkRow = {
  id: string;
  expiresAt: number | null;
  maxUses: number;
  uses: number;
  createdAt: number;
  revokedAt: number | null;
  open: boolean;
};

function expiryLabel(expiresAt: number | null): string {
  if (expiresAt == null) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(expiresAt);
}

export default function CircleDetail({ circleId }: { circleId: string }) {
  const router = useRouter();
  const { me, loading, ready } = useSocialMe();
  const viewer = me ? socialIdentity(me) : null;
  const [circle, setCircle] = useState<Circle | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [locked, setLocked] = useState(false);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [expiry, setExpiry] = useState("7");
  const [maxUses, setMaxUses] = useState(10);
  const [freshUrl, setFreshUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !ready) router.replace("/social");
  }, [loading, ready, router]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/social/circles/${encodeURIComponent(circleId)}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        const data = (await res.json()) as {
          circle?: Circle;
          isCreator?: boolean;
          isMember?: boolean;
          locked?: boolean;
          error?: string;
        };
        if (!res.ok || !data.circle) throw new Error(data.error || "Circle not found.");
        if (cancelled) return;
        setCircle(data.circle);
        setIsCreator(Boolean(data.isCreator));
        setIsMember(Boolean(data.isMember));
        setLocked(Boolean(data.locked));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Circle not found.");
      });
    return () => {
      cancelled = true;
    };
  }, [circleId]);

  useEffect(() => {
    if (!isCreator) return;
    let cancelled = false;
    fetch(`/api/social/circles/${encodeURIComponent(circleId)}/invites`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        const data = (await res.json()) as { links?: LinkRow[]; error?: string };
        if (!res.ok) throw new Error(data.error || "Could not load invite links.");
        if (!cancelled) setLinks(data.links ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load invite links.");
      });
    return () => {
      cancelled = true;
    };
  }, [circleId, isCreator]);

  async function createLink(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setFreshUrl("");
    try {
      const res = await fetch(`/api/social/circles/${encodeURIComponent(circleId)}/invites`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiry, maxUses }),
      });
      const data = (await res.json()) as { url?: string; link?: LinkRow; error?: string };
      if (!res.ok || !data.url || !data.link) {
        throw new Error(data.error || "Could not create an invite link.");
      }
      setFreshUrl(`${window.location.origin}${data.url}`);
      setLinks((current) => [data.link as LinkRow, ...current]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create an invite link.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(linkId: string) {
    setError("");
    const res = await fetch(
      `/api/social/circles/${encodeURIComponent(circleId)}/invites/${encodeURIComponent(linkId)}`,
      { method: "POST", credentials: "same-origin" }
    );
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(data.error || "Could not revoke the invite.");
      return;
    }
    setLinks((current) =>
      current.map((link) =>
        link.id === linkId ? { ...link, open: false, revokedAt: Date.now() } : link
      )
    );
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
            <p className="soc-note">
              <Link href="/circles">All circles</Link>
            </p>
            {error && <p className="board-error">{error}</p>}
            {!circle && !error && <p className="soc-note">Loading circle…</p>}
            {circle && (
              <section className="invite-banner">
                <p className="invite-banner__badge">
                  {circle.visibility === "private" ? "Private" : "Public"}
                  <span> · {circle.memberCount} members</span>
                </p>
                <h1>{circle.name}</h1>
                <p>{circle.description}</p>
                {locked && (
                  <p className="soc-note">This circle is private. Posts stay hidden until you are a member.</p>
                )}
                {isMember && !locked && (
                  <p className="soc-note">You are in this circle.</p>
                )}
              </section>
            )}
            {isCreator && circle && (
              <section className="invite-manager">
                <h2>Invite links</h2>
                <form className="soc-challenge-form" onSubmit={(event) => void createLink(event)}>
                  <label>
                    Expires
                    <select value={expiry} onChange={(event) => setExpiry(event.target.value)}>
                      <option value="1">1 day</option>
                      <option value="7">7 days</option>
                      <option value="30">30 days</option>
                      <option value="never">Never</option>
                    </select>
                  </label>
                  <label>
                    Max uses
                    <select
                      value={maxUses}
                      onChange={(event) => setMaxUses(Number(event.target.value))}
                    >
                      <option value={1}>1</option>
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                    </select>
                  </label>
                  <button type="submit" className="connect-btn" disabled={busy}>
                    {busy ? "Creating…" : "Create invite link"}
                  </button>
                </form>
                {freshUrl && (
                  <p className="invite-fresh">
                    Copy this link now. It will not be shown again.
                    <code>{freshUrl}</code>
                  </p>
                )}
                <ul className="soc-challenge-list">
                  {links.map((link) => (
                    <li key={link.id} className="soc-challenge">
                      <p>
                        <strong>{expiryLabel(link.expiresAt)}</strong>
                        <span>
                          {" "}
                          · {link.uses}/{link.maxUses} uses
                          {link.revokedAt ? " · Revoked" : link.open ? " · Open" : " · Closed"}
                        </span>
                      </p>
                      {link.open && (
                        <button type="button" className="soc-decline" onClick={() => void revoke(link.id)}>
                          Revoke
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
