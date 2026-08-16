"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
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
  assertVaraShopRecipientConfigured,
  VARA_SHOP_PAYMENT_TOKENS,
  VARA_SHOP_RECIPIENT_ADDRESS,
  type VaraShopPaymentToken,
} from "@/lib/shop-vara";
import {
  fetchVaraVftBalances,
  transferVaraVftToken,
} from "@/lib/vara-shop-client";
import {
  isVaraPaymentProgramConfigured,
  varaPaymentFee,
  type VaraPaymentKind,
} from "@/lib/vara-payment";

function shopProductToPaymentKind(
  productId: ShopProductId
): VaraPaymentKind | null {
  if (productId === "spark-refill") return "spark-refill";
  if (productId === "infinite-24h") return "infinite-spark";
  return null;
}

interface SparkShopVaraPaymentModalProps {
  open: boolean;
  productId: ShopProductId | null;
  playerId: string;
  walletAddress: string;
  onClose: () => void;
  onSuccess: (purchase: ShopPurchaseSuccess) => void;
}

type PaymentStep = "token" | "paying" | "confirming";

function formatTokenBalance(balance: bigint, decimals: number): string {
  const scale = 10 ** decimals;
  const value = Number(balance) / scale;
  if (!Number.isFinite(value)) return "0";
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export default function SparkShopVaraPaymentModal({
  open,
  productId,
  playerId,
  walletAddress,
  onClose,
  onSuccess,
}: SparkShopVaraPaymentModalProps) {
  const { ensureWalletReady } = usePlayerProfile();
  const product = productId ? SHOP_PRODUCTS[productId] : null;
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

  const tokenOptions = useMemo(() => {
    if (!product) return [];
    const paymentKind = shopProductToPaymentKind(product.id);
    const useProgram =
      paymentKind !== null && isVaraPaymentProgramConfigured(paymentKind);

    return VARA_SHOP_PAYMENT_TOKENS.map((token) => {
      const entry = balances[token.id];
      const decimals = entry?.decimals ?? SHOP_TOKEN_DECIMALS;
      const balance = entry?.balance ?? BigInt(0);
      const requiredAmount = useProgram
        ? varaPaymentFee(paymentKind)
        : shopPriceToAmount(product.priceUsd, decimals);
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
  }, [balances, product]);

  const loadBalances = useCallback(async () => {
    if (!walletAddress || !product) return;

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
  }, [walletAddress, product]);

  const confirmPurchase = useCallback(
    async (
      txHash: string,
      token: VaraShopPaymentToken,
      purchasedProduct: NonNullable<typeof product>
    ) => {
      setStep("confirming");
      setBusy(true);
      setError("");

      try {
        await purchaseSparkItem({
          playerId,
          productId: purchasedProduct.id,
          txHash,
          tokenAddress: token.programId,
        });

        onSuccess({
          productId: purchasedProduct.id,
          txHash,
          tokenSymbol: token.symbol,
          network: "vara",
        });
        onClose();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not confirm purchase."
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
      setBusy(false);
      setError("");
      return;
    }

    void loadBalances();
  }, [open, loadBalances]);

  const handlePay = useCallback(
    async (token?: VaraShopPaymentToken) => {
      const payToken = token ?? selectedToken;
      if (!product || !payToken || !walletAddress) return;

      const option = tokenOptions.find((entry) => entry.token.id === payToken.id);
      if (!option?.sufficient) {
        setError(`Not enough ${payToken.symbol} for this purchase.`);
        return;
      }

      setSelectedToken(payToken);
      setBusy(true);
      setError("");
      setStep("paying");

      try {
        const ready = await ensureWalletReady();
        if (!ready) {
          setStep("token");
          setError("Reconnect your wallet to this site, then pay.");
          return;
        }

        const paymentKind = shopProductToPaymentKind(product.id);
        const useProgram =
          paymentKind !== null && isVaraPaymentProgramConfigured(paymentKind);

        let txHash: string;
        if (useProgram && paymentKind) {
          const { payVaraPaymentProgram } = await import(
            "@/lib/vara-payment-client"
          );
          const { payTxHash } = await payVaraPaymentProgram({
            kind: paymentKind,
            token: payToken.id,
            fromAddress: walletAddress,
            onStatus: (msg) => setError(msg),
          });
          txHash = payTxHash;
        } else {
          assertVaraShopRecipientConfigured();
          txHash = await transferVaraVftToken({
            tokenProgramId: payToken.programId,
            fromAddress: walletAddress,
            toAddress: VARA_SHOP_RECIPIENT_ADDRESS,
            amount: option.requiredAmount,
            productId: product.id,
          });
        }

        await confirmPurchase(txHash, payToken, product);
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
    [product, selectedToken, walletAddress, tokenOptions, confirmPurchase, ensureWalletReady]
  );

  const handleTokenSelect = useCallback(
    (token: VaraShopPaymentToken, sufficient: boolean) => {
      if (!sufficient || busy) return;

      setSelectedToken(token);
      setError("");
      void handlePay(token);
    },
    [busy, handlePay]
  );

  if (!open || !product || !mounted) return null;

  const affordableCount = tokenOptions.filter((option) => option.sufficient).length;
  const showPayFooter =
    step === "token" && !balancesLoading && affordableCount > 0 && selectedToken;

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
        aria-labelledby="spark-shop-vara-payment-title"
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

          <h2 id="spark-shop-vara-payment-title" className="spark-panel__title">
            {product.name}
          </h2>
          <p className="spark-shop-payment__price">
            {formatShopPrice(product.priceUsd)} on Vara
          </p>
          <p className="spark-shop-payment__desc">{product.description}</p>

          {step === "token" && (
            <div className="spark-shop-payment__section">
              <p className="spark-shop-payment__hint">
                Tap a token to pay. Your wallet will open to approve
                the transfer.
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
                        selectedToken?.id === option.token.id ? " is-selected" : ""
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
                  You need at least {formatShopPrice(product.priceUsd)} in WUSDC
                  or WUSDT on Vara.
                </p>
              )}
            </div>
          )}

          {(step === "paying" || step === "confirming") && (
            <div className="spark-shop-payment__section">
              <p className="spark-panel__loading">
                {step === "confirming"
                  ? "Confirming payment on Vara…"
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

        {showPayFooter && !busy && (
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
