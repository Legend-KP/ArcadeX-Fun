"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import GameCard from "@/components/GameCard";
import SocialFrame from "@/components/farcaster/SocialFrame";
import {
  isSocialProfileReady,
  socialIdentity,
  type SocialMe,
} from "@/components/farcaster/social-me";
import { getGameProgress } from "@/lib/game-progress-client";
import type { Game } from "@/types";
import "./social.css";

export default function SocialSelfProfile() {
  const router = useRouter();
  const [me, setMe] = useState<SocialMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [played, setPlayed] = useState<Game[] | null>(null);
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const [playedError, setPlayedError] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/farcaster/me", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (res.status === 401) {
          if (!cancelled) router.replace("/social");
          return;
        }
        const data = (await res.json()) as SocialMe;
        if (!res.ok) throw new Error(data.error || "Could not load your profile.");
        if (cancelled) return;
        if (!isSocialProfileReady(data)) {
          router.replace("/social");
          return;
        }
        setMe(data);
      })
      .catch(() => {
        if (!cancelled) router.replace("/social");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  const identity = me ? socialIdentity(me) : null;

  useEffect(() => {
    if (!me) return;
    if (!identity?.playerId) {
      setPlayed([]);
      return;
    }

    let cancelled = false;
    const playerId = identity.playerId;

    async function loadPlayed() {
      setPlayedError("");
      try {
        const res = await fetch("/api/games", { cache: "no-store" });
        const data = (await res.json()) as {
          games?: Game[];
          playCounts?: Record<string, number>;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Could not load games.");
        const games = data.games ?? [];
        const counts = data.playCounts ?? {};

        const settled = await Promise.all(
          games.map(async (game) => {
            try {
              const progress = await getGameProgress(game.id, playerId);
              const score = progress.progress.score ?? 0;
              const level = progress.progress.level ?? 0;
              if (score > 0 || level > 0) return game;
            } catch {
              return null;
            }
            return null;
          })
        );

        if (cancelled) return;
        setPlayCounts(counts);
        setPlayed(settled.filter((game): game is Game => Boolean(game)));
      } catch (err) {
        if (cancelled) return;
        setPlayed([]);
        setPlayedError(
          err instanceof Error ? err.message : "Could not load played games."
        );
      }
    }

    void loadPlayed();
    return () => {
      cancelled = true;
    };
  }, [me, identity?.playerId]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/social");
    router.refresh();
  }

  if (loading || !me || !identity) {
    return (
      <div className="sx-app">
        <p className="sx-empty">Loading…</p>
      </div>
    );
  }

  const handle = identity.username
    ? `@${identity.username}`
    : identity.fname
      ? `Farcaster @${identity.fname}`
      : identity.fid
        ? `FID ${identity.fid}`
        : "";

  return (
    <SocialFrame name={identity.displayName} pfpUrl={identity.pfpUrl}>
      <header className="sx-self">
        <div className="sx-self-photo">
          {identity.pfpUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={identity.pfpUrl} alt="" />
          ) : (
            <span aria-hidden>{identity.displayName.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div>
          <h1>{identity.displayName}</h1>
          {handle && <p>{handle}</p>}
        </div>
      </header>

      {me.custodyChanged && (
        <p className="sx-warn">
          This FID&apos;s custody address changed on Optimism. Sign in again
          with the new custody wallet.
        </p>
      )}

      <section className="sx-block" aria-label="Recently played games">
        <h2>Recently played</h2>
        {played === null && !playedError && (
          <p className="sx-muted">Loading games…</p>
        )}
        {playedError && <p className="sx-error">{playedError}</p>}
        {played && played.length === 0 && !playedError && (
          <p className="sx-muted">No games played yet.</p>
        )}
        {played && played.length > 0 && (
          <div className="games-grid">
            {played.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                playCount={playCounts[game.id] ?? 0}
              />
            ))}
          </div>
        )}
      </section>

      <section className="sx-block" aria-label="Casts">
        <h2>Casts</h2>
        <p className="sx-muted">No casts yet.</p>
      </section>

      <div className="sx-row">
        <button type="button" className="sx-signout" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </SocialFrame>
  );
}
