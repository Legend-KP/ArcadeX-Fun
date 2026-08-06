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
import { formatUnits, getAddress, maxUint256, type Hash } from "viem";
import { avalanche, PRIMARY_EVM_CHAIN_ID } from "@/lib/chains";
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
import {
  AVALANCHE_SHOP_PAYMENT_TOKENS,
  AVALANCHE_SHOP_RECIPIENT_ADDRESS,
  AVALANCHE_SHOP_TOKEN_DECIMALS,
  type AvalancheShopPaymentToken,
} from "@/lib/shop-avalanche";
import { formatScoreSubmitPrice, scoreSubmitPriceToAmount } from "@/lib/score-submit";
import {
  isScoreSubmitContractConfigured,
  SCORE_SUBMIT_ABI,
  SCORE_SUBMIT_CONTRACT_ADDRESS,
} from "@/lib/score-submit-contract";

const AVALANCHE_CHAIN_ID = avalanche.id;

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
type PaymentToken = ShopPaymentToken | AvalancheShopPaymentToken;

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
  const { openConnect, chainId: profileChainId } = usePlayerProfile();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<PaymentStep>("token");
  const [selectedToken, setSelectedToken] = useState<PaymentToken | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isAvalanche = profileChainId === AVALANCHE_CHAIN_ID;
  const targetChainId = isAvalanche ? AVALANCHE_CHAIN_ID : PRIMARY_EVM_CHAIN_ID;
  const networkLabel = isAvalanche ? "Avalanche" : "Base";
  const gasLabel = isAvalanche ? "AVAX" : "ETH";
  const onTargetChain = chainId === targetChainId;
  const requiredAmount = scoreSubmitPriceToAmount();
  const scoreContractConfigured =
    !isAvalanche && isScoreSubmitContractConfigured();
  const paymentTokens = isAvalanche
    ? AVALANCHE_SHOP_PAYMENT_TOKENS
    : SHOP_PAYMENT_TOKENS;
  const defaultDecimals = isAvalanche
    ? AVALANCHE_SHOP_TOKEN_DECIMALS
    : SHOP_TOKEN_DECIMALS;

  const { data: contractData, isLoading: balancesLoading } = useReadContracts({
    contracts: [
      ...paymentTokens.flatMap((token) => [
        {
          address: token.address,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [address!],
          chainId: targetChainId,
        },
        {
          address: token.address,
          abi: erc20Abi,
          functionName: "decimals" as const,
          chainId: targetChainId,
        },
        ...(isAvalanche
          ? []
          : [
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
                chainId: targetChainId,
              },
            ]),
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
      enabled: open && Boolean(address) && onTargetChain,
    },
  });

  const fieldsPerToken = isAvalanche ? 2 : 3;
  const onChainFee =
    scoreContractConfigured &&
    contractData?.[paymentTokens.length * fieldsPerToken]?.status === "success"
      ? (contractData[paymentTokens.length * fieldsPerToken]!.result as bigint)
      : null;
  const contractPaused =
    scoreContractConfigured &&
    contractData?.[paymentTokens.length * fieldsPerToken + 1]?.status ===
      "success"
      ? Boolean(
          contractData[paymentTokens.length * fieldsPerToken + 1]!.result
        )
      : false;

  const tokenOptions = useMemo(() => {
    return paymentTokens.map((token, index) => {
      const balanceResult = contractData?.[index * fieldsPerToken];
      const decimalsResult = contractData?.[index * fieldsPerToken + 1];
      const allowanceResult = isAvalanche
        ? undefined
        : contractData?.[index * fieldsPerToken + 2];
      const balance: bigint =
        balanceResult?.status === "success"
          ? BigInt(balanceResult.result as bigint)
          : BigInt(0);
      const decimals =
        decimalsResult?.status === "success"
          ? Number(decimalsResult.result)
          : defaultDecimals;
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
  }, [
    contractData,
    requiredAmount,
    onChainFee,
    paymentTokens,
    fieldsPerToken,
    isAvalanche,
    defaultDecimals,
  ]);

  const confirmSubmit = useCallback(
    async (hash: `0x${string}`, token: PaymentToken) => {
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
            ? `Payment submitted on ${networkLabel}. Confirmation is still catching up — tap Confirm submit (do not pay again).`
            : formatChainError(err) || "Could not submit score."
        );
        setStep("token");
      } finally {
        setBusy(false);
      }
    },
    [
      gameId,
      score,
      address,
      walletAddress,
      playerName,
      onSuccess,
      onClose,
      networkLabel,
    ]
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
    setStep(onTargetChain ? "token" : "network");
  }, [open, onTargetChain]);

  const handleSwitchNetwork = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await switchChainAsync({ chainId: targetChainId });
      setStep("token");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Could not switch to ${networkLabel}. Approve the switch in your wallet.`
      );
    } finally {
      setBusy(false);
    }
  }, [switchChainAsync, targetChainId, networkLabel]);

  const handlePay = useCallback(
    async (token?: PaymentToken) => {
      const payToken = token ?? selectedToken;
      if (!payToken) return;

      if (!isConnected || !address) {
        setError("Reconnect your wallet to approve the USDC payment.");
        openConnect();
        return;
      }

      if (
        walletAddress &&
        getAddress(address) !== getAddress(walletAddress as `0x${string}`)
      ) {
        setError(
          `MetaMask is on ${address.slice(0, 6)}…${address.slice(-4)}, but you signed in as ${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}. Switch MetaMask to your signed-in account, then try again.`
        );
        return;
      }

      const option = tokenOptions.find(
        (entry) => entry.token.id === payToken.id
      );
      if (!option?.sufficient) {
        setError(`Not enough ${payToken.symbol} for this submission.`);
        return;
      }

      if (!isAvalanche) {
        if (!isScoreSubmitContractConfigured()) {
          setError("Score submit contract is not configured.");
          return;
        }
        if (contractPaused) {
          setError("Score submit is temporarily paused. Try again later.");
          return;
        }
      }

      setSelectedToken(payToken);
      setBusy(true);
      setError("");
      setStep("paying");

      try {
        let hash: Hash;

        if (isAvalanche) {
          hash = await writeContractAsync({
            address: payToken.address,
            abi: erc20Abi,
            functionName: "transfer",
            args: [AVALANCHE_SHOP_RECIPIENT_ADDRESS, option.requiredAmount],
            chainId: AVALANCHE_CHAIN_ID,
          });
        } else {
          if (option.allowance < option.requiredAmount) {
            await writeContractAsync({
              address: payToken.address,
              abi: erc20Abi,
              functionName: "approve",
              args: [SCORE_SUBMIT_CONTRACT_ADDRESS, maxUint256],
              chainId: PRIMARY_EVM_CHAIN_ID,
            });
          }

          hash = await writeContractAsync({
            address: SCORE_SUBMIT_CONTRACT_ADDRESS,
            abi: SCORE_SUBMIT_ABI,
            functionName: "payWithUSDC",
            chainId: PRIMARY_EVM_CHAIN_ID,
          });
        }

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
                ? `Payment submitted on ${networkLabel}. Confirmation is still catching up — tap Confirm submit (do not pay again).`
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
      isAvalanche,
      networkLabel,
    ]
  );

  const handleConfirmPendingTx = useCallback(async () => {
    if (!selectedToken || !txHash) return;
    await confirmSubmit(txHash, selectedToken);
  }, [selectedToken, txHash, confirmSubmit]);

  const handleTokenSelect = useCallback(
    (token: PaymentToken, sufficient: boolean) => {
      if (!sufficient || busy) return;
      setSelectedToken(token);
      setError("");
      void handlePay(token);
    },
    [busy, handlePay]
  );

  if (!open || !mounted) return null;

  const showTokenStep = step === "token" && onTargetChain;

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
            Pay {formatScoreSubmitPrice()} in USDC on {networkLabel}
          </p>
          <p className="spark-shop-payment__desc">
            Your score of <strong>{score.toLocaleString()}</strong> will appear
            on the public leaderboard after payment confirms.
          </p>

          {!isConnected && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__error" role="alert">
                Wallet disconnected. Reconnect to pay with USDC on{" "}
                {networkLabel}.
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
                Switch to {networkLabel} to pay with USDC. Gas is paid in{" "}
                {gasLabel}.
              </p>
              <button
                type="button"
                className="spark-shop-payment__primary"
                onClick={() => void handleSwitchNetwork()}
                disabled={busy}
              >
                Switch to {networkLabel}
              </button>
            </div>
          )}

          {isConnected && showTokenStep && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                {isAvalanche
                  ? `Select USDC to transfer ${formatScoreSubmitPrice()} on Avalanche. Gas is paid in AVAX.`
                  : `Select USDC to pay ${formatScoreSubmitPrice()}.`}
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
