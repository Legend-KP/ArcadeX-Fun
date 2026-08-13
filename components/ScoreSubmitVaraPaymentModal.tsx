"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { submitPaidScore } from "@/lib/leaderboard-client";
import { isPaymentStillConfirmingError } from "@/lib/payment-tx-verify";
import { formatScoreSubmitPrice } from "@/lib/score-submit";
import {
  clearPendingScoreSubmitTx,
  readPendingScoreSubmitTx,
  savePendingScoreSubmitTx,
} from "@/lib/score-submit-pending-tx";
import { SHOP_TOKEN_DECIMALS } from "@/lib/shop";
import {
  VARA_SHOP_PAYMENT_TOKENS,
  type VaraShopPaymentToken,
} from "@/lib/shop-vara";
import { fetchVaraVftBalances } from "@/lib/vara-shop-client";
import {
  isVaraPaymentProgramConfigured,
  varaPaymentFee,
} from "@/lib/vara-payment";
import { VARA_CHAIN_ID } from "@/lib/vara-rewards";

interface ScoreSubmitVaraPaymentModalProps {
  open: boolean;
  gameId: string;
  score: number;
  playerName: string;
  walletAddress: string;
  playSessionId: string;
  /** When true, paid score also counts on the live contest board. */
  contestLive?: boolean;
  onClose: () => void;
  onSuccess: (submittedBest: number) => void;
}

type PaymentStep = "token" | "paying" | "confirming";

function formatTokenBalance(balance: bigint, decimals: number): string {
  const scale = 10 ** decimals;
  const value = Number(balance) / scale;
  if (!Number.isFinite(value)) return "0";
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

async function confirmScoreSubmitWithRetries(params: {
  gameId: string;
  score: number;
  walletAddress: string;
  playerName: string;
  txHash: string;
  tokenAddress: string;
  playSessionId: string;
}): Promise<number> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500 + attempt * 400));
    }
    try {
      const { submittedBest } = await submitPaidScore(params.gameId, {
        score: params.score,
        walletAddress: params.walletAddress,
        txHash: params.txHash,
        name: params.playerName,
        tokenAddress: params.tokenAddress,
        ecosystem: "vara",
        chainId: VARA_CHAIN_ID,
        playSessionId: params.playSessionId,
      });
      clearPendingScoreSubmitTx();
      return submittedBest;
    } catch (err) {
      lastError = err;
      if (isPaymentStillConfirmingError(err)) continue;
      const msg = err instanceof Error ? err.message.toLowerCase() : "";
      if (
        msg.includes("network") ||
        msg.includes("failed to fetch") ||
        msg.includes("rate limit")
      ) {
        continue;
      }
      if (attempt >= 1) throw err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not confirm payment yet. Tap Confirm submit to retry.");
}

export default function ScoreSubmitVaraPaymentModal({
  open,
  gameId,
  score,
  playerName,
  walletAddress,
  playSessionId,
  contestLive = false,
  onClose,
  onSuccess,
}: ScoreSubmitVaraPaymentModalProps) {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<PaymentStep>("token");
  const [selectedToken, setSelectedToken] = useState<VaraShopPaymentToken | null>(
    null
  );
  const [balances, setBalances] = useState<
    Record<string, { balance: bigint; decimals: number }>
  >({});
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [txHash, setTxHash] = useState<string | undefined>();

  const programConfigured = isVaraPaymentProgramConfigured("score-submit");
  const requiredAmount = varaPaymentFee("score-submit");

  const tokenOptions = useMemo(() => {
    return VARA_SHOP_PAYMENT_TOKENS.map((token) => {
      const entry = balances[token.id];
      const decimals = entry?.decimals ?? SHOP_TOKEN_DECIMALS;
      const balance = entry?.balance ?? BigInt(0);
      const sufficient = balance >= requiredAmount;

      return {
        token,
        balance,
        decimals,
        requiredAmount,
        sufficient,
        balanceLabel: formatTokenBalance(balance, decimals),
      };
    });
  }, [balances, requiredAmount]);

  const loadBalances = useCallback(async () => {
    if (!walletAddress) return;

    setBalancesLoading(true);
    setError("");

    try {
      const nextBalances = await fetchVaraVftBalances(walletAddress);
      setBalances(nextBalances);
    } catch (err) {
      setBalances({});
      setError(
        err instanceof Error
          ? err.message
          : "Could not load Vara token balances."
      );
    } finally {
      setBalancesLoading(false);
    }
  }, [walletAddress]);

  const confirmSubmit = useCallback(
    async (hash: string, token: VaraShopPaymentToken) => {
      setStep("confirming");
      setBusy(true);
      setError("");
      setStatus("Submitting score…");
      setTxHash(hash);

      savePendingScoreSubmitTx({
        gameId,
        score,
        walletAddress,
        txHash: hash,
        tokenAddress: token.programId,
        chainId: VARA_CHAIN_ID,
        ecosystem: "vara",
        playerName,
        savedAt: Date.now(),
      });

      try {
        const submittedBest = await confirmScoreSubmitWithRetries({
          gameId,
          score,
          walletAddress,
          playerName,
          txHash: hash,
          tokenAddress: token.programId,
          playSessionId,
        });
        onSuccess(submittedBest);
        onClose();
      } catch (err) {
        setError(
          isPaymentStillConfirmingError(err)
            ? "Payment submitted on Vara. Confirmation is still catching up — tap Confirm submit (do not pay again)."
            : err instanceof Error
              ? err.message
              : "Could not submit score."
        );
        setStatus("");
        setStep("token");
      } finally {
        setBusy(false);
      }
    },
    [gameId, score, walletAddress, playerName, playSessionId, onSuccess, onClose]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setStep("token");
      setSelectedToken(null);
      setBusy(false);
      setError("");
      setStatus("");
      setTxHash(undefined);
      return;
    }

    if (!programConfigured) {
      setError(
        "Score submit program is not configured. Redeploy with NEXT_PUBLIC_VARA_SCORE_SUBMIT_PROGRAM."
      );
    }

    const pending = readPendingScoreSubmitTx(gameId, walletAddress);
    if (pending?.txHash) {
      setTxHash(pending.txHash);
      const match = VARA_SHOP_PAYMENT_TOKENS.find(
        (t) => t.programId.toLowerCase() === pending.tokenAddress.toLowerCase()
      );
      if (match) setSelectedToken(match);
    }

    void loadBalances();
  }, [open, loadBalances, programConfigured, gameId, walletAddress]);

  const handlePay = useCallback(
    async (token?: VaraShopPaymentToken) => {
      const payToken = token ?? selectedToken;
      if (!payToken || !walletAddress) return;

      if (!programConfigured) {
        setError(
          "Score submit program is not configured. Redeploy the app with NEXT_PUBLIC_VARA_SCORE_SUBMIT_PROGRAM."
        );
        return;
      }

      const option = tokenOptions.find((entry) => entry.token.id === payToken.id);
      if (!option?.sufficient) {
        setError(`Not enough ${payToken.symbol} for this submission.`);
        return;
      }

      setSelectedToken(payToken);
      setBusy(true);
      setError("");
      setStatus("Starting payment…");
      setStep("paying");

      try {
        const { payVaraPaymentProgram } = await import(
          "@/lib/vara-payment-client"
        );
        const { payTxHash } = await payVaraPaymentProgram({
          kind: "score-submit",
          token: payToken.id,
          fromAddress: walletAddress,
          onStatus: (msg) => setStatus(msg),
        });

        await confirmSubmit(payTxHash, payToken);
      } catch (err) {
        setStep("token");
        setStatus("");
        setError(
          err instanceof Error
            ? err.message || "Payment was cancelled or failed."
            : typeof err === "string"
              ? err
              : "Payment was cancelled or failed."
        );
      } finally {
        setBusy(false);
      }
    },
    [
      selectedToken,
      walletAddress,
      programConfigured,
      tokenOptions,
      confirmSubmit,
    ]
  );

  const handleConfirmPendingTx = useCallback(async () => {
    if (!selectedToken || !txHash) return;
    await confirmSubmit(txHash, selectedToken);
  }, [selectedToken, txHash, confirmSubmit]);

  const handleTokenSelect = useCallback(
    (token: VaraShopPaymentToken, sufficient: boolean) => {
      if (!sufficient || busy) return;
      setSelectedToken(token);
      setError("");
    },
    [busy]
  );

  if (!open || !mounted) return null;

  const showTokenStep = step === "token";
  const payBtnClass = contestLive
    ? "spark-shop-payment__primary spark-shop-payment__primary--contest-live"
    : "spark-shop-payment__primary spark-shop-payment__primary--contest-off";

  const modal = (
    <div
      className="spark-shop-payment-backdrop"
      role="presentation"
      onClick={busy ? undefined : onClose}
    >
      <div
        className={[
          "spark-shop-payment",
          contestLive && "spark-shop-payment--contest",
        ]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-submit-vara-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="spark-shop-payment__body">
          <button
            type="button"
            className="spark-panel__close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ✕
          </button>

          {contestLive ? (
            <div className="spark-shop-payment__contest-badge" aria-live="polite">
              <span className="lb-contest-live-dot" aria-hidden />
              CONTEST LIVE
            </div>
          ) : null}

          <h2 id="score-submit-vara-title" className="spark-panel__title">
            Submit score to enter Contest
          </h2>
          <p className="spark-shop-payment__score">{score.toLocaleString()}</p>
          <p className="spark-shop-payment__price">
            Pay {formatScoreSubmitPrice()} in WUSDC/WUSDT on Vara
          </p>
          <p className="spark-shop-payment__desc">
            {contestLive ? (
              <>
                Your score will count on the <strong>contest board</strong> and
                the all-time leaderboard after payment confirms.
              </>
            ) : (
              <>
                Your score will appear on the all-time public leaderboard after
                payment confirms.
              </>
            )}
          </p>

          {showTokenStep && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                Select a token, then tap Pay & Submit. SubWallet will ask you to
                Approve, then Pay.
              </p>
              {balancesLoading ? (
                <p className="spark-shop-payment__hint">Loading balances…</p>
              ) : (
                <div className="spark-shop-payment__tokens">
                  {tokenOptions.map((option) => (
                    <button
                      key={option.token.id}
                      type="button"
                      className={`spark-shop-payment__token${
                        option.sufficient ? "" : " is-disabled"
                      }${
                        selectedToken?.id === option.token.id
                          ? " is-selected"
                          : ""
                      }`}
                      disabled={!option.sufficient || busy}
                      onClick={() =>
                        handleTokenSelect(option.token, option.sufficient)
                      }
                    >
                      <span className="spark-shop-payment__token-name">
                        {option.token.symbol}
                      </span>
                      <span className="spark-shop-payment__token-balance">
                        {option.balanceLabel}
                      </span>
                      {!option.sufficient && (
                        <span className="spark-shop-payment__token-note">
                          Insufficient
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {(step === "paying" || step === "confirming") && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                {status ||
                  (step === "paying"
                    ? "Confirm the payment in your wallet…"
                    : "Submitting score…")}
              </p>
            </div>
          )}

          {status && showTokenStep && !error ? (
            <p className="spark-shop-payment__hint">{status}</p>
          ) : null}

          {error && (
            <p className="spark-shop-payment__error" role="alert">
              {error}
            </p>
          )}

          {txHash && showTokenStep && !busy ? (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                Payment hash: {txHash.slice(0, 10)}…{txHash.slice(-8)}
              </p>
              <button
                type="button"
                className={payBtnClass}
                onClick={() => void handleConfirmPendingTx()}
              >
                Confirm submit (no extra charge)
              </button>
            </div>
          ) : null}

          <div className="spark-shop-payment__footer">
            {showTokenStep && !txHash ? (
              <button
                type="button"
                className={payBtnClass}
                onClick={() => void handlePay()}
                disabled={busy || !selectedToken}
              >
                {busy ? "Processing…" : "Pay & Submit"}
              </button>
            ) : null}
            {!contestLive ? (
              <p className="spark-shop-payment__contest-status">
                Contest is not live
              </p>
            ) : null}
            <button
              type="button"
              className="spark-shop-payment__primary spark-shop-payment__primary--ghost"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
