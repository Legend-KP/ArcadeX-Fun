"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { gameHasContestLiveForSession } from "@/lib/contest-chains";
import { gameAssetCandidates, gameFallbackCandidates } from "@/lib/game-assets";
import { formatPlayCount } from "@/lib/format-play-count";
import { Game, gameIsLive } from "@/types";

interface GameCardProps {
  game: Game;
  playCount?: number;
}

export default function GameCard({ game, playCount = 0 }: GameCardProps) {
  const { chainId, ecosystem, isAuthenticated } = usePlayerProfile();
  const isLive = gameIsLive(game);
  const contestLive = gameHasContestLiveForSession(game, {
    chainId,
    ecosystem,
    requireChain: !isAuthenticated,
  });

  const thumbCandidates = useMemo(
    () => gameAssetCandidates(game, "thumbnail"),
    [game]
  );
  const logoCandidates = useMemo(
    () => gameAssetCandidates(game, "logo"),
    [game]
  );
  const fallbackCandidates = useMemo(
    () => gameFallbackCandidates(game),
    [game]
  );

  const [thumbIdx, setThumbIdx] = useState(0);
  const [logoIdx, setLogoIdx] = useState(0);
  const [fallbackIdx, setFallbackIdx] = useState(0);

  const thumbSrc = thumbCandidates[thumbIdx];
  const logoSrc = logoCandidates[logoIdx];
  const fallbackSrc = fallbackCandidates[fallbackIdx];

  const thumbContent = thumbSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbSrc}
      alt={game.name}
      className="thumb-img"
      onError={() => setThumbIdx((i) => i + 1)}
    />
  ) : logoSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoSrc}
      alt={game.name}
      className="thumb-img"
      onError={() => setLogoIdx((i) => i + 1)}
    />
  ) : fallbackSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={fallbackSrc}
      alt={game.name}
      className="thumb-img"
      onError={() => setFallbackIdx((i) => i + 1)}
    />
  ) : (
    <div className="thumb-placeholder">🎮</div>
  );

  const cardBody = (
    <>
      <div className="thumb-wrap">
        {thumbContent}
        {contestLive && (
          <span className="game-card-contest-badge">CONTEST LIVE</span>
        )}
        {!isLive && (
          <div className="coming-soon-overlay" aria-hidden>
            <span>Coming Soon</span>
          </div>
        )}
      </div>

      <div className="card-info">
        <p className="card-title">{game.name}</p>
        <p className="card-plays">{formatPlayCount(playCount)} plays</p>
      </div>
    </>
  );

  if (!isLive) {
    return (
      <div
        className={[
          "game-card",
          "game-card--coming-soon",
          contestLive && "game-card--contest-live",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={`${game.name} — coming soon`}
      >
        {cardBody}
      </div>
    );
  }

  return (
    <Link
      href={`/game/${game.id}`}
      className={[
        "game-card",
        contestLive && "game-card--contest-live",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {cardBody}
    </Link>
  );
}
