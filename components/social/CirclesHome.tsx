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

export default function CirclesHome() {
  const router = useRouter();
  const { me, loading, ready } = useSocialMe();
  const viewer = me ? socialIdentity(me) : null;
  const [circles, setCircles] = useState<Circle[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !ready) router.replace("/social");
  }, [loading, ready, router]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    fetch("/api/social/circles", { cache: "no-store", credentials: "same-origin" })
      .then(async (res) => {
        const data = (await res.json()) as { circles?: Circle[]; error?: string };
        if (!res.ok) throw new Error(data.error || "Could not load circles.");
        if (!cancelled) setCircles(data.circles ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load circles.");
      });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/social/circles", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, visibility }),
      });
      const data = (await res.json()) as { circle?: Circle; error?: string };
      if (!res.ok || !data.circle) throw new Error(data.error || "Could not create the circle.");
      router.push(`/circle/${data.circle.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the circle.");
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
            <h1>Circles</h1>
            {error && <p className="board-error">{error}</p>}
            <ul className="soc-challenge-list">
              {circles.map((circle) => (
                <li key={circle.id} className="soc-challenge">
                  <p>
                    <Link href={`/circle/${circle.id}`}>
                      <strong>{circle.name}</strong>
                    </Link>
                    <span>
                      {" "}
                      · {circle.visibility === "private" ? "Private" : "Public"} · {circle.memberCount}
                    </span>
                  </p>
                  <p>{circle.description}</p>
                </li>
              ))}
            </ul>
            {circles.length === 0 && ready && <p className="soc-note">You have not joined a circle yet.</p>}
            <h2>Create a circle</h2>
            <form className="soc-challenge-form" onSubmit={(event) => void create(event)}>
              <label>
                Name
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required />
              </label>
              <label>
                Description
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={280}
                  required
                />
              </label>
              <label>
                Visibility
                <select
                  value={visibility}
                  onChange={(event) => setVisibility(event.target.value === "private" ? "private" : "public")}
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </label>
              <button type="submit" className="connect-btn" disabled={busy}>
                {busy ? "Creating…" : "Create circle"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
