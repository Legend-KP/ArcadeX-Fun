"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchLeaderboardData } from "@/lib/leaderboard-client";
import type { FidStreak } from "@/lib/social-board";
import { gameHasLeaderboard, type Game } from "@/types";

type Props = {
  games: Game[];
  playCounts: Record<string, number>;
  onOpenGames: () => void;
  onOpenLeaderboards: () => void;
};

type PlayerRow = {
  name: string;
  score: number;
  weekly: boolean;
};

const WEEK_MS = 7 * 86_400_000;

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function FidStreakCard({ onOpenGames }: { onOpenGames: () => void }) {
  const [streak, setStreak] = useState<FidStreak | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/social/streak", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json()) as { streak?: FidStreak; error?: string };
        if (!res.ok || !data.streak) {
          throw new Error(data.error || "Could not load streak.");
        }
        if (!cancelled) setStreak(data.streak);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load streak.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function checkIn() {
    if (busy || streak?.checkedInToday) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/social/streak", { method: "POST" });
      const data = (await res.json()) as { streak?: FidStreak; error?: string };
      if (!res.ok || !data.streak) {
        throw new Error(data.error || "Could not check in.");
      }
      setStreak(data.streak);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check in.");
    } finally {
      setBusy(false);
    }
  }

  const days = streak?.currentStreak ?? 0;
  const filled = Math.min(days, 7);

  return (
    <section className="board-card board-streak" aria-label="Daily streak">
      <header>
        <h2>Daily Streak</h2>
        <span>{days === 1 ? "1 day" : `${days} days`}</span>
      </header>
      <ol>
        {Array.from({ length: 7 }, (_, index) => (
          <li key={index} className={index < filled ? "is-on" : undefined}>
            <span aria-hidden>{index < filled ? "🔥" : ""}</span>
            D{index + 1}
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => void checkIn()}
        disabled={busy || streak?.checkedInToday || streak === null}
      >
        {streak?.checkedInToday ? "Checked in" : busy ? "Checking in…" : "Check in"}
      </button>
      {error && <p className="board-error">{error}</p>}
      <button type="button" className="board-streak__gift" onClick={onOpenGames}>
        <span aria-hidden>🎁</span>
        Keep playing to unlock bigger rewards
        <span aria-hidden>›</span>
      </button>
    </section>
  );
}

export function TrendingGames({
  games,
  playCounts,
  onViewAll,
}: {
  games: Game[];
  playCounts: Record<string, number>;
  onViewAll: () => void;
}) {
  const trending = [...games]
    .sort(
      (a, b) =>
        (playCounts[b.id] ?? 0) - (playCounts[a.id] ?? 0) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, 5);

  return (
    <section className="board-card" aria-label="Trending games">
      <header>
        <h2>Trending Games</h2>
        <button type="button" onClick={onViewAll}>
          View All <span aria-hidden>›</span>
        </button>
      </header>
      {trending.length === 0 ? (
        <p className="board-empty">No games yet.</p>
      ) : (
        <ol className="board-rank">
          {trending.map((game, index) => (
            <li key={game.id}>
              <span className="board-rank__n">{index + 1}</span>
              <Link href={`/game/${game.id}`}>
                <strong>{game.name}</strong>
                <small>{game.contestTask || "Arcade"}</small>
              </Link>
              <em>{formatCount(playCounts[game.id] ?? 0)}</em>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function TopPlayersCard({
  games,
  onViewAll,
}: {
  games: Game[];
  onViewAll: () => void;
}) {
  const [rows, setRows] = useState<PlayerRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ranked = games.filter((game) => gameHasLeaderboard(game)).slice(0, 8);
    Promise.all(
      ranked.map(async (game) => {
        try {
          const data = await fetchLeaderboardData(game.id);
          return data.entries ?? [];
        } catch {
          return [];
        }
      })
    ).then((batches) => {
      if (cancelled) return;
      const now = Date.now();
      const flat = batches.flat();
      const weekly = flat.filter(
        (entry) => entry.createdAt && now - entry.createdAt <= WEEK_MS
      );
      const source = weekly.length > 0 ? weekly : flat;
      const best = new Map<string, PlayerRow>();
      for (const entry of source) {
        const key = (entry.walletAddress || entry.name).toLowerCase();
        const current = best.get(key);
        if (!current || entry.score > current.score) {
          best.set(key, {
            name: entry.name,
            score: entry.score,
            weekly: weekly.length > 0,
          });
        }
      }
      setRows(
        [...best.values()].sort((a, b) => b.score - a.score).slice(0, 5)
      );
    });
    return () => {
      cancelled = true;
    };
  }, [games]);

  const weekly = rows?.some((row) => row.weekly) ?? false;

  return (
    <section className="board-card" aria-label="Top players">
      <header>
        <h2>{weekly ? "Top Players (Weekly)" : "Top Players"}</h2>
        <button type="button" onClick={onViewAll}>
          View All <span aria-hidden>›</span>
        </button>
      </header>
      {rows === null ? (
        <p className="board-empty">Loading players…</p>
      ) : rows.length === 0 ? (
        <p className="board-empty">No scores yet.</p>
      ) : (
        <ol className="board-rank">
          {rows.map((row, index) => (
            <li key={`${row.name}-${index}`}>
              <span className="board-rank__n">{index + 1}</span>
              <strong>{row.name}</strong>
              <em>{row.score.toLocaleString()}</em>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function HomeAside({
  games,
  playCounts,
  onOpenGames,
  onOpenLeaderboards,
}: Props) {
  return (
    <aside className="board-aside">
      <FidStreakCard onOpenGames={onOpenGames} />
      <TrendingGames
        games={games}
        playCounts={playCounts}
        onViewAll={onOpenGames}
      />
      <TopPlayersCard games={games} onViewAll={onOpenLeaderboards} />
    </aside>
  );
}

export function LeaderboardsPanel({
  games,
  playCounts,
}: {
  games: Game[];
  playCounts: Record<string, number>;
}) {
  const ranked = [...games].sort(
    (a, b) => (playCounts[b.id] ?? 0) - (playCounts[a.id] ?? 0)
  );

  return (
    <section className="board-card board-leaders" aria-label="Leaderboards">
      <header>
        <h2>Leaderboards</h2>
      </header>
      <p className="board-note">
        Each game keeps its own board. Open a game to see the full ranking.
      </p>
      {ranked.length === 0 ? (
        <p className="board-empty">No games yet.</p>
      ) : (
        <ol className="board-rank">
          {ranked.map((game, index) => (
            <li key={game.id}>
              <span className="board-rank__n">{index + 1}</span>
              <Link href={`/game/${game.id}`}>
                <strong>{game.name}</strong>
                <small>
                  {gameHasLeaderboard(game) ? "Open leaderboard" : "No public board"}
                </small>
              </Link>
              <em>{formatCount(playCounts[game.id] ?? 0)}</em>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
