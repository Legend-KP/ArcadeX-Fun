"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Game } from "@/types";
import GameCard from "@/components/GameCard";
import LoadingScreen from "@/components/LoadingScreen";
import HomeAside, { LeaderboardsPanel } from "@/components/social/HomeAside";
import HomeFeed from "@/components/social/HomeFeed";
import PostComposer from "@/components/social/PostComposer";
import NotificationsPanel from "@/components/social/NotificationsPanel";
import SocialSidebar, {
  type SocialSection,
} from "@/components/social/SocialSidebar";
import { socialIdentity } from "@/components/farcaster/social-me";
import { useSocialMe } from "@/components/social/useSocialMe";
import type { TextPost } from "@/lib/social-board";
import WebHeader from "@/components/WebHeader";

type FilterTab = "all" | "continue" | "new";
type HomeSection = Exclude<SocialSection, "profile">;

function sectionFromQuery(value: string | null): HomeSection {
  if (
    value === "games" ||
    value === "notifications" ||
    value === "challenges" ||
    value === "leaderboards"
  ) {
    return value;
  }
  return "home";
}

export default function HomePage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <HomePageInner />
    </Suspense>
  );
}

function HomePageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { me, ready, loading: socialLoading } = useSocialMe();
  const [games, setGames] = useState<Game[]>([]);
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [section, setSection] = useState<HomeSection>(
    sectionFromQuery(params.get("section"))
  );
  const [filter, setFilter] = useState<FilterTab>("all");
  const [latestPost, setLatestPost] = useState<TextPost | null>(null);

  useEffect(() => {
    if (!socialLoading && !ready) router.replace("/social");
  }, [socialLoading, ready, router]);

  useEffect(() => {
    let cancelled = false;

    async function loadGames() {
      setLoading(true);
      setError("");

      try {
        const res = await fetch("/api/games", { cache: "no-store" });
        const text = await res.text();
        let data: {
          games?: Game[];
          playCounts?: Record<string, number>;
          error?: string;
        };
        try {
          data = JSON.parse(text) as {
            games?: Game[];
            playCounts?: Record<string, number>;
            error?: string;
          };
        } catch {
          throw new Error(
            "Server returned an invalid response. Check Cloudflare Worker secrets and redeploy."
          );
        }

        if (!res.ok) {
          throw new Error(data.error ?? "Could not load games.");
        }

        if (cancelled) return;

        setGames(data.games ?? []);
        setPlayCounts(data.playCounts ?? {});
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Could not load games. Check your Firebase configuration."
        );
        setLoading(false);
      }
    }

    loadGames();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredGames = useMemo(() => {
    let list = [...games];

    const query = search.trim().toLowerCase();
    if (query) {
      list = list.filter((game) => game.name.toLowerCase().includes(query));
    }

    if (filter === "new") {
      list = list.sort((a, b) => b.createdAt - a.createdAt);
    } else if (filter === "continue") {
      list = list.sort(
        (a, b) => (playCounts[b.id] ?? 0) - (playCounts[a.id] ?? 0)
      );
    }

    return list;
  }, [games, search, filter, playCounts]);

  if (loading || socialLoading || !ready || !me) {
    return <LoadingScreen />;
  }

  const identity = socialIdentity(me);

  return (
    <div className="home">
      <div className="home-shell home-shell--board">
        <WebHeader
          profileName={identity.displayName}
          profileImage={identity.pfpUrl}
          post={<PostComposer me={me} onPosted={setLatestPost} />}
        />

        <div className="board">
          <SocialSidebar
            active={section}
            me={me}
            ready={ready}
            onSelect={setSection}
            onExplore={() => setSection("games")}
            search={search}
            onSearchChange={setSearch}
          />
          <div className="board__main">
            {section === "home" && (
              <HomeFeed games={games} search={search} posted={latestPost} />
            )}

            {(section === "notifications" || section === "challenges") && (
              <NotificationsPanel
                games={games}
                me={me}
                ready={ready}
                title={section === "challenges" ? "Challenge" : "Notifications"}
              />
            )}

            {section === "leaderboards" && (
              <LeaderboardsPanel games={games} playCounts={playCounts} />
            )}

            {section === "games" && (
              <>
                <div className="filter-bar">
                  <span className="filter-bar__label">For you</span>
                  <div className="filter-bar__pills">
                    <button
                      type="button"
                      className={`filter-pill${filter === "all" ? " is-active" : ""}`}
                      onClick={() => setFilter("all")}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`filter-pill${filter === "continue" ? " is-active" : ""}`}
                      onClick={() => setFilter("continue")}
                    >
                      Continue playing
                    </button>
                    <button
                      type="button"
                      className={`filter-pill${filter === "new" ? " is-active" : ""}`}
                      onClick={() => setFilter("new")}
                    >
                      New
                    </button>
                  </div>
                </div>

                {error ? (
                  <p className="no-games">{error}</p>
                ) : filteredGames.length === 0 ? (
                  <p className="no-games">
                    {search.trim()
                      ? "No games match your search."
                      : "No games yet. Check back soon!"}
                  </p>
                ) : (
                  <div className="games-grid">
                    {filteredGames.map((game) => (
                      <GameCard
                        key={game.id}
                        game={game}
                        playCount={playCounts[game.id] ?? 0}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          {section === "home" && (
            <HomeAside
              games={games}
              playCounts={playCounts}
              onOpenGames={() => setSection("games")}
              onOpenLeaderboards={() => setSection("leaderboards")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
