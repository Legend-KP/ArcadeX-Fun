"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import GameCard from "@/components/GameCard";
import WebHeader from "@/components/WebHeader";
import SocialSidebar from "@/components/social/SocialSidebar";
import PostComposer from "@/components/social/PostComposer";
import ScoreCastFeed from "@/components/social/ScoreCastFeed";
import { useSocialMe } from "@/components/social/useSocialMe";
import {
  formatSocialCount,
  socialIdentity,
} from "@/components/farcaster/social-me";
import { getGameProgress } from "@/lib/game-progress-client";
import type { Game } from "@/types";

export default function SocialProfilePage() {
  const router = useRouter();
  const { me, loading, ready } = useSocialMe();
  const [search, setSearch] = useState("");
  const [games, setGames] = useState<Game[]>([]);
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const [played, setPlayed] = useState<Game[] | null>(null);

  useEffect(() => {
    if (!loading && !ready) router.replace("/social");
  }, [loading, ready, router]);

  useEffect(() => {
    if (!me || !ready) return;
    const playerId = me.playerId || me.profile?.playerId;
    let cancelled = false;

    async function load() {
      const res = await fetch("/api/games", { cache: "no-store" });
      const data = (await res.json()) as {
        games?: Game[];
        playCounts?: Record<string, number>;
      };
      const list = data.games ?? [];
      if (cancelled) return;
      setGames(list);
      setPlayCounts(data.playCounts ?? {});
      if (!playerId) {
        setPlayed([]);
        return;
      }
      const settled = await Promise.all(
        list.map(async (game) => {
          try {
            const progress = await getGameProgress(game.id, playerId);
            const score = progress.progress.score ?? 0;
            const level = progress.progress.level ?? 0;
            return score > 0 || level > 0 ? game : null;
          } catch {
            return null;
          }
        })
      );
      if (!cancelled) {
        setPlayed(settled.filter((game): game is Game => Boolean(game)));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [me, ready]);

  if (loading || !ready || !me) {
    return <p className="no-games">Loading…</p>;
  }

  const identity = socialIdentity(me);
  const handle = identity.username
    ? `@${identity.username}`
    : identity.fname
      ? `Farcaster @${identity.fname}`
      : identity.fid
        ? `FID ${identity.fid}`
        : "";

  return (
    <div className="home">
      <div className="home-shell">
        <WebHeader
          profileName={identity.displayName}
          profileImage={identity.pfpUrl}
          post={<PostComposer me={me} onPosted={() => undefined} />}
        />
        <div className="soc-body">
          <SocialSidebar
            active="profile"
            me={me}
            ready
            search={search}
            onSearchChange={(value) => {
              setSearch(value);
              if (value.trim()) {
                router.push(`/?section=games&q=${encodeURIComponent(value)}`);
              }
            }}
            onSelect={(section) => {
              router.push(section === "home" ? "/" : `/?section=${section}`);
            }}
          />
          <div className="soc-main">
            <header className="soc-profile">
              <div className="soc-profile__photo">
                {identity.pfpUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={identity.pfpUrl} alt="" />
                ) : (
                  <span>{identity.displayName.charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div>
                <h1>{identity.displayName}</h1>
                {handle && <p className="soc-profile__handle">{handle}</p>}
                {identity.bio && <p className="soc-profile__bio">{identity.bio}</p>}
                {(identity.followerCount != null ||
                  identity.followingCount != null) && (
                  <p className="soc-profile__stats">
                    <span>
                      <strong>{formatSocialCount(identity.followingCount)}</strong>
                      Following
                    </span>
                    <span>
                      <strong>{formatSocialCount(identity.followerCount)}</strong>
                      Followers
                    </span>
                  </p>
                )}
              </div>
            </header>

            <section className="soc-block">
              <h2>Recently played</h2>
              {played === null && <p className="soc-note">Loading games…</p>}
              {played && played.length === 0 && (
                <p className="soc-note">No games played yet.</p>
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

            <section className="soc-block">
              <h2>Casts</h2>
              <ScoreCastFeed
                games={games}
                mine={{
                  names: [
                    identity.displayName,
                    identity.username ?? "",
                    identity.fname ?? "",
                  ].filter(Boolean),
                  wallet: me.address,
                }}
              />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
