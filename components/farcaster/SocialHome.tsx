"use client";

import { useEffect, useState } from "react";
import GameCard from "@/components/GameCard";
import SocialFrame from "@/components/farcaster/SocialFrame";
import { socialIdentity, type SocialMe } from "@/components/farcaster/social-me";
import type { Game } from "@/types";

type Section = "home" | "games";

type Props = {
  me: SocialMe;
};

export default function SocialHome({ me }: Props) {
  const identity = socialIdentity(me);
  const [section, setSection] = useState<Section>("home");
  const [games, setGames] = useState<Game[] | null>(null);
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const [gamesError, setGamesError] = useState("");
  const [gamesLoading, setGamesLoading] = useState(false);

  useEffect(() => {
    if (section !== "games" || games) return;

    let cancelled = false;
    setGamesLoading(true);
    setGamesError("");

    fetch("/api/games", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json()) as {
          games?: Game[];
          playCounts?: Record<string, number>;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Could not load games.");
        if (cancelled) return;
        setGames(data.games ?? []);
        setPlayCounts(data.playCounts ?? {});
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setGamesError(
          err instanceof Error ? err.message : "Could not load games."
        );
        setGames([]);
      })
      .finally(() => {
        if (!cancelled) setGamesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [section, games]);

  return (
    <SocialFrame name={identity.displayName} pfpUrl={identity.pfpUrl}>
      <nav className="sx-sections" aria-label="Sections">
        <button
          type="button"
          className={section === "home" ? "is-on" : undefined}
          aria-current={section === "home" ? "page" : undefined}
          onClick={() => setSection("home")}
        >
          Home
        </button>
        <button
          type="button"
          className={section === "games" ? "is-on" : undefined}
          aria-current={section === "games" ? "page" : undefined}
          onClick={() => setSection("games")}
        >
          Games
        </button>
      </nav>

      {section === "home" && (
        <section className="sx-empty" aria-label="Home">
          <h1>Home</h1>
          <p>No casts yet. Posts will show up here once people start sharing.</p>
        </section>
      )}

      {section === "games" && (
        <section aria-label="Games">
          {gamesLoading && <p className="sx-empty">Loading games…</p>}
          {gamesError && <p className="sx-error">{gamesError}</p>}
          {!gamesLoading && !gamesError && games?.length === 0 && (
            <p className="sx-empty">No games yet.</p>
          )}
          {!gamesLoading && games && games.length > 0 && (
            <div className="games-grid">
              {games.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  playCount={playCounts[game.id] ?? 0}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </SocialFrame>
  );
}
