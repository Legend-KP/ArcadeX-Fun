"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { gameHasContestLiveForSession } from "@/lib/contest-chains";
import {
  gameAssetCandidates,
  gameFallbackCandidates,
  gameVideoSources,
} from "@/lib/game-assets";
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
  const thumbRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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
  const videoSources = useMemo(() => gameVideoSources(game), [game]);

  const [thumbIdx, setThumbIdx] = useState(0);
  const [logoIdx, setLogoIdx] = useState(0);
  const [fallbackIdx, setFallbackIdx] = useState(0);
  const [inView, setInView] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  const thumbSrc = thumbCandidates[thumbIdx];
  const logoSrc = logoCandidates[logoIdx];
  const fallbackSrc = fallbackCandidates[fallbackIdx];
  const posterSrc = thumbSrc || videoSources?.poster;
  const showVideo =
    isLive && !!videoSources && !videoFailed && !reduceMotion && inView;

  useEffect(() => {
    setVideoFailed(false);
    setVideoPlaying(false);
    setInView(false);
  }, [game.id]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!isLive || !videoSources || videoFailed || reduceMotion) return;
    const node = thumbRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "100px", threshold: 0.15 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isLive, videoSources, videoFailed, reduceMotion]);

  useEffect(() => {
    if (!showVideo) setVideoPlaying(false);
  }, [showVideo]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !showVideo) return;

    video.muted = true;
    const attempt = video.play();
    if (!attempt) return;

    attempt.catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "AbortError") return;
      setVideoFailed(true);
    });

    return () => {
      video.pause();
    };
  }, [showVideo]);

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
      <div className="thumb-wrap" ref={thumbRef}>
        {thumbContent}
        {showVideo && videoSources && (
          <video
            ref={videoRef}
            className={videoPlaying ? "thumb-video is-playing" : "thumb-video"}
            muted
            playsInline
            loop
            preload="metadata"
            poster={posterSrc}
            aria-hidden
            onPlaying={() => setVideoPlaying(true)}
            onError={() => setVideoFailed(true)}
          >
            <source src={videoSources.webm} type="video/webm" />
            <source src={videoSources.mp4} type="video/mp4" />
          </video>
        )}
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
