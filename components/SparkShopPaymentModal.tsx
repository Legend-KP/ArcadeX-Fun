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
import { formatUnits, maxUint256, type Address, type Hash } from "viem";
import { PRIMARY_EVM_CHAIN_ID, primaryEvmChain } from "@/lib/chains";
import { formatChainError } from "@/lib/base-public-client";
import { isPaymentStillConfirmingError } from "@/lib/payment-tx-verify";
import { purchaseSparkItem, SparkClientError } from "@/lib/spark-client";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import {
  clearPendingShopPurchaseTx,
  readPendingShopPurchaseTx,
  savePendingShopPurchaseTx,
} from "@/lib/shop-purchase-pending-tx";
import {
  erc20Abi,
  formatShopPrice,
  SHOP_PRODUCTS,
  SHOP_PAYMENT_TOKENS,
  SHOP_TOKEN_DECIMALS,
  shopPriceToAmount,
  type ShopPaymentToken,
  type ShopProductId,
  type ShopPurchaseSuccess,
} from "@/lib/shop";
import {
  SPARK_REFILL_ABI,
  SPARK_REFILL_CONTRACT_ADDRESS,
  isSparkRefillConfigured,
} from "@/lib/spark-refill";
import {
  INFINITE_SPARK_ABI,
  INFINITE_SPARK_CONTRACT_ADDRESS,
  isInfiniteSparkConfigured,
} from "@/lib/infinite-spark";

function shopContractForProduct(
  productId: ShopProductId
): { address: Address; abi: typeof SPARK_REFILL_ABI } | null {
  if (productId === "spark-refill" && isSparkRefillConfigured()) {
    return {
      address: SPARK_REFILL_CONTRACT_ADDRESS,
      abi: SPARK_REFILL_ABI,
    };
  }
  if (productId === "infinite-24h" && isInfiniteSparkConfigured()) {
    return {
      address: INFINITE_SPARK_CONTRACT_ADDRESS,
      abi: INFINITE_SPARK_ABI,
    };
  }
  return null;
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

/**
 * Credit Sparks via API as soon as we have a hash.
 * Server verifies EntryPaid — do not block the UI on public-RPC receipt waits.
 */
async function confirmPurchaseWithRetries(params: {
  playerId: string;
  productId: ShopProductId;
  txHash: Hash;
  tokenAddress: string;
}): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 700 + attempt * 400));
    }
    try {
      await purchaseSparkItem({
        playerId: params.playerId,
        productId: params.productId,
        txHash: params.txHash,
        tokenAddress: params.tokenAddress,
      });
      clearPendingShopPurchaseTx();
      return;
    } catch (err) {
      lastError = err;
      if (isPaymentStillConfirmingError(err)) continue;

      if (err instanceof SparkClientError) {
        if (
          err.code === "NO_SESSION" ||
          err.code === "SESSION_MISMATCH" ||
          err.code === "UNSUPPORTED_WALLET" ||
          err.code === "INVALID_PRODUCT" ||
          err.code === "INVALID_TOKEN" ||
          err.code === "TX_ALREADY_USED"
        ) {
          throw err;
        }
        // 5xx / RPC flakes — keep retrying briefly.
        if ((err.status ?? 0) >= 500 && attempt < 5) continue;
      }

      const msg = err instanceof Error ? err.message.toLowerCase() : "";
      if (
        msg.includes("sign in") ||
        msg.includes("session mismatch") ||
        msg.includes("unsupported") ||
        msg.includes("unknown shop") ||
        msg.includes("does not match") ||
        msg.includes("already used")
      ) {
        throw err;
      }

      if (
        attempt >= 4 &&
        !msg.includes("network") &&
        !msg.includes("failed to fetch") &&
        !msg.includes("521") &&
        !msg.includes("http request failed")
      ) {
        throw err;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not confirm payment yet. Tap Confirm payment to retry.");
}

interface SparkShopPaymentModalProps {
  open: boolean;
  productId: ShopProductId | null;
  playerId: string;
  onClose: () => void;
  onSuccess: (purchase: ShopPurchaseSuccess) => void;
}

type PaymentStep = "network" | "token" | "paying" | "confirming";

function formatTokenBalance(balance: bigint, decimals: number): string {
  const formatted = formatUnits(balance, decimals);
  const value = Number(formatted);
  if (!Number.isFinite(value)) return formatted;
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export default function SparkShopPaymentModal({
  open,
  productId,
  playerId,
  onClose,
  onSuccess,
}: SparkShopPaymentModalProps) {
  const product = productId ? SHOP_PRODUCTS[productId] : null;
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { ensureWalletReady } = usePlayerProfile();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<PaymentStep>("token");
  const [selectedToken, setSelectedToken] = useState<ShopPaymentToken | null>(
    null
  );
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onPrimaryChain = chainId === PRIMARY_EVM_CHAIN_ID;
  const payContract = productId ? shopContractForProduct(productId) : null;

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
          args: [address!, payContract?.address ?? token.address],
          chainId: PRIMARY_EVM_CHAIN_ID,
        },
      ]),
      ...(payContract
        ? [
            {
              address: payContract.address,
              abi: payContract.abi,
              functionName: "fee" as const,
              chainId: PRIMARY_EVM_CHAIN_ID,
            },
            {
              address: payContract.address,
              abi: payContract.abi,
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
    payContract && contractData?.[SHOP_PAYMENT_TOKENS.length * 3]?.status === "success"
      ? (contractData[SHOP_PAYMENT_TOKENS.length * 3]!.result as bigint)
      : null;
  const contractPaused =
    payContract &&
    contractData?.[SHOP_PAYMENT_TOKENS.length * 3 + 1]?.status === "success"
      ? Boolean(contractData[SHOP_PAYMENT_TOKENS.length * 3 + 1]!.result)
      : false;

  const tokenOptions = useMemo(() => {
    if (!product) return [];

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
      const requiredAmount =
        onChainFee ?? shopPriceToAmount(product.priceUsd, decimals);
      const sufficient = balance >= requiredAmount;

      return {
        token,
        balance,
        decimals,
        requiredAmount,
        allowance,
        sufficient,
        balanceLabel: formatTokenBalance(balance, decimals),
      };
    });
  }, [contractData, product, onChainFee]);

  const confirmPurchase = useCallback(
    async (
      hash: `0x${string}`,
      token: ShopPaymentToken,
      purchasedProduct: NonNullable<typeof product>
    ) => {
      setStep("confirming");
      setBusy(true);
      setError("");
      setTxHash(hash);

      savePendingShopPurchaseTx({
        playerId,
        productId: purchasedProduct.id,
        txHash: hash,
        tokenAddress: token.address,
        network: "base",
        savedAt: Date.now(),
      });

      try {
        await confirmPurchaseWithRetries({
          playerId,
          productId: purchasedProduct.id,
          txHash: hash,
          tokenAddress: token.address,
        });

        onSuccess({
          productId: purchasedProduct.id,
          txHash: hash,
          tokenSymbol: token.symbol,
          network: "base",
        });
        onClose();
      } catch (err) {
        setError(
          isPaymentStillConfirmingError(err)
            ? "Payment submitted on Base. Confirmation is still catching up — tap Confirm payment (do not pay again)."
            : formatChainError(err) || "Could not confirm purchase."
        );
        setStep("token");
        // Keep txHash so the user can retry confirmation without paying again.
      } finally {
        setBusy(false);
      }
    },
    [playerId, onSuccess, onClose]
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
      return;
    }

    if (!productId) return;

    const pending = readPendingShopPurchaseTx(playerId, productId);
    if (pending?.txHash) {
      setTxHash(pending.txHash as `0x${string}`);
      const match = SHOP_PAYMENT_TOKENS.find(
        (t) => t.address.toLowerCase() === pending.tokenAddress.toLowerCase()
      );
      if (match) setSelectedToken(match);
    }
  }, [open, playerId, productId]);

  useEffect(() => {
    if (!open) return;
    setStep(onPrimaryChain ? "token" : "network");
  }, [open, onPrimaryChain]);

  useEffect(() => {
    if (!open || isConnected || address) return;
    if (step === "paying" || step === "confirming") return;
    void ensureWalletReady();
  }, [open, isConnected, address, step, ensureWalletReady]);

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
          : `Could not switch to ${primaryEvmChain.name}. Approve the network switch in your wallet.`
      );
    } finally {
      setBusy(false);
    }
  }, [switchChainAsync]);

  const handlePay = useCallback(
    async (token?: ShopPaymentToken) => {
      const payToken = token ?? selectedToken;
      if (!product || !payToken || !address) return;

      const option = tokenOptions.find(
        (entry) => entry.token.id === payToken.id
      );
      if (!option?.sufficient) {
        setError(`Not enough ${payToken.symbol} for this purchase.`);
        return;
      }

      const contract = shopContractForProduct(product.id);
      if (!contract) {
        setError("Spark payment contract is not configured.");
        return;
      }
      if (contractPaused) {
        setError("Spark purchases are temporarily paused. Try again later.");
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
            args: [contract.address, maxUint256],
            chainId: PRIMARY_EVM_CHAIN_ID,
          });
        }

        const hash = await writeContractAsync({
          address: contract.address,
          abi: contract.abi,
          functionName: "payWithUSDC",
          chainId: PRIMARY_EVM_CHAIN_ID,
        });

        setTxHash(hash);
        await confirmPurchase(hash, payToken, product);
      } catch (err) {
        const submitted = extractSubmittedTxHash(err);
        if (submitted) {
          setTxHash(submitted);
          try {
            await confirmPurchase(submitted, payToken, product);
            return;
          } catch (confirmErr) {
            setStep("token");
            setError(
              isPaymentStillConfirmingError(confirmErr)
                ? "Payment submitted on Base. Confirmation is still catching up — tap Confirm payment (do not pay again)."
                : formatChainError(confirmErr) || "Could not confirm purchase."
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
      product,
      selectedToken,
      address,
      tokenOptions,
      writeContractAsync,
      confirmPurchase,
      contractPaused,
    ]
  );

  const handleConfirmPendingTx = useCallback(async () => {
    if (!product || !selectedToken || !txHash) return;
    await confirmPurchase(txHash, selectedToken, product);
  }, [product, selectedToken, txHash, confirmPurchase]);

  const handleTokenSelect = useCallback(
    (token: ShopPaymentToken, sufficient: boolean) => {
      if (!sufficient || busy) return;

      setSelectedToken(token);
      setError("");
      void handlePay(token);
    },
    [busy, handlePay]
  );

  if (!open || !product || !mounted) return null;

  const hasWallet = Boolean(address) || isConnected;
  const affordableCount = tokenOptions.filter((option) => option.sufficient)
    .length;
  const showTokenStep = step === "token" && onPrimaryChain && hasWallet;
  const showPayFooter =
    showTokenStep && !balancesLoading && affordableCount > 0 && !txHash;
  const showConnectPrompt =
    !hasWallet && step !== "paying" && step !== "confirming";

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
        aria-labelledby="spark-shop-payment-title"
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
            ×
          </button>

          <h2 id="spark-shop-payment-title" className="spark-panel__title">
            {product.name}
          </h2>
          <p className="spark-shop-payment__price">
            {formatShopPrice(product.priceUsd)} on {primaryEvmChain.name}
          </p>
          <p className="spark-shop-payment__desc">{product.description}</p>

          {showConnectPrompt && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                Reconnect your wallet to continue.
              </p>
              <button
                type="button"
                className="spark-shop-payment__primary"
                onClick={() => void ensureWalletReady()}
                disabled={busy}
              >
                Connect wallet
              </button>
            </div>
          )}

          {hasWallet && step === "network" && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                Switch to {primaryEvmChain.name} to pay with USDC.
              </p>
              <button
                type="button"
                className="spark-shop-payment__primary"
                onClick={() => void handleSwitchNetwork()}
                disabled={busy}
              >
                {busy ? "Switching…" : `Switch to ${primaryEvmChain.name}`}
              </button>
            </div>
          )}

          {showTokenStep && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                Tap USDC to pay. Your wallet will ask to approve USDC, then pay
                the Spark contract. Gas is paid in ETH on Base.
              </p>

              {balancesLoading ? (
                <p className="spark-panel__loading">Loading balances…</p>
              ) : (
                <div className="spark-shop-payment__tokens">
                  {tokenOptions.map((option) => (
                    <button
                      key={option.token.id}
                      type="button"
                      className={`spark-shop-payment__token${
                        selectedToken?.id === option.token.id
                          ? " is-selected"
                          : ""
                      }${option.sufficient ? "" : " is-disabled"}`}
                      onClick={() =>
                        handleTokenSelect(option.token, option.sufficient)
                      }
                      disabled={!option.sufficient || busy}
                    >
                      <span className="spark-shop-payment__token-name">
                        {option.token.symbol}
                      </span>
                      <span className="spark-shop-payment__token-balance">
                        Balance: {option.balanceLabel}
                      </span>
                      {!option.sufficient && (
                        <span className="spark-shop-payment__token-note">
                          Insufficient balance
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {affordableCount === 0 && !balancesLoading && (
                <p className="spark-shop-payment__error" role="alert">
                  You need at least {formatShopPrice(product.priceUsd)} in USDC
                  on {primaryEvmChain.name}.
                </p>
              )}
            </div>
          )}

          {(step === "paying" || step === "confirming") && (
            <div className="spark-shop-payment__section">
              <p className="spark-panel__loading">
                {step === "confirming"
                  ? `Confirming payment on ${primaryEvmChain.name}…`
                  : "Approve the transaction in your wallet…"}
              </p>
            </div>
          )}

          {error ? (
            <p className="spark-shop-payment__error" role="alert">
              {error}
            </p>
          ) : null}

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
                Confirm payment (no extra charge)
              </button>
            </div>
          ) : null}
        </div>

        {showPayFooter && selectedToken && !busy && !txHash && (
          <div className="spark-shop-payment__footer">
            <button
              type="button"
              className="spark-shop-payment__primary"
              onClick={() => void handlePay()}
              disabled={busy}
            >
              Pay {formatShopPrice(product.priceUsd)} with{" "}
              {selectedToken.symbol}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
