"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useConnect,
  useDisconnect,
  useSignMessage,
  useChainId,
  useSwitchChain,
} from "wagmi";
import {
  PRIMARY_EVM_CHAIN_ID,
  getEvmChainById,
  primaryEvmChain,
} from "@/lib/chains";
import { WALLET_OPTIONS, type WalletOption } from "@/lib/chain-registry";
import { useChainSettings } from "@/components/ChainSettingsProvider";
import { connect as connectStarknet, disconnect as disconnectStarknet } from "starknetkit";
import { InjectedConnector } from "starknetkit/injected";
import type { Connector } from "starknetkit";
import { RpcProvider } from "starknet";
import Logo from "@/components/Logo";
import {
  signInWithAptos,
  signInWithEvm,
  signInWithMovement,
  signInWithStarknet,
  signInWithStellar,
  signInWithSui,
  signInWithVara,
} from "@/lib/wallet-auth-client";
import {
  connectSlushWallet,
  disconnectSlushWallet,
  ensureSlushWalletRegistered,
  signSlushPersonalMessage,
} from "@/lib/sui-wallet-client";
import {
  connectPetraWallet,
  disconnectPetraWallet,
  signPetraMessage,
} from "@/lib/aptos-wallet-client";
import {
  connectMovementWallet,
  disconnectMovementWallet,
  signMovementMessage,
} from "@/lib/movement-wallet-client";
import {
  connectFreighterWallet,
  signFreighterMessage,
} from "@/lib/stellar-wallet-client";
import { connectVaraWallet, signVaraMessage } from "@/lib/vara-wallet-client";
import { getEcosystemLabel } from "@/lib/wallet-ecosystems";
import type { WalletEcosystem } from "@/lib/player-identity";
import type { Wallet } from "@mysten/wallet-standard";

export type { WalletOption };

interface ConnectWalletModalProps {
  open: boolean;
  error?: string;
  onSignedIn: () => void;
  onClose?: () => void;
}

export default function ConnectWalletModal({
  open,
  error: externalError,
  onSignedIn,
}: ConnectWalletModalProps) {
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { isWalletOptionEnabled } = useChainSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"wallet" | "network">("wallet");
  const [pendingEvmAddress, setPendingEvmAddress] = useState("");
  const [pendingChainId, setPendingChainId] = useState<number>(PRIMARY_EVM_CHAIN_ID);
  const starknetConnectorRef = useRef<Connector | null>(null);
  const suiWalletRef = useRef<Wallet | null>(null);

  useEffect(() => {
    ensureSlushWalletRegistered();
  }, []);

  useEffect(() => {
    if (!open) {
      setError("");
      setBusy(false);
      setStep("wallet");
      setPendingEvmAddress("");
      setPendingChainId(PRIMARY_EVM_CHAIN_ID);
    }
  }, [open]);

  useEffect(() => {
    if (externalError) setError(externalError);
  }, [externalError]);

  async function disconnectAllWallets() {
    try {
      await disconnectAsync();
    } catch {
      // ignore
    }
    try {
      await disconnectStarknet();
    } catch {
      // ignore
    }
    try {
      await disconnectSlushWallet();
    } catch {
      // ignore
    }
    try {
      await disconnectPetraWallet();
    } catch {
      // ignore
    }
    try {
      await disconnectMovementWallet();
    } catch {
      // ignore
    }
    starknetConnectorRef.current = null;
    suiWalletRef.current = null;
  }

  async function handleEvmSignIn(connectedAddress: string, activeChainId: number) {
    await signInWithEvm({
      address: connectedAddress,
      chainId: activeChainId,
      signMessageAsync,
    });
  }

  async function completeEvmSignIn(
    connectedAddress: string,
    activeChainId: number,
    targetChainId: number
  ) {
    if (activeChainId !== targetChainId) {
      setPendingEvmAddress(connectedAddress);
      setPendingChainId(targetChainId);
      setStep("network");
      return;
    }

    await handleEvmSignIn(connectedAddress, activeChainId);
    onSignedIn();
  }

  async function handleSwitchEvmChain() {
    if (!pendingEvmAddress) return;

    setBusy(true);
    setError("");

    try {
      await switchChainAsync({ chainId: pendingChainId });
      await handleEvmSignIn(pendingEvmAddress, pendingChainId);
      onSignedIn();
    } catch (err) {
      const chain = getEvmChainById(pendingChainId);
      setError(
        err instanceof Error
          ? err.message
          : `Could not switch to ${chain?.name ?? "the required network"}. Approve the network switch in your wallet.`
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleStarknetSignIn(
    connector: Connector,
    walletAddress: string
  ) {
    const provider = new RpcProvider({
      nodeUrl:
        process.env.NEXT_PUBLIC_STARKNET_RPC_URL ||
        "https://starknet-mainnet.public.blastapi.io/rpc/v0_9",
    });
    const account = await connector.account(provider);

    await signInWithStarknet({
      address: walletAddress,
      signTypedData: async (typedData) => {
        const signature = await account.signMessage(typedData);
        if (Array.isArray(signature)) {
          return signature.map((part) => String(part));
        }
        return [String(signature.r), String(signature.s)];
      },
    });
  }

  async function handleSelect(option: WalletOption) {
    setBusy(true);
    setError("");

    try {
      await disconnectAllWallets();

      if (option.ecosystem === "evm") {
        const targetChainId = option.chainId ?? PRIMARY_EVM_CHAIN_ID;
        const connector =
          connectors.find((c) => c.id === option.connectorId) ??
          connectors.find((c) =>
            c.name.toLowerCase().includes(option.label.toLowerCase())
          );
        if (!connector) {
          throw new Error(`${option.label} is not available.`);
        }

        const result = await connectAsync({
          connector,
          chainId: targetChainId,
        });
        const connectedAddress = result.accounts[0];
        if (!connectedAddress) {
          throw new Error("Could not read wallet address.");
        }
        const activeChainId = result.chainId ?? chainId ?? targetChainId;
        await completeEvmSignIn(connectedAddress, activeChainId, targetChainId);
        return;
      }

      if (option.ecosystem === "sui") {
        const { wallet, account } = await connectSlushWallet();
        suiWalletRef.current = wallet;

        await signInWithSui({
          address: account.address,
          signPersonalMessage: async (message) =>
            signSlushPersonalMessage(wallet, account, message),
        });
      } else if (option.ecosystem === "aptos") {
        const { address, publicKey } = await connectPetraWallet();
        await signInWithAptos({
          address,
          publicKey,
          signMessage: (nonce) => signPetraMessage(nonce, publicKey),
        });
      } else if (option.ecosystem === "movement") {
        const { address, publicKey } = await connectMovementWallet();
        await signInWithMovement({
          address,
          publicKey,
          signMessage: (nonce) => signMovementMessage(nonce, publicKey),
        });
      } else if (option.ecosystem === "stellar") {
        await connectFreighterWallet();
        await signInWithStellar({
          signMessage: signFreighterMessage,
        });
      } else if (option.ecosystem === "vara") {
        const address = await connectVaraWallet();
        await signInWithVara({
          address,
          signMessage: (nonce) => signVaraMessage(address, nonce),
        });
      } else {
        const { connector, connectorData } = await connectStarknet({
          modalMode: "neverAsk",
          connectors: [
            new InjectedConnector({
              options: {
                id: option.starknetId!,
                name: option.label,
              },
            }),
          ],
        });

        const walletAddress = connectorData?.account;
        if (!walletAddress || !connector) {
          throw new Error("Could not connect Starknet wallet.");
        }

        starknetConnectorRef.current = connector;
        await handleStarknetSignIn(connector, walletAddress);
      }

      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect wallet.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const requiredChain = getEvmChainById(pendingChainId) ?? primaryEvmChain;
  const visibleWalletOptions = WALLET_OPTIONS.filter(isWalletOptionEnabled);

  const modal = (
    <div className="player-modal-backdrop">
      <div
        className="connect-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-modal-title"
      >
        <Logo variant="login" />
        {step === "wallet" ? (
          <>
            <h2 id="connect-modal-title" className="player-modal-title">
              Connect your wallet
            </h2>

            <div className="wallet-list">
              {visibleWalletOptions.length === 0 ? (
                <p className="player-modal-hint">
                  No wallet connections are available right now. Please check
                  back later.
                </p>
              ) : (
                visibleWalletOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="wallet-option"
                    disabled={busy}
                    onClick={() => handleSelect(option)}
                  >
                    <span className="wallet-option__label">{option.label}</span>
                    <span className="wallet-option__chain">
                      {option.networkLabel ?? getEcosystemLabel(option.ecosystem)}
                    </span>
                  </button>
                ))
              )}
            </div>

            {busy && (
              <p className="connect-modal-status">Connecting and signing in…</p>
            )}
          </>
        ) : (
          <>
            <h2 id="connect-modal-title" className="player-modal-title">
              Switch network
            </h2>
            <p className="player-modal-hint">
              Your wallet is connected, but you&apos;re not on{" "}
              <strong>{requiredChain.name}</strong> yet. Switch networks in
              your wallet to continue.
            </p>

            <div className="network-switch-card">
              <span className="network-switch-card__label">Required network</span>
              <span className="network-switch-card__name">{requiredChain.name}</span>
              <span className="network-switch-card__id">
                Chain ID {pendingChainId}
              </span>
            </div>

            <button
              type="button"
              className="player-modal-submit network-switch-btn"
              disabled={busy}
              onClick={handleSwitchEvmChain}
            >
              {busy ? "Switching…" : `Switch to ${requiredChain.name}`}
            </button>

            <button
              type="button"
              className="network-switch-back"
              disabled={busy}
              onClick={() => {
                setStep("wallet");
                setPendingEvmAddress("");
                setPendingChainId(PRIMARY_EVM_CHAIN_ID);
                setError("");
              }}
            >
              Choose a different wallet
            </button>
          </>
        )}

        {error && <p className="error-msg">{error}</p>}
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : modal;
}
