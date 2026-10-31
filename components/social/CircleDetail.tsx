"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import WebHeader from "@/components/WebHeader";
import SocialSidebar from "@/components/social/SocialSidebar";
import { useSocialMe } from "@/components/social/useSocialMe";
import { socialIdentity } from "@/components/farcaster/social-me";
import type { Game } from "@/types";
import { respondToChallenge, type SocialChallenge } from "@/lib/social-challenges-client";

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

type Post = {
  id: string;
  fid: number;
  authorName: string;
  body: string;
  createdAt: number;
};

type Member = {
  fid: number;
  name: string;
  handle: string;
};

type JoinRequest = {
  id: string;
  fid: number;
  name: string;
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
  const [posts, setPosts] = useState<Post[]>([]);
  const [challenges, setChallenges] = useState<SocialChallenge[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [body, setBody] = useState("");
  const [target, setTarget] = useState("");
  const [gameId, setGameId] = useState("");
  const [expiryHours, setExpiryHours] = useState<24 | 72>(24);
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
    if (locked || !circle) return;
    let cancelled = false;
    const load = async (path: string) => {
      const res = await fetch(path, { cache: "no-store", credentials: "same-origin" });
      return res.json() as Promise<Record<string, unknown>>;
    };
    void Promise.all([
      load(`/api/social/circles/${encodeURIComponent(circleId)}/posts`),
      load(`/api/social/circles/${encodeURIComponent(circleId)}/challenges`),
      load(`/api/social/circles/${encodeURIComponent(circleId)}/members`),
      fetch("/api/games", { cache: "no-store" }).then((res) => res.json()),
    ])
      .then(([postData, challengeData, memberData, gameData]) => {
        if (cancelled) return;
        setPosts((postData.posts as Post[]) ?? []);
        setChallenges((challengeData.challenges as SocialChallenge[]) ?? []);
        setMembers((memberData.members as Member[]) ?? []);
        const nextGames = (gameData as { games?: Game[] }).games ?? [];
        setGames(nextGames);
        setGameId((current) => current || nextGames[0]?.id || "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [circle, locked, circleId]);

  useEffect(() => {
    if (!isCreator) return;
    let cancelled = false;
    void Promise.all([
      fetch(`/api/social/circles/${encodeURIComponent(circleId)}/invites`, {
        cache: "no-store",
        credentials: "same-origin",
      }).then((res) => res.json()),
      fetch(`/api/social/circles/${encodeURIComponent(circleId)}/requests`, {
        cache: "no-store",
        credentials: "same-origin",
      }).then((res) => res.json()),
    ]).then(([inviteData, requestData]) => {
      if (cancelled) return;
      setLinks((inviteData as { links?: LinkRow[] }).links ?? []);
      setRequests((requestData as { requests?: JoinRequest[] }).requests ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [circleId, isCreator]);

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/social/circles/${encodeURIComponent(circleId)}/posts`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await res.json()) as { post?: Post; error?: string };
      if (!res.ok || !data.post) throw new Error(data.error || "Could not post.");
      setPosts((current) => [data.post as Post, ...current]);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post.");
    } finally {
      setBusy(false);
    }
  }

  async function challenge(event: React.FormEvent) {
    event.preventDefault();
    const game = games.find((item) => item.id === gameId);
    if (!game || !target) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/social/circles/${encodeURIComponent(circleId)}/challenges`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          gameId: game.id,
          gameName: game.name,
          expiryHours,
        }),
      });
      const data = (await res.json()) as { challenge?: SocialChallenge; error?: string };
      if (!res.ok || !data.challenge) throw new Error(data.error || "Could not send the challenge.");
      setChallenges((current) => [data.challenge as SocialChallenge, ...current]);
      setTarget("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the challenge.");
    } finally {
      setBusy(false);
    }
  }

  async function removePost(postId: string) {
    const res = await fetch(
      `/api/social/circles/${encodeURIComponent(circleId)}/posts/${encodeURIComponent(postId)}`,
      { method: "DELETE", credentials: "same-origin" }
    );
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error || "Could not remove the post.");
      return;
    }
    setPosts((current) => current.filter((post) => post.id !== postId));
  }

  async function reportPost(postId: string) {
    const reason = window.prompt("Why are you reporting this post?");
    if (!reason || reason.trim().length < 3) return;
    const res = await fetch("/api/social/reports", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetKind: "circle_post", targetId: postId, reason: reason.trim() }),
    });
    const data = (await res.json()) as { error?: string };
    setError(res.ok ? "" : data.error || "Could not report this post.");
  }

  async function decide(requestId: string, action: "approve" | "decline") {
    const res = await fetch(`/api/social/circles/${encodeURIComponent(circleId)}/requests`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, action }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error || "Could not update the request.");
      return;
    }
    setRequests((current) => current.filter((item) => item.id !== requestId));
    if (action === "approve" && circle) {
      setCircle({ ...circle, memberCount: circle.memberCount + 1 });
    }
  }

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

  const others = members.filter((member) => member.fid !== viewer?.fid);

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
              <Link href="/circles">Your circles</Link>
            </p>
            {error && <p className="board-error">{error}</p>}
            {!circle && !error && <p className="soc-note">Loading circle…</p>}
            {circle && (
              <div className="circle-layout">
                <div>
                  <section className="invite-banner">
                    <p className="invite-banner__badge">
                      {circle.visibility === "private" ? "Private" : "Public"}
                      <span> · {circle.memberCount} members</span>
                    </p>
                    <h1>{circle.name}</h1>
                    <p>{circle.description}</p>
                    {isMember && <p className="soc-note">You are in this circle.</p>}
                    {locked && (
                      <p className="soc-note">
                        This circle is private. Posts and challenges stay hidden until you are a member.
                      </p>
                    )}
                  </section>

                  {isMember && !locked && (
                    <>
                      <form className="soc-challenge-form" onSubmit={(event) => void publish(event)}>
                        <label>
                          Post
                          <input
                            value={body}
                            onChange={(event) => setBody(event.target.value)}
                            maxLength={280}
                            placeholder="Share something with this circle"
                            required
                          />
                        </label>
                        <button type="submit" className="connect-btn" disabled={busy || !body.trim()}>
                          Post
                        </button>
                      </form>
                      <form className="soc-challenge-form" onSubmit={(event) => void challenge(event)}>
                        <label>
                          Challenge a member
                          <select value={target} onChange={(event) => setTarget(event.target.value)} required>
                            <option value="">Choose a member</option>
                            {others.map((member) => (
                              <option key={member.fid} value={member.handle}>
                                {member.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Game
                          <select value={gameId} onChange={(event) => setGameId(event.target.value)}>
                            {games.map((game) => (
                              <option key={game.id} value={game.id}>
                                {game.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Window
                          <select
                            value={expiryHours}
                            onChange={(event) => setExpiryHours(event.target.value === "72" ? 72 : 24)}
                          >
                            <option value={24}>24 hours</option>
                            <option value={72}>72 hours</option>
                          </select>
                        </label>
                        <button type="submit" className="connect-btn" disabled={busy || !target}>
                          Challenge
                        </button>
                      </form>
                    </>
                  )}

                  {!locked && (
                    <>
                      <h2>Posts</h2>
                      {posts.length === 0 && <p className="soc-note">No posts in this circle yet.</p>}
                      <ul className="soc-challenge-list">
                        {posts.map((post) => (
                          <li key={post.id} className="soc-challenge">
                            <p>
                              <strong>{post.authorName}</strong>
                            </p>
                            <p>{post.body}</p>
                            <div className="soc-challenge__actions">
                              {(post.fid === viewer?.fid || isCreator) && (
                                <button type="button" className="soc-decline" onClick={() => void removePost(post.id)}>
                                  Remove
                                </button>
                              )}
                              <button type="button" className="soc-text-btn" onClick={() => void reportPost(post.id)}>
                                Report
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <h2>Challenges</h2>
                      {challenges.length === 0 && <p className="soc-note">No challenges in this circle yet.</p>}
                      <ul className="soc-challenge-list">
                        {challenges.map((item) => (
                          <li key={item.id} className="soc-challenge">
                            <p>
                              <strong>{item.challengerName}</strong> challenged {item.targetLabel}
                            </p>
                            <p>
                              <Link href={`/game/${item.gameId}`}>{item.gameName}</Link>
                              <span>
                                {" "}
                                · {item.expiryHours}h · {item.status}
                              </span>
                            </p>
                            {item.status === "pending" && item.targetFid === viewer?.fid && (
                              <div className="soc-challenge__actions">
                                <button
                                  type="button"
                                  className="connect-btn"
                                  onClick={() =>
                                    void respondToChallenge(item.id, "accept").then((message) => {
                                      if (message) setError(message);
                                      else {
                                        setChallenges((current) =>
                                          current.map((row) =>
                                            row.id === item.id
                                              ? { ...row, status: "accepted", acceptedAt: Date.now() }
                                              : row
                                          )
                                        );
                                      }
                                    })
                                  }
                                >
                                  Accept
                                </button>
                                <button
                                  type="button"
                                  className="soc-decline"
                                  onClick={() =>
                                    void respondToChallenge(item.id, "decline").then((message) => {
                                      if (message) setError(message);
                                      else {
                                        setChallenges((current) =>
                                          current.map((row) =>
                                            row.id === item.id ? { ...row, status: "declined" } : row
                                          )
                                        );
                                      }
                                    })
                                  }
                                >
                                  Decline
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>

                <aside className="circle-side">
                  <h2>Invite link</h2>
                  {!isCreator && (
                    <p className="soc-note">Only the circle creator can make an invite link.</p>
                  )}
                  {isCreator && (
                    <>
                      {requests.length > 0 && (
                        <>
                          <h2>Requests</h2>
                          <ul className="soc-challenge-list">
                            {requests.map((item) => (
                              <li key={item.id} className="soc-challenge">
                                <p>
                                  <strong>{item.name}</strong> wants to join
                                </p>
                                <div className="soc-challenge__actions">
                                  <button type="button" className="connect-btn" onClick={() => void decide(item.id, "approve")}>
                                    Approve
                                  </button>
                                  <button type="button" className="soc-decline" onClick={() => void decide(item.id, "decline")}>
                                    Decline
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
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
                          <select value={maxUses} onChange={(event) => setMaxUses(Number(event.target.value))}>
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
                    </>
                  )}
                </aside>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
