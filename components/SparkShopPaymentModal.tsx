"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  useAccount,
  useChainId,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { formatUnits } from "viem";
import { PRIMARY_EVM_CHAIN_ID, primaryEvmChain } from "@/lib/chains";
import { purchaseSparkItem } from "@/lib/spark-client";
import {
  erc20Abi,
  formatShopPrice,
  SHOP_PRODUCTS,
  SHOP_PAYMENT_TOKENS,
  SHOP_RECIPIENT_ADDRESS,
  shopPriceToAmount,
  type ShopPaymentToken,
  type ShopProductId,
} from "@/lib/shop";

interface SparkShopPaymentModalProps {
  open: boolean;
  productId: ShopProductId | null;
  playerId: string;
  onClose: () => void;
  onSuccess: () => void;
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
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<PaymentStep>("token");
  const [selectedToken, setSelectedToken] = useState<ShopPaymentToken | null>(
    null
  );
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onMegaEth = chainId === PRIMARY_EVM_CHAIN_ID;

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
    if (!product) return [];

    return SHOP_PAYMENT_TOKENS.map((token, index) => {
      const balanceResult = contractData?.[index * 2];
      const decimalsResult = contractData?.[index * 2 + 1];
      const balance: bigint =
        balanceResult?.status === "success"
          ? BigInt(balanceResult.result)
          : BigInt(0);
      const decimals =
        decimalsResult?.status === "success" ? Number(decimalsResult.result) : 6;
      const requiredAmount = shopPriceToAmount(product.priceUsd, decimals);
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
  }, [contractData, product]);

  const { isLoading: confirmingTx, isSuccess: txConfirmed } =
    useWaitForTransactionReceipt({
      hash: txHash,
      chainId: PRIMARY_EVM_CHAIN_ID,
    });

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
    setStep(onMegaEth ? "token" : "network");
  }, [open, onMegaEth]);

  useEffect(() => {
    if (!open || !product || selectedToken || balancesLoading) return;

    const affordable = tokenOptions.filter((option) => option.sufficient);
    if (affordable.length === 1) {
      setSelectedToken(affordable[0]!.token);
    }
  }, [open, product, selectedToken, balancesLoading, tokenOptions]);

  useEffect(() => {
    if (!txHash || !txConfirmed || !product || !selectedToken) return;

    let cancelled = false;

    async function confirmPurchase() {
      setStep("confirming");
      setBusy(true);
      setError("");

      try {
        await purchaseSparkItem({
          playerId,
          productId: product!.id,
          txHash: txHash!,
          tokenAddress: selectedToken!.address,
        });

        if (cancelled) return;
        onSuccess();
        onClose();
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Could not confirm purchase."
        );
        setStep("token");
      } finally {
        if (!cancelled) {
          setBusy(false);
          setTxHash(undefined);
        }
      }
    }

    void confirmPurchase();

    return () => {
      cancelled = true;
    };
  }, [
    txHash,
    txConfirmed,
    product,
    selectedToken,
    playerId,
    onSuccess,
    onClose,
  ]);

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
          : "Could not switch to MegaETH. Approve the network switch in your wallet."
      );
    } finally {
      setBusy(false);
    }
  }, [switchChainAsync]);

  const handlePay = useCallback(async () => {
    if (!product || !selectedToken || !address) return;

    const option = tokenOptions.find(
      (entry) => entry.token.id === selectedToken.id
    );
    if (!option?.sufficient) {
      setError(`Not enough ${selectedToken.symbol} for this purchase.`);
      return;
    }

    setBusy(true);
    setError("");
    setStep("paying");

    try {
      const hash = await writeContractAsync({
        address: selectedToken.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [SHOP_RECIPIENT_ADDRESS, option.requiredAmount],
        chainId: PRIMARY_EVM_CHAIN_ID,
      });

      setTxHash(hash);
    } catch (err) {
      setStep("token");
      setError(
        err instanceof Error ? err.message : "Payment was cancelled or failed."
      );
    } finally {
      setBusy(false);
    }
  }, [
    product,
    selectedToken,
    address,
    tokenOptions,
    writeContractAsync,
  ]);

  if (!open || !product || !mounted) return null;

  const affordableCount = tokenOptions.filter((option) => option.sufficient)
    .length;

  const modal = (
    <div
      className="spark-panel-backdrop"
      role="presentation"
      onClick={busy || confirmingTx ? undefined : onClose}
    >
      <div
        className="spark-shop-payment"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spark-shop-payment-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="spark-panel__close"
          onClick={onClose}
          disabled={busy || confirmingTx}
          aria-label="Close"
        >
          ×
        </button>

        <h2 id="spark-shop-payment-title" className="spark-panel__title">
          {product.name}
        </h2>
        <p className="spark-shop-payment__price">
          {formatShopPrice(product.priceUsd)} on MegaETH
        </p>
        <p className="spark-shop-payment__desc">{product.description}</p>

        {!isConnected && (
          <p className="spark-shop-payment__error" role="alert">
            Connect your wallet to continue.
          </p>
        )}

        {step === "network" && (
          <div className="spark-shop-payment__section">
            <p className="spark-shop-payment__hint">
              Switch to {primaryEvmChain.name} to pay with USDm or USDT0.
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

        {step === "token" && onMegaEth && (
          <div className="spark-shop-payment__section">
            <p className="spark-shop-payment__hint">
              Choose a payment token. We will send the exact amount to complete
              your purchase.
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
                    onClick={() => {
                      if (!option.sufficient) return;
                      setSelectedToken(option.token);
                      setError("");
                    }}
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
                You need at least {formatShopPrice(product.priceUsd)} in USDm or
                USDT0 on MegaETH.
              </p>
            )}

            <button
              type="button"
              className="spark-shop-payment__primary"
              onClick={() => void handlePay()}
              disabled={
                busy ||
                balancesLoading ||
                !selectedToken ||
                affordableCount === 0
              }
            >
              Pay {formatShopPrice(product.priceUsd)}
            </button>
          </div>
        )}

        {(step === "paying" || step === "confirming" || confirmingTx) && (
          <div className="spark-shop-payment__section">
            <p className="spark-panel__loading">
              {step === "confirming" || confirmingTx
                ? "Confirming payment and unlocking your purchase…"
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
    </div>
  );

  return createPortal(modal, document.body);
}
