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
import { formatUnits } from "viem";
import { PRIMARY_EVM_CHAIN_ID } from "@/lib/chains";
import { submitPaidScore } from "@/lib/leaderboard-client";
import {
  erc20Abi,
  SHOP_PAYMENT_TOKENS,
  SHOP_RECIPIENT_ADDRESS,
  SHOP_TOKEN_DECIMALS,
  type ShopPaymentToken,
} from "@/lib/shop";
import { formatScoreSubmitPrice, scoreSubmitPriceToAmount } from "@/lib/score-submit";

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
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<PaymentStep>("token");
  const [selectedToken, setSelectedToken] = useState<ShopPaymentToken | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onMegaEth = chainId === PRIMARY_EVM_CHAIN_ID;
  const requiredAmount = scoreSubmitPriceToAmount();

  const { data: contractData, isLoading: balancesLoading } = useReadContracts({
    contracts: SHOP_PAYMENT_TOKENS.flatMap((token) => [
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
    ]),
    query: {
      enabled: open && Boolean(address) && onMegaEth,
    },
  });

  const tokenOptions = useMemo(() => {
    return SHOP_PAYMENT_TOKENS.map((token, index) => {
      const balanceResult = contractData?.[index * 2];
      const decimalsResult = contractData?.[index * 2 + 1];
      const balance: bigint =
        balanceResult?.status === "success"
          ? BigInt(balanceResult.result)
          : BigInt(0);
      const decimals =
        decimalsResult?.status === "success"
          ? Number(decimalsResult.result)
          : SHOP_TOKEN_DECIMALS;
      const sufficient = balance >= requiredAmount;

      return {
        token,
        balance,
        decimals,
        sufficient,
        balanceLabel: formatTokenBalance(balance, decimals),
      };
    });
  }, [contractData, requiredAmount]);

  const confirmSubmit = useCallback(
    async (hash: `0x${string}`, token: ShopPaymentToken) => {
      setStep("confirming");
      setBusy(true);
      setError("");

      try {
        const { submittedBest } = await submitPaidScore(gameId, {
          score,
          walletAddress,
          txHash: hash,
          name: playerName,
          tokenAddress: token.address,
          ecosystem: "evm",
        });
        onSuccess(submittedBest);
        onClose();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not submit score."
        );
        setStep("token");
      } finally {
        setBusy(false);
      }
    },
    [gameId, score, walletAddress, playerName, onSuccess, onClose]
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
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setStep(onMegaEth ? "token" : "network");
  }, [open, onMegaEth]);

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
      if (!payToken || !address) return;

      const option = tokenOptions.find(
        (entry) => entry.token.id === payToken.id
      );
      if (!option?.sufficient) {
        setError(`Not enough ${payToken.symbol} for this submission.`);
        return;
      }

      setSelectedToken(payToken);
      setBusy(true);
      setError("");
      setStep("paying");

      try {
        const hash = await writeContractAsync({
          address: payToken.address,
          abi: erc20Abi,
          functionName: "transfer",
          args: [SHOP_RECIPIENT_ADDRESS, requiredAmount],
          chainId: PRIMARY_EVM_CHAIN_ID,
        });

        await confirmSubmit(hash, payToken);
      } catch (err) {
        setStep("token");
        setError(
          err instanceof Error
            ? err.message
            : "Payment was cancelled or failed."
        );
      } finally {
        setBusy(false);
      }
    },
    [
      selectedToken,
      address,
      tokenOptions,
      writeContractAsync,
      requiredAmount,
      confirmSubmit,
    ]
  );

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

  const showTokenStep = step === "token" && onMegaEth;

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
            Pay {formatScoreSubmitPrice()} in USDT or USDC
          </p>
          <p className="spark-shop-payment__desc">
            Your score of <strong>{score.toLocaleString()}</strong> will appear
            on the public leaderboard after payment confirms.
          </p>

          {!isConnected && (
            <p className="spark-shop-payment__error" role="alert">
              Connect your wallet to submit.
            </p>
          )}

          {step === "network" && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                Switch to MegaETH to pay with USDT or USDC.
              </p>
              <button
                type="button"
                className="spark-shop-payment__primary"
                onClick={() => void handleSwitchNetwork()}
                disabled={busy}
              >
                Switch Network
              </button>
            </div>
          )}

          {showTokenStep && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                Select a token to pay {formatScoreSubmitPrice()}.
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
                  : "Confirming on chain…"}
              </p>
            </div>
          )}

          {error && (
            <p className="spark-shop-payment__error" role="alert">
              {error}
            </p>
          )}

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
