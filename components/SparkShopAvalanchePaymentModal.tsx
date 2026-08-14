"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  useAccount,
  useChainId,
  useDisconnect,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { formatUnits, getAddress, type Hash } from "viem";
import { avalanche } from "@/lib/chains";
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
  isWalletMismatchMessage,
  WalletSessionMismatchError,
} from "@/lib/evm-session-wallet";
import {
  erc20Abi,
  formatShopPrice,
  SHOP_PRODUCTS,
  type ShopProductId,
  type ShopPurchaseSuccess,
} from "@/lib/shop";
import {
  AVALANCHE_SHOP_PAYMENT_TOKENS,
  AVALANCHE_SHOP_RECIPIENT_ADDRESS,
  AVALANCHE_SHOP_TOKEN_DECIMALS,
  avalancheShopAmountForProduct,
  type AvalancheShopPaymentToken,
} from "@/lib/shop-avalanche";

const AVALANCHE_CHAIN_ID = avalanche.id;

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

async function confirmPurchaseWithRetries(params: {
  playerId: string;
  productId: ShopProductId;
  txHash: Hash;
  tokenAddress: string;
}): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000 + attempt * 500));
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
      }

      const msg = err instanceof Error ? err.message.toLowerCase() : "";
      if (
        msg.includes("sign in") ||
        msg.includes("session") ||
        msg.includes("unsupported") ||
        msg.includes("unknown shop") ||
        msg.includes("does not match") ||
        msg.includes("already used")
      ) {
        throw err;
      }

      if (
        attempt >= 3 &&
        !msg.includes("network") &&
        !msg.includes("failed to fetch") &&
        !(err instanceof SparkClientError && (err.status ?? 0) >= 500)
      ) {
        throw err;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not confirm payment yet. Tap Confirm payment to retry.");
}

interface SparkShopAvalanchePaymentModalProps {
  open: boolean;
  productId: ShopProductId | null;
  playerId: string;
  /** ArcadeX session wallet — MetaMask must match this for verify to succeed. */
  walletAddress: string;
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

export default function SparkShopAvalanchePaymentModal({
  open,
  productId,
  playerId,
  walletAddress,
  onClose,
  onSuccess,
}: SparkShopAvalanchePaymentModalProps) {
  const product = productId ? SHOP_PRODUCTS[productId] : null;
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { openConnect, ensureWalletReady } = usePlayerProfile();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<PaymentStep>("token");
  const [selectedToken, setSelectedToken] =
    useState<AvalancheShopPaymentToken | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleReconnectWallet = useCallback(async () => {
    setError("");
    const ready = await ensureWalletReady();
    if (!ready) {
      try {
        await disconnectAsync();
      } catch {
        // ignore
      }
      openConnect();
    }
  }, [ensureWalletReady, disconnectAsync, openConnect]);

  const onAvalanche = chainId === AVALANCHE_CHAIN_ID;
  const sessionMatchesWallet = (() => {
    if (!address || !walletAddress) return false;
    try {
      return getAddress(address) === getAddress(walletAddress);
    } catch {
      return false;
    }
  })();

  const { data: contractData, isLoading: balancesLoading } = useReadContracts({
    contracts: AVALANCHE_SHOP_PAYMENT_TOKENS.flatMap((token) => [
      {
        address: token.address,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [address!],
        chainId: AVALANCHE_CHAIN_ID,
      },
      {
        address: token.address,
        abi: erc20Abi,
        functionName: "decimals" as const,
        chainId: AVALANCHE_CHAIN_ID,
      },
    ]),
    query: {
      enabled: open && Boolean(address) && onAvalanche,
    },
  });

  const tokenOptions = useMemo(() => {
    if (!product || !productId) return [];

    return AVALANCHE_SHOP_PAYMENT_TOKENS.map((token, index) => {
      const balanceResult = contractData?.[index * 2];
      const decimalsResult = contractData?.[index * 2 + 1];
      const balance: bigint =
        balanceResult?.status === "success"
          ? BigInt(balanceResult.result as bigint)
          : BigInt(0);
      const decimals =
        decimalsResult?.status === "success"
          ? Number(decimalsResult.result)
          : AVALANCHE_SHOP_TOKEN_DECIMALS;
      const requiredAmount = avalancheShopAmountForProduct(productId);
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
  }, [contractData, product, productId]);

  const confirmPurchase = useCallback(
    async (
      hash: `0x${string}`,
      token: AvalancheShopPaymentToken,
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
        network: "avalanche",
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
          network: "avalanche",
        });
        onClose();
      } catch (err) {
        setError(
          isPaymentStillConfirmingError(err)
            ? "Payment submitted on Avalanche. Confirmation is still catching up — tap Confirm payment (do not pay again)."
            : formatChainError(err) || "Could not confirm purchase."
        );
        setStep("token");
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
      const match = AVALANCHE_SHOP_PAYMENT_TOKENS.find(
        (t) => t.address.toLowerCase() === pending.tokenAddress.toLowerCase()
      );
      if (match) setSelectedToken(match);
    }
  }, [open, playerId, productId]);

  useEffect(() => {
    if (!open) return;
    setStep(onAvalanche ? "token" : "network");
  }, [open, onAvalanche]);

  useEffect(() => {
    if (!open || isConnected || address) return;
    if (step === "paying" || step === "confirming") return;
    void ensureWalletReady();
  }, [open, isConnected, address, step, ensureWalletReady]);

  const handleSwitchNetwork = useCallback(async () => {
    setBusy(true);
    setError("");

    try {
      await switchChainAsync({ chainId: AVALANCHE_CHAIN_ID });
      setStep("token");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not switch to Avalanche. Approve the network switch in your wallet."
      );
    } finally {
      setBusy(false);
    }
  }, [switchChainAsync]);

  const handlePay = useCallback(
    async (token?: AvalancheShopPaymentToken) => {
      const payToken = token ?? selectedToken;
      if (!product || !productId || !payToken || !address) return;

      if (!sessionMatchesWallet) {
        setError(
          new WalletSessionMismatchError(address, walletAddress).message
        );
        return;
      }

      const option = tokenOptions.find(
        (entry) => entry.token.id === payToken.id
      );
      if (!option?.sufficient) {
        setError(
          `Not enough ${payToken.symbol} on Avalanche. You need ${formatShopPrice(product.priceUsd)} USDC in this wallet plus AVAX for gas.`
        );
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
          args: [AVALANCHE_SHOP_RECIPIENT_ADDRESS, option.requiredAmount],
          chainId: AVALANCHE_CHAIN_ID,
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
                ? "Payment submitted on Avalanche. Confirmation is still catching up — tap Confirm payment (do not pay again)."
                : formatChainError(confirmErr) || "Could not confirm purchase."
            );
            return;
          }
        }
        setStep("token");
        setError(formatChainError(err) || "Payment was cancelled or failed.");
      } finally {
        setBusy(false);
      }
    },
    [
      product,
      productId,
      selectedToken,
      address,
      walletAddress,
      sessionMatchesWallet,
      tokenOptions,
      writeContractAsync,
      confirmPurchase,
    ]
  );

  const handleConfirmPendingTx = useCallback(async () => {
    if (!product || !selectedToken || !txHash) return;
    await confirmPurchase(txHash, selectedToken, product);
  }, [product, selectedToken, txHash, confirmPurchase]);

  const handleTokenSelect = useCallback(
    (token: AvalancheShopPaymentToken, sufficient: boolean) => {
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
  const showTokenStep =
    step === "token" && onAvalanche && hasWallet && sessionMatchesWallet;
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
        aria-labelledby="spark-shop-avalanche-payment-title"
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

          <h2
            id="spark-shop-avalanche-payment-title"
            className="spark-panel__title"
          >
            {product.name}
          </h2>
          <p className="spark-shop-payment__price">
            {formatShopPrice(product.priceUsd)} on Avalanche
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
                onClick={() => void handleReconnectWallet()}
                disabled={busy}
              >
                Connect wallet
              </button>
            </div>
          )}

          {hasWallet && address && !sessionMatchesWallet && (
            <p className="spark-shop-payment__error" role="alert">
              {new WalletSessionMismatchError(address, walletAddress).message}
            </p>
          )}

          {hasWallet && address && !sessionMatchesWallet && (
            <div className="spark-shop-payment__section">
              <button
                type="button"
                className="spark-shop-payment__primary"
                onClick={() => void handleReconnectWallet()}
              >
                Reconnect wallet
              </button>
            </div>
          )}

          {hasWallet && step === "network" && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                Switch to Avalanche C-Chain to pay with USDC.
              </p>
              <button
                type="button"
                className="spark-shop-payment__primary"
                onClick={() => void handleSwitchNetwork()}
                disabled={busy}
              >
                {busy ? "Switching…" : "Switch to Avalanche"}
              </button>
            </div>
          )}

          {showTokenStep && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                Tap USDC to pay. Your wallet will send USDC to ArcadeX. Gas is
                paid in AVAX on Avalanche.
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
                  on Avalanche.
                </p>
              )}
            </div>
          )}

          {(step === "paying" || step === "confirming") && (
            <div className="spark-shop-payment__section">
              <p className="spark-panel__loading">
                {step === "confirming"
                  ? "Confirming payment on Avalanche…"
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
