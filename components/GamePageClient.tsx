"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSignMessage } from "wagmi";
import { Game, gameHasLeaderboard, gameIsLive } from "@/types";
import GameClient from "@/components/GameClient";
import GameMenu from "@/components/GameMenu";
import Leaderboard, { LeaderboardMode } from "@/components/Leaderboard";
import LoadingScreen from "@/components/LoadingScreen";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { useSparks } from "@/components/SparkProvider";
import { SparkClientError } from "@/lib/spark-client";
import { formatSparkCountdown } from "@/lib/spark";
import { shouldRequireBaseTxHubSignIn } from "@/lib/arcadex-tx-hub";
import { signInOnArcadeXTxHub } from "@/lib/arcadex-tx-hub-client";
import { verifyBasePlaySignIn } from "@/lib/arcadex-tx-hub-api";
import { isVaraTxHubConfigured } from "@/lib/vara-tx-hub";
import { signInOnVaraTxHub } from "@/lib/vara-tx-hub-client";
import { verifyVaraPlaySignIn } from "@/lib/vara-tx-hub-api";
import { shouldRequireAvalanchePlayGate } from "@/lib/avalanche-play-gate";
import { signAvalanchePlayIntent } from "@/lib/avalanche-play-gate-client";

export default function GamePageClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const {
    walletAddress,
    isAuthenticated,
    openConnect,
    ensureWalletReady,
    playerId,
    playerName,
    ecosystem,
    chainId,
  } = usePlayerProfile();
  const { sparks, spendForGame } = useSparks();
  const { signMessageAsync } = useSignMessage();
  const [game, setGame] = useState<Game | null>(null);
  const [started, setStarted] = useState(false);
  const [playSessionId, setPlaySessionId] = useState<string | null>(null);
  const [lbOpen, setLbOpen] = useState(false);
  const [lbMode, setLbMode] = useState<LeaderboardMode>("default");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sparkError, setSparkError] = useState("");
  const [spending, setSpending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadGame() {
      try {
        const res = await fetch(`/api/games/${id}`, { cache: "no-store" });
        const data = (await res.json()) as { game?: Game; error?: string };

        if (!res.ok) {
          throw new Error(data.error ?? "Game not found.");
        }

        if (!cancelled) {
          setGame(data.game ?? null);
          if (data.game && gameIsLive(data.game)) {
            fetch(`/api/games/${id}/play`, { method: "POST" }).catch(() => {
              // Play tracking is best-effort
            });
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Game not found.");
          setGame(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadGame();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <LoadingScreen message="Loading game" />;
  }

  if (!game) {
    return (
      <div className="loading-screen">
        <p className="loading-screen__text">{error || "Game not found."}</p>
      </div>
    );
  }

  if (!gameIsLive(game)) {
    return (
      <div className="coming-soon-screen">
        <p className="coming-soon-screen__title">Coming Soon</p>
        <p className="coming-soon-screen__subtitle">
          {game.name} is not available yet.
        </p>
        <button
          type="button"
          className="game-menu-btn game-menu-btn--back"
          onClick={() => router.push("/")}
        >
          Back
        </button>
      </div>
    );
  }

  const handleStart = async () => {
    setSparkError("");

    if (!walletAddress || !isAuthenticated) {
      setSparkError("Connect your wallet to play.");
      openConnect();
      return;
    }

    const walletReady = await ensureWalletReady();
    if (!walletReady) {
      setSparkError("Reconnect your wallet to play.");
      return;
    }

    if (!sparks.hasInfinite && sparks.available === 0) {
      setSparkError(
        `No Sparks available. Next Spark in ${formatSparkCountdown(sparks.timeToNextMs)}.`
      );
      return;
    }

    setSpending(true);
    try {
      let playGate: { message: string; signature: string } | undefined;

      if (ecosystem === "vara") {
        if (!isVaraTxHubConfigured()) {
          throw new Error(
            "Vara TxHub is missing from this build. Set NEXT_PUBLIC_VARA_ARCADEX_TX_HUB_PROGRAM on Cloudflare and redeploy (NEXT_PUBLIC_ vars are baked at build time)."
          );
        }
        setSparkError("Approve free play sign-in in your wallet…");
        const txHash = await signInOnVaraTxHub({
          fromAddress: walletAddress,
          gameId: game.id,
          onStatus: (message) => setSparkError(message),
        });
        setSparkError("Confirming sign-in…");
        await verifyVaraPlaySignIn({ txHash, gameId: game.id });
        setSparkError("");
      } else if (shouldRequireBaseTxHubSignIn({ ecosystem, chainId })) {
        setSparkError("Approve free play sign-in in your wallet…");
        const txHash = await signInOnArcadeXTxHub({
          fromAddress: walletAddress,
          gameId: game.id,
          onStatus: (message) => setSparkError(message),
        });
        setSparkError("Confirming sign-in…");
        await verifyBasePlaySignIn({ txHash, gameId: game.id });
        setSparkError("");
      } else if (shouldRequireAvalanchePlayGate({ ecosystem, chainId })) {
        setSparkError("Sign play intent in your wallet…");
        playGate = await signAvalanchePlayIntent({
          gameId: game.id,
          address: walletAddress,
          chainId: chainId ?? undefined,
          signMessageAsync,
        });
        setSparkError("");
      }

      const { playSessionId: sessionId } = await spendForGame({
        gameId: game.id,
        playGate,
      });
      setPlaySessionId(sessionId);
      setStarted(true);
    } catch (err) {
      if (err instanceof SparkClientError && err.code === "NO_SPARKS") {
        setSparkError(
          `No Sparks available. Next Spark in ${formatSparkCountdown(sparks.timeToNextMs)}.`
        );
      } else {
        setSparkError(
          err instanceof Error ? err.message : "Could not start game."
        );
      }
    } finally {
      setSpending(false);
    }
  };

  const openLeaderboard = (mode: LeaderboardMode = "default") => {
    setLbMode(mode);
    setLbOpen(true);
  };

  return (
    <>
      {!started || !playSessionId ? (
        <GameMenu
          game={game}
          onStart={handleStart}
          onLeaderboard={() => openLeaderboard("default")}
          sparkError={sparkError}
          spending={spending}
        />
      ) : (
        <GameClient
          game={game}
          playSessionId={playSessionId}
          onScoreSubmitted={() => openLeaderboard("postSubmit")}
        />
      )}
      {gameHasLeaderboard(game) && (
        <Leaderboard
          gameId={game.id}
          gameName={game.name}
          open={lbOpen}
          mode={lbMode}
          walletAddress={walletAddress ?? undefined}
          playerName={playerName ?? undefined}
          playerId={playerId ?? undefined}
          chainId={chainId}
          onClose={() => {
            setLbOpen(false);
            setLbMode("default");
          }}
        />
      )}
    </>
  );
}
