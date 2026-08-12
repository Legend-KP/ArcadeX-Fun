"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import GameTutorialModal from "@/components/GameTutorialModal";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { gameHasContestLiveForSession } from "@/lib/contest-chains";
import { gameAssetCandidates, gameFallbackCandidates } from "@/lib/game-assets";
import {
  getTutorialImageUrl,
  hasSeenTutorial,
  hasTutorial,
  markTutorialSeen,
} from "@/lib/game-tutorial";
import { Game, gameHasLeaderboard } from "@/types";

interface GameMenuProps {
  game: Game;
  onStart: () => void | Promise<void>;
  onLeaderboard: () => void;
  sparkError?: string;
  spending?: boolean;
}

export default function GameMenu({
  game,
  onStart,
  onLeaderboard,
  sparkError = "",
  spending = false,
}: GameMenuProps) {
  const router = useRouter();
  const { chainId, ecosystem } = usePlayerProfile();
  const contestLive = gameHasContestLiveForSession(game, { chainId, ecosystem });
  const tutorialUrl = useMemo(() => getTutorialImageUrl(game), [game]);
  const showTutorialButton = hasTutorial(game);

  const [tutorialOpen, setTutorialOpen] = useState(false);

  useEffect(() => {
    if (!tutorialUrl) return;
    if (!hasSeenTutorial(game.id)) {
      setTutorialOpen(true);
    }
  }, [game.id, tutorialUrl]);

  const dismissTutorial = () => {
    markTutorialSeen(game.id);
    setTutorialOpen(false);
  };

  const thumbCandidates = useMemo(
    () => gameAssetCandidates(game, "thumbnail"),
    [game]
  );
  const logoCandidates = useMemo(() => {
    const logos = gameAssetCandidates(game, "logo");
    const seen = new Set(logos);
    const thumbs = gameAssetCandidates(game, "thumbnail").filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
    return [...logos, ...thumbs];
  }, [game]);
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

  return (
    <>
      <div className="game-menu">
        {contestLive && (
          <div className="game-menu-contest-stripe" aria-hidden>
            <div className="game-menu-contest-stripe__track">
              {Array.from({ length: 16 }).map((_, i) => (
                <span key={`contest-stripe-a-${i}`}>Contest is Live</span>
              ))}
              {Array.from({ length: 16 }).map((_, i) => (
                <span key={`contest-stripe-b-${i}`}>Contest is Live</span>
              ))}
            </div>
          </div>
        )}

        <div className="game-menu-bg">
          {thumbSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbSrc}
              alt=""
              className="game-menu-bg-img"
              onError={() => setThumbIdx((i) => i + 1)}
            />
          ) : (
            <div className="game-menu-bg-fallback" />
          )}
          <div className="game-menu-bg-overlay" />
        </div>

        <div className="game-menu-grid" aria-hidden />

        <div className="game-menu-topbar">
          <button
            type="button"
            className="game-menu-circle-btn"
            aria-label="Back to home"
            onClick={() => router.push("/")}
          >
            ←
          </button>
          {showTutorialButton && (
            <button
              type="button"
              className="game-menu-circle-btn game-menu-circle-btn--info"
              aria-label="How to play"
              onClick={() => setTutorialOpen(true)}
            >
              ⓘ
            </button>
          )}
        </div>

        <div className="game-menu-stack">
          <div className="game-menu-card">
            <div className="game-menu-logo-wrap">
              {logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoSrc}
                  alt={game.name}
                  className="game-menu-logo"
                  onError={() => setLogoIdx((i) => i + 1)}
                />
              ) : fallbackSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fallbackSrc}
                  alt={game.name}
                  className="game-menu-logo"
                  onError={() => setFallbackIdx((i) => i + 1)}
                />
              ) : (
                <span className="game-menu-logo-fallback">🎮</span>
              )}
            </div>
          </div>

          {sparkError ? (
            <p className="game-menu-spark-error" role="alert">
              {sparkError}
            </p>
          ) : null}

          <div className="game-menu-actions">
            <button
              type="button"
              className="game-menu-btn game-menu-btn--start"
              onClick={() => void onStart()}
              disabled={spending}
            >
              <span className="game-menu-btn__icon" aria-hidden>
                ▶
              </span>
              {spending ? "Starting…" : "Start Game"}
            </button>
            {gameHasLeaderboard(game) && (
              <button
                type="button"
                className="game-menu-btn game-menu-btn--leaderboard"
                onClick={onLeaderboard}
              >
                <span className="game-menu-btn__icon game-menu-btn__icon--trophy" aria-hidden>
                  🏆
                </span>
                Leaderboard
              </button>
            )}
          </div>
        </div>
      </div>

      {tutorialUrl && (
        <GameTutorialModal
          open={tutorialOpen}
          imageUrl={tutorialUrl}
          gameName={game.name}
          onDismiss={dismissTutorial}
        />
      )}
    </>
  );
}
