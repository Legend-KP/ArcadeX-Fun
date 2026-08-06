"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  useAccount,
  useChainId,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { formatUnits, maxUint256, type Hash } from "viem";
import { PRIMARY_EVM_CHAIN_ID } from "@/lib/chains";
import { formatChainError } from "@/lib/base-public-client";
import { isPaymentStillConfirmingError } from "@/lib/payment-tx-verify";
import { submitPaidScore } from "@/lib/leaderboard-client";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import {
  erc20Abi,
  SHOP_PAYMENT_TOKENS,
  SHOP_TOKEN_DECIMALS,
  type ShopPaymentToken,
} from "@/lib/shop";
import { formatScoreSubmitPrice, scoreSubmitPriceToAmount } from "@/lib/score-submit";
import {
  isScoreSubmitContractConfigured,
  SCORE_SUBMIT_ABI,
  SCORE_SUBMIT_CONTRACT_ADDRESS,
} from "@/lib/score-submit-contract";

interface ScoreSubmitModalProps {
  open: boolean;
  gameId: string;
  score: number;
  playerName: string;
  walletAddress: string;
  onClose: () => void;
  onSuccess: (submittedBest: number) => void;
}

type PaymentStep = "network" | "token" | "paying" | "confirming";

function formatTokenBalance(balance: bigint, decimals: number): string {
  const formatted = formatUnits(balance, decimals);
  const value = Number(formatted);
  if (!Number.isFinite(value)) return formatted;
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** Pull a tx hash if wagmi/MetaMask threw after the wallet already broadcast. */
function extractSubmittedTxHash(error: unknown): Hash | null {
  const candidates: unknown[] = [];
  let current: unknown = error;
  for (let i = 0; i < 6 && current; i++) {
    candidates.push(current);
    if (current && typeof current === "object") {
      const obj = current as Record<string, unknown>;
      if ("hash" in obj) candidates.push(obj.hash);
      if ("transactionHash" in obj) candidates.push(obj.transactionHash);
      if ("cause" in obj) current = obj.cause;
      else break;
    } else break;
  }

  for (const value of candidates) {
    if (typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value)) {
      return value as Hash;
    }
  }

  const text =
    error instanceof Error
      ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`
      : String(error);
  const match = text.match(/0x[a-fA-F0-9]{64}/);
  return match ? (match[0] as Hash) : null;
}

async function confirmScoreSubmitWithRetries(params: {
  gameId: string;
  score: number;
  walletAddress: string;
  playerName: string;
  txHash: Hash;
  tokenAddress: string;
}): Promise<number> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1200 + attempt * 600));
    }
    try {
      const { submittedBest } = await submitPaidScore(params.gameId, {
        score: params.score,
        walletAddress: params.walletAddress,
        txHash: params.txHash,
        name: params.playerName,
        tokenAddress: params.tokenAddress,
        ecosystem: "evm",
      });
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
      if (attempt >= 2) throw err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not confirm payment yet. Tap Confirm submit to retry.");
}

export default function ScoreSubmitModal({
  open,
  gameId,
  score,
  playerName,
  walletAddress,
  onClose,
  onSuccess,
}: ScoreSubmitModalProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { openConnect } = usePlayerProfile();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<PaymentStep>("token");
  const [selectedToken, setSelectedToken] = useState<ShopPaymentToken | null>(
    null
  );
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onPrimaryChain = chainId === PRIMARY_EVM_CHAIN_ID;
  const requiredAmount = scoreSubmitPriceToAmount();
  const scoreContractConfigured = isScoreSubmitContractConfigured();

  const { data: contractData, isLoading: balancesLoading } = useReadContracts({
    contracts: [
      ...SHOP_PAYMENT_TOKENS.flatMap((token) => [
        {
          address: token.address,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [address!],
          chainId: PRIMARY_EVM_CHAIN_ID,
        },
        {
          address: token.address,
          abi: erc20Abi,
          functionName: "decimals" as const,
          chainId: PRIMARY_EVM_CHAIN_ID,
        },
        {
          address: token.address,
          abi: erc20Abi,
          functionName: "allowance" as const,
          args: [
            address!,
            scoreContractConfigured
              ? SCORE_SUBMIT_CONTRACT_ADDRESS
              : token.address,
          ],
          chainId: PRIMARY_EVM_CHAIN_ID,
        },
      ]),
      ...(scoreContractConfigured
        ? [
            {
              address: SCORE_SUBMIT_CONTRACT_ADDRESS,
              abi: SCORE_SUBMIT_ABI,
              functionName: "fee" as const,
              chainId: PRIMARY_EVM_CHAIN_ID,
            },
            {
              address: SCORE_SUBMIT_CONTRACT_ADDRESS,
              abi: SCORE_SUBMIT_ABI,
              functionName: "paused" as const,
              chainId: PRIMARY_EVM_CHAIN_ID,
            },
          ]
        : []),
    ],
    query: {
      enabled: open && Boolean(address) && onPrimaryChain,
    },
  });

  const onChainFee =
    scoreContractConfigured &&
    contractData?.[SHOP_PAYMENT_TOKENS.length * 3]?.status === "success"
      ? (contractData[SHOP_PAYMENT_TOKENS.length * 3]!.result as bigint)
      : null;
  const contractPaused =
    scoreContractConfigured &&
    contractData?.[SHOP_PAYMENT_TOKENS.length * 3 + 1]?.status === "success"
      ? Boolean(contractData[SHOP_PAYMENT_TOKENS.length * 3 + 1]!.result)
      : false;

  const tokenOptions = useMemo(() => {
    return SHOP_PAYMENT_TOKENS.map((token, index) => {
      const balanceResult = contractData?.[index * 3];
      const decimalsResult = contractData?.[index * 3 + 1];
      const allowanceResult = contractData?.[index * 3 + 2];
      const balance: bigint =
        balanceResult?.status === "success"
          ? BigInt(balanceResult.result as bigint)
          : BigInt(0);
      const decimals =
        decimalsResult?.status === "success"
          ? Number(decimalsResult.result)
          : SHOP_TOKEN_DECIMALS;
      const allowance: bigint =
        allowanceResult?.status === "success"
          ? BigInt(allowanceResult.result as bigint)
          : BigInt(0);
      const amount = onChainFee ?? requiredAmount;
      const sufficient = balance >= amount;

      return {
        token,
        balance,
        decimals,
        allowance,
        requiredAmount: amount,
        sufficient,
        balanceLabel: formatTokenBalance(balance, decimals),
      };
    });
  }, [contractData, requiredAmount, onChainFee]);

  const confirmSubmit = useCallback(
    async (hash: `0x${string}`, token: ShopPaymentToken) => {
      setStep("confirming");
      setBusy(true);
      setError("");
      setTxHash(hash);

      try {
        const submittedBest = await confirmScoreSubmitWithRetries({
          gameId,
          score,
          walletAddress: address || walletAddress,
          playerName,
          txHash: hash,
          tokenAddress: token.address,
        });
        onSuccess(submittedBest);
        onClose();
      } catch (err) {
        setError(
          isPaymentStillConfirmingError(err)
            ? "Payment submitted on Base. Confirmation is still catching up — tap Confirm submit (do not pay again)."
            : formatChainError(err) || "Could not submit score."
        );
        setStep("token");
      } finally {
        setBusy(false);
      }
    },
    [gameId, score, address, walletAddress, playerName, onSuccess, onClose]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setStep("token");
      setSelectedToken(null);
      setTxHash(undefined);
      setBusy(false);
      setError("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setStep(onPrimaryChain ? "token" : "network");
  }, [open, onPrimaryChain]);

  const handleSwitchNetwork = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await switchChainAsync({ chainId: PRIMARY_EVM_CHAIN_ID });
      setStep("token");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not switch network. Approve the switch in your wallet."
      );
    } finally {
      setBusy(false);
    }
  }, [switchChainAsync]);

  const handlePay = useCallback(
    async (token?: ShopPaymentToken) => {
      const payToken = token ?? selectedToken;
      if (!payToken) return;

      if (!isConnected || !address) {
        setError("Reconnect your wallet to approve the USDC payment.");
        openConnect();
        return;
      }

      const option = tokenOptions.find(
        (entry) => entry.token.id === payToken.id
      );
      if (!option?.sufficient) {
        setError(`Not enough ${payToken.symbol} for this submission.`);
        return;
      }

      if (!isScoreSubmitContractConfigured()) {
        setError("Score submit contract is not configured.");
        return;
      }
      if (contractPaused) {
        setError("Score submit is temporarily paused. Try again later.");
        return;
      }

      setSelectedToken(payToken);
      setBusy(true);
      setError("");
      setStep("paying");

      try {
        if (option.allowance < option.requiredAmount) {
          await writeContractAsync({
            address: payToken.address,
            abi: erc20Abi,
            functionName: "approve",
            args: [SCORE_SUBMIT_CONTRACT_ADDRESS, maxUint256],
            chainId: PRIMARY_EVM_CHAIN_ID,
          });
        }

        const hash = await writeContractAsync({
          address: SCORE_SUBMIT_CONTRACT_ADDRESS,
          abi: SCORE_SUBMIT_ABI,
          functionName: "payWithUSDC",
          chainId: PRIMARY_EVM_CHAIN_ID,
        });

        setTxHash(hash);
        await confirmSubmit(hash, payToken);
      } catch (err) {
        const submitted = extractSubmittedTxHash(err);
        if (submitted) {
          setTxHash(submitted);
          try {
            await confirmSubmit(submitted, payToken);
            return;
          } catch (confirmErr) {
            setStep("token");
            setError(
              isPaymentStillConfirmingError(confirmErr)
                ? "Payment submitted on Base. Confirmation is still catching up — tap Confirm submit (do not pay again)."
                : formatChainError(confirmErr) || "Could not submit score."
            );
            return;
          }
        }
        setStep("token");
        setError(
          formatChainError(err) || "Payment was cancelled or failed."
        );
      } finally {
        setBusy(false);
      }
    },
    [
      selectedToken,
      address,
      isConnected,
      openConnect,
      tokenOptions,
      writeContractAsync,
      confirmSubmit,
      contractPaused,
    ]
  );

  const handleConfirmPendingTx = useCallback(async () => {
    if (!selectedToken || !txHash) return;
    await confirmSubmit(txHash, selectedToken);
  }, [selectedToken, txHash, confirmSubmit]);

  const handleTokenSelect = useCallback(
    (token: ShopPaymentToken, sufficient: boolean) => {
      if (!sufficient || busy) return;
      setSelectedToken(token);
      setError("");
      void handlePay(token);
    },
    [busy, handlePay]
  );

  if (!open || !mounted) return null;

  const showTokenStep = step === "token" && onPrimaryChain;

  const modal = (
    <div
      className="spark-shop-payment-backdrop"
      role="presentation"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="spark-shop-payment"
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-submit-title"
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

          <h2 id="score-submit-title" className="spark-panel__title">
            Submit to Leaderboard
          </h2>
          <p className="spark-shop-payment__price">
            Pay {formatScoreSubmitPrice()} in USDC
          </p>
          <p className="spark-shop-payment__desc">
            Your score of <strong>{score.toLocaleString()}</strong> will appear
            on the public leaderboard after payment confirms.
          </p>

          {!isConnected && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__error" role="alert">
                Wallet disconnected. Reconnect to pay with USDC on Base.
              </p>
              <button
                type="button"
                className="spark-shop-payment__primary"
                onClick={() => openConnect()}
                disabled={busy}
              >
                Connect wallet
              </button>
            </div>
          )}

          {isConnected && step === "network" && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                Switch to Base to pay with USDC. Gas is paid in ETH.
              </p>
              <button
                type="button"
                className="spark-shop-payment__primary"
                onClick={() => void handleSwitchNetwork()}
                disabled={busy}
              >
                Switch to Base
              </button>
            </div>
          )}

          {isConnected && showTokenStep && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                Select USDC to pay {formatScoreSubmitPrice()}.
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
                {step === "paying"
                  ? "Confirm the payment in your wallet…"
                  : "Submitting score…"}
              </p>
            </div>
          )}

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
                className="spark-shop-payment__primary"
                onClick={() => void handleConfirmPendingTx()}
              >
                Confirm submit (no extra charge)
              </button>
            </div>
          ) : null}

          <div className="spark-shop-payment__footer">
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
