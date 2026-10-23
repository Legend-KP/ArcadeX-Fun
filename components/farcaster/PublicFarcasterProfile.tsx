"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import GameCard from "@/components/GameCard";
import WebHeader from "@/components/WebHeader";
import SocialSidebar from "@/components/social/SocialSidebar";
import ScoreCastFeed from "@/components/social/ScoreCastFeed";
import { useSocialMe } from "@/components/social/useSocialMe";
import {
  formatSocialCount,
  socialIdentity,
} from "@/components/farcaster/social-me";
import { getGameProgress } from "@/lib/game-progress-client";
import ShareLink from "@/components/social/ShareLink";
import { profileHref } from "@/lib/farcaster/public-profile";
import { sendChallenge } from "@/lib/social-challenges-client";
import type { Game } from "@/types";

type PublicProfile = {
  playerId?: string;
  username?: string;
  displayName?: string;
  fname?: string;
  pfpUrl?: string;
  fid?: number;
  primaryWallet?: string;
};

type Lookup = {
  fid?: number | null;
  profile?: PublicProfile | null;
  neynar?: {
    fid?: number;
    username?: string;
    display_name?: string;
    pfp_url?: string;
    follower_count?: number;
    following_count?: number;
    profile?: { bio?: { text?: string } };
  } | null;
  error?: string;
};

type Props = {
  kind: "fid" | "username";
  value: string;
};

export default function PublicFarcasterProfile({ kind, value }: Props) {
  const router = useRouter();
  const { me, ready } = useSocialMe();
  const [data, setData] = useState<Lookup | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [games, setGames] = useState<Game[]>([]);
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const [played, setPlayed] = useState<Game[] | null>(null);
  const [challengeNote, setChallengeNote] = useState("");
  const [challenging, setChallenging] = useState(false);

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
  const fid = data?.fid ?? profile?.fid ?? neynar?.fid ?? null;
  const displayName =
    profile?.displayName ||
    neynar?.display_name ||
    profile?.fname ||
    profile?.username ||
    (fid ? `FID ${fid}` : "Player");
  const username = profile?.username || null;
  const fname = profile?.fname || neynar?.username || null;
  const pfpUrl = profile?.pfpUrl || neynar?.pfp_url || null;
  const bio = neynar?.profile?.bio?.text?.trim() || null;
  const followerCount =
    typeof neynar?.follower_count === "number" ? neynar.follower_count : null;
  const followingCount =
    typeof neynar?.following_count === "number" ? neynar.following_count : null;
  const handle = username
    ? `@${username}`
    : fname
      ? `Farcaster @${fname}`
      : fid
        ? `FID ${fid}`
        : "";
  const target = username || (fid ? String(fid) : "");
  const missing = data && !profile && !neynar && !fid;
  const viewer = me ? socialIdentity(me) : null;
  const isYou = Boolean(viewer?.fid && fid && viewer.fid === fid);

  useEffect(() => {
    if (!profile?.playerId) {
      setPlayed([]);
      return;
    }
    const playerId = profile.playerId;
    let cancelled = false;

    async function load() {
      const res = await fetch("/api/games", { cache: "no-store" });
      const body = (await res.json()) as {
        games?: Game[];
        playCounts?: Record<string, number>;
      };
      const list = body.games ?? [];
      if (cancelled) return;
      setGames(list);
      setPlayCounts(body.playCounts ?? {});
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
  }, [profile?.playerId]);

  async function challenge() {
    const game = games.find((item) => item.live !== false) ?? games[0];
    if (!game || !target || challenging) return;
    setChallenging(true);
    setChallengeNote("");
    const message = await sendChallenge({
      target,
      gameId: game.id,
      gameName: game.name,
      expiryHours: 24,
    });
    setChallenging(false);
    setChallengeNote(message || `Challenge sent to ${displayName}.`);
  }

  const pageHref = profileHref({
    username: username || (kind === "username" ? value : null),
    fid,
  });

  return (
    <div className="home">
      <div className="home-shell">
        <WebHeader
          profileName={viewer?.displayName}
          profileImage={viewer?.pfpUrl}
        />
        <div className="soc-body">
          <SocialSidebar
            active="profile"
            me={me}
            ready
            search={search}
            onSearchChange={(next) => {
              setSearch(next);
              if (next.trim()) {
                router.push(`/?q=${encodeURIComponent(next)}`);
              }
            }}
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
              <Link href="/">Back</Link>
            </p>
            {error && <p className="board-error">{error}</p>}
            {!data && !error && <p className="soc-note">Loading profile…</p>}
            {missing && <p className="soc-note">No profile for that search.</p>}
            {data && !missing && !error && (
              <>
                <header className="soc-profile">
                  <div className="soc-profile__photo">
                    {pfpUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={pfpUrl} alt="" />
                    ) : (
                      <span>{displayName.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div>
                    <h1>{displayName}</h1>
                    {handle && <p className="soc-profile__handle">{handle}</p>}
                    {bio && <p className="soc-profile__bio">{bio}</p>}
                    {(followerCount != null || followingCount != null) && (
                      <p className="soc-profile__stats">
                        <span>
                          <strong>{formatSocialCount(followingCount)}</strong>
                          Following
                        </span>
                        <span>
                          <strong>{formatSocialCount(followerCount)}</strong>
                          Followers
                        </span>
                      </p>
                    )}
                    {pageHref && (
                      <ShareLink
                        path={pageHref}
                        title={`${displayName} on ArcadeX`}
                        text={`Open ${displayName}'s ArcadeX profile`}
                      />
                    )}
                    {isYou ? (
                      <p className="soc-note">
                        <Link href="/profile">This is you</Link>
                      </p>
                    ) : ready && target ? (
                      <button
                        type="button"
                        className="connect-btn soc-profile__wallet"
                        disabled={challenging || games.length === 0}
                        onClick={() => void challenge()}
                      >
                        {challenging ? "Sending…" : "Challenge"}
                      </button>
                    ) : null}
                    {challengeNote && <p className="soc-note">{challengeNote}</p>}
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
                      names: [displayName, username ?? "", fname ?? ""].filter(Boolean),
                      wallet: profile?.primaryWallet,
                    }}
                  />
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
