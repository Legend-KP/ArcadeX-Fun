"use client";

import { useEffect, useMemo, useState } from "react";
import { Game } from "@/types";
import GameCard from "@/components/GameCard";
import LoadingScreen from "@/components/LoadingScreen";
import WebHeader from "@/components/WebHeader";

type NavTab = "home" | "browse";
type FilterTab = "all" | "continue" | "new";

export default function HomePage() {
  const [games, setGames] = useState<Game[]>([]);
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [navTab, setNavTab] = useState<NavTab>("browse");
  const [filter, setFilter] = useState<FilterTab>("all");

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

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <div className="home">
      <div className="home-shell">
        <WebHeader search={search} onSearchChange={setSearch} />

        <nav className="web-nav" aria-label="Main">
          <button
            type="button"
            className={`web-nav__tab${navTab === "home" ? " is-active" : ""}`}
            onClick={() => setNavTab("home")}
          >
            Home
          </button>
          
        </nav>

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
            {search.trim() ? "No games match your search." : "No games yet. Check back soon!"}
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
      </div>
    </div>
  );
}
