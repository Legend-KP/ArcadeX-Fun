"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { purchaseSparkItem } from "@/lib/spark-client";
import {
  formatShopPrice,
  SHOP_PRODUCTS,
  SHOP_TOKEN_DECIMALS,
  shopPriceToAmount,
  type ShopProductId,
  type ShopPurchaseSuccess,
} from "@/lib/shop";
import {
  SUI_SHOP_PAYMENT_TOKEN,
  SUI_SHOP_RECIPIENT_ADDRESS,
} from "@/lib/shop-sui";
import {
  fetchSuiCoinBalance,
  reconnectSlushWallet,
  transferSlushUsdc,
} from "@/lib/sui-wallet-client";
import type { Wallet, WalletAccount } from "@mysten/wallet-standard";

interface SparkShopSuiPaymentModalProps {
  open: boolean;
  productId: ShopProductId | null;
  playerId: string;
  walletAddress: string;
  onClose: () => void;
  onSuccess: (purchase: ShopPurchaseSuccess) => void;
}

type PaymentStep = "wallet" | "paying" | "confirming";

function formatUsdcBalance(balance: bigint): string {
  const value = Number(balance) / 10 ** SHOP_TOKEN_DECIMALS;
  if (!Number.isFinite(value)) return "0";
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export default function SparkShopSuiPaymentModal({
  open,
  productId,
  playerId,
  walletAddress,
  onClose,
  onSuccess,
}: SparkShopSuiPaymentModalProps) {
  const product = productId ? SHOP_PRODUCTS[productId] : null;
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<PaymentStep>("wallet");
  const [walletSession, setWalletSession] = useState<{
    wallet: Wallet;
    account: WalletAccount;
  } | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const requiredAmount = product
    ? shopPriceToAmount(product.priceUsd, SHOP_TOKEN_DECIMALS)
    : BigInt(0);
  const sufficient =
    balance !== null && product !== null && balance >= requiredAmount;

  const loadWalletAndBalance = useCallback(async () => {
    if (!walletAddress || !product) return;

    setBalancesLoading(true);
    setError("");

    try {
      const session = await reconnectSlushWallet();
      setWalletSession(session);

      const nextBalance = await fetchSuiCoinBalance(
        walletAddress,
        SUI_SHOP_PAYMENT_TOKEN.coinType
      );
      setBalance(nextBalance);
    } catch (err) {
      setWalletSession(null);
      setBalance(null);
      setError(
        err instanceof Error
          ? err.message
          : "Could not connect Slush wallet for payment."
      );
    } finally {
      setBalancesLoading(false);
    }
  }, [walletAddress, product]);

  const confirmPurchase = useCallback(
    async (digest: string, purchasedProduct: NonNullable<typeof product>) => {
      setStep("confirming");
      setBusy(true);
      setError("");

      try {
        await purchaseSparkItem({
          playerId,
          productId: purchasedProduct.id,
          txHash: digest,
        });

        onSuccess({
          productId: purchasedProduct.id,
          txHash: digest,
          tokenSymbol: SUI_SHOP_PAYMENT_TOKEN.symbol,
          network: "sui",
        });
        onClose();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not confirm purchase."
        );
        setStep("wallet");
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
      setStep("wallet");
      setWalletSession(null);
      setBalance(null);
      setBusy(false);
      setError("");
      return;
    }

    void loadWalletAndBalance();
  }, [open, loadWalletAndBalance]);

  const handlePay = useCallback(async () => {
    if (!product || !walletSession || !sufficient) return;

    setBusy(true);
    setError("");
    setStep("paying");

    try {
      const digest = await transferSlushUsdc({
        wallet: walletSession.wallet,
        account: walletSession.account,
        recipient: SUI_SHOP_RECIPIENT_ADDRESS,
        amount: requiredAmount,
        coinType: SUI_SHOP_PAYMENT_TOKEN.coinType,
      });

      await confirmPurchase(digest, product);
    } catch (err) {
      setStep("wallet");
      setError(
        err instanceof Error ? err.message : "Payment was cancelled or failed."
      );
    } finally {
      setBusy(false);
    }
  }, [
    product,
    walletSession,
    sufficient,
    requiredAmount,
    confirmPurchase,
  ]);

  if (!open || !product || !mounted) return null;

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
        aria-labelledby="spark-shop-sui-payment-title"
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

          <h2 id="spark-shop-sui-payment-title" className="spark-panel__title">
            {product.name}
          </h2>
          <p className="spark-shop-payment__price">
            {formatShopPrice(product.priceUsd)} on Sui
          </p>
          <p className="spark-shop-payment__desc">{product.description}</p>

          {step === "wallet" && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                Pay with USDC on Sui mainnet. Your Slush wallet will open to
                approve the transfer.
              </p>

              {balancesLoading ? (
                <p className="spark-panel__loading">Loading USDC balance…</p>
              ) : walletSession ? (
                <div className="spark-shop-payment__tokens">
                  <button
                    type="button"
                    className={`spark-shop-payment__token${
                      sufficient ? "" : " is-disabled"
                    }`}
                    onClick={() => void handlePay()}
                    disabled={!sufficient || busy}
                  >
                    <span className="spark-shop-payment__token-name">
                      {SUI_SHOP_PAYMENT_TOKEN.symbol}
                    </span>
                    <span className="spark-shop-payment__token-balance">
                      Balance:{" "}
                      {balance !== null ? formatUsdcBalance(balance) : "0"}
                    </span>
                    {!sufficient && (
                      <span className="spark-shop-payment__token-note">
                        Insufficient balance
                      </span>
                    )}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="spark-shop-payment__primary"
                  onClick={() => void loadWalletAndBalance()}
                  disabled={busy}
                >
                  Connect Slush wallet
                </button>
              )}

              {walletSession && !sufficient && !balancesLoading && (
                <p className="spark-shop-payment__error" role="alert">
                  You need at least {formatShopPrice(product.priceUsd)} in USDC
                  on Sui.
                </p>
              )}
            </div>
          )}

          {(step === "paying" || step === "confirming") && (
            <div className="spark-shop-payment__section">
              <p className="spark-panel__loading">
                {step === "confirming"
                  ? "Confirming payment on Sui…"
                  : "Approve the transfer in your wallet…"}
              </p>
            </div>
          )}

          {error ? (
            <p className="spark-shop-payment__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        {step === "wallet" && walletSession && sufficient && !busy && (
          <div className="spark-shop-payment__footer">
            <button
              type="button"
              className="spark-shop-payment__primary"
              onClick={() => void handlePay()}
              disabled={busy}
            >
              Pay {formatShopPrice(product.priceUsd)} with USDC
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
