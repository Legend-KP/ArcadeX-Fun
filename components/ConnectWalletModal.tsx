"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useAccount,
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
import {
  CHAIN_REGISTRY,
  WALLET_OPTIONS,
  type WalletOption,
} from "@/lib/chain-registry";
import { useChainSettings } from "@/components/ChainSettingsProvider";
import { connect as connectStarknet, disconnect as disconnectStarknet } from "starknetkit";
import { InjectedConnector } from "starknetkit/injected";
import type { Connector } from "starknetkit";
import { RpcProvider } from "starknet";
import Logo from "@/components/Logo";
import {
  prefetchAuthNonce,
  signInWithAptos,
  signInWithEvm,
  signInWithMovement,
  signInWithStarknet,
  signInWithStellar,
  signInWithSui,
  signInWithVara,
  type AuthSessionPayload,
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
import {
  connectVaraWallet,
  signVaraMessage,
  warmVaraWallet,
} from "@/lib/vara-wallet-client";
import { getEcosystemLabel } from "@/lib/wallet-ecosystems";
import { setCachedWalletConnectorId } from "@/lib/player-id";
import type { ChainKey, WalletEcosystem } from "@/types";
import type { Wallet } from "@mysten/wallet-standard";

export type { WalletOption };

type ConnectStep = "select-network" | "select-wallet" | "switch-network";

interface ConnectWalletModalProps {
  open: boolean;
  error?: string;
  onSignedIn: (session?: AuthSessionPayload) => void;
  onClose?: () => void;
}

export default function ConnectWalletModal({
  open,
  error: externalError,
  onSignedIn,
}: ConnectWalletModalProps) {
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { address: connectedEvmAddress, connector: activeConnector } =
    useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { isWalletOptionEnabled } = useChainSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<ConnectStep>("select-network");
  const [selectedChainKey, setSelectedChainKey] = useState<ChainKey | null>(
    null
  );
  const [pendingEvmAddress, setPendingEvmAddress] = useState("");
  const [pendingConnectorId, setPendingConnectorId] = useState("");
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
      setStep("select-network");
      setSelectedChainKey(null);
      setPendingEvmAddress("");
      setPendingConnectorId("");
      setPendingChainId(PRIMARY_EVM_CHAIN_ID);
    }
  }, [open]);

  useEffect(() => {
    if (externalError) setError(externalError);
  }, [externalError]);

  /** Clear other ecosystems in parallel — never disconnect the wallet we are about to use. */
  async function clearConflictingWallets(target: WalletEcosystem) {
    const tasks: Promise<unknown>[] = [];

    if (target !== "evm") {
      tasks.push(disconnectAsync().catch(() => undefined));
    }
    if (target !== "starknet") {
      tasks.push(disconnectStarknet().catch(() => undefined));
      starknetConnectorRef.current = null;
    }
    if (target !== "sui") {
      tasks.push(disconnectSlushWallet().catch(() => undefined));
      suiWalletRef.current = null;
    }
    if (target !== "aptos") {
      tasks.push(disconnectPetraWallet().catch(() => undefined));
    }
    if (target !== "movement") {
      tasks.push(disconnectMovementWallet().catch(() => undefined));
    }

    if (tasks.length) {
      await Promise.allSettled(tasks);
    }
  }

  async function handleEvmSignIn(connectedAddress: string, activeChainId: number) {
    return signInWithEvm({
      address: connectedAddress,
      chainId: activeChainId,
      signMessageAsync,
    });
  }

  async function completeEvmSignIn(
    connectedAddress: string,
    activeChainId: number,
    targetChainId: number,
    connectorId: string
  ) {
    if (activeChainId !== targetChainId) {
      setPendingEvmAddress(connectedAddress);
      setPendingConnectorId(connectorId);
      setPendingChainId(targetChainId);
      setStep("switch-network");
      setCachedWalletConnectorId(connectorId);
      return;
    }

    setCachedWalletConnectorId(connectorId);
    const session = await handleEvmSignIn(connectedAddress, activeChainId);
    onSignedIn(session);
  }

  async function handleSwitchEvmChain() {
    if (!pendingEvmAddress) return;

    setBusy(true);
    setError("");

    try {
      await switchChainAsync({ chainId: pendingChainId });
      const session = await handleEvmSignIn(pendingEvmAddress, pendingChainId);
      onSignedIn(session);
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

    return signInWithStarknet({
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
    prefetchAuthNonce();

    try {
      await clearConflictingWallets(option.ecosystem);

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

        // Reuse an already-open MetaMask/etc. session when possible.
        const sameConnector =
          activeConnector &&
          (activeConnector.id === connector.id ||
            activeConnector.name.toLowerCase() === connector.name.toLowerCase());

        if (sameConnector && connectedEvmAddress) {
          let activeChainId = chainId ?? targetChainId;
          if (activeChainId !== targetChainId) {
            try {
              await switchChainAsync({ chainId: targetChainId });
              activeChainId = targetChainId;
            } catch {
              await completeEvmSignIn(
                connectedEvmAddress,
                activeChainId,
                targetChainId,
                connector.id
              );
              return;
            }
          }
          await completeEvmSignIn(
            connectedEvmAddress,
            activeChainId,
            targetChainId,
            connector.id
          );
          return;
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
        await completeEvmSignIn(
          connectedAddress,
          activeChainId,
          targetChainId,
          connector.id
        );
        return;
      }

      let session: AuthSessionPayload;

      if (option.ecosystem === "sui") {
        const { wallet, account } = await connectSlushWallet();
        suiWalletRef.current = wallet;

        session = await signInWithSui({
          address: account.address,
          signPersonalMessage: async (message) =>
            signSlushPersonalMessage(wallet, account, message),
        });
      } else if (option.ecosystem === "aptos") {
        const { address, publicKey } = await connectPetraWallet();
        session = await signInWithAptos({
          address,
          publicKey,
          signMessage: (nonce) => signPetraMessage(nonce, publicKey),
        });
      } else if (option.ecosystem === "movement") {
        const { address, publicKey } = await connectMovementWallet();
        session = await signInWithMovement({
          address,
          publicKey,
          signMessage: (nonce) => signMovementMessage(nonce, publicKey),
        });
      } else if (option.ecosystem === "stellar") {
        await connectFreighterWallet();
        session = await signInWithStellar({
          signMessage: signFreighterMessage,
        });
      } else if (option.ecosystem === "vara") {
        const address = await connectVaraWallet();
        session = await signInWithVara({
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
        session = await handleStarknetSignIn(connector, walletAddress);
      }

      onSignedIn(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect wallet.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const requiredChain = getEvmChainById(pendingChainId) ?? primaryEvmChain;
  const visibleWalletOptions = WALLET_OPTIONS.filter(isWalletOptionEnabled);
  const availableNetworks = CHAIN_REGISTRY.filter((chain) =>
    visibleWalletOptions.some((option) => option.chainKey === chain.key)
  );
  const selectedNetwork = selectedChainKey
    ? CHAIN_REGISTRY.find((chain) => chain.key === selectedChainKey)
    : undefined;
  const walletsForNetwork = selectedChainKey
    ? visibleWalletOptions.filter(
        (option) => option.chainKey === selectedChainKey
      )
    : [];

  function goBackToNetworks() {
    setStep("select-network");
    setSelectedChainKey(null);
    setPendingEvmAddress("");
    setPendingConnectorId("");
    setPendingChainId(PRIMARY_EVM_CHAIN_ID);
    setError("");
  }

  function goBackToWallets() {
    setStep("select-wallet");
    setPendingEvmAddress("");
    setPendingConnectorId("");
    setPendingChainId(PRIMARY_EVM_CHAIN_ID);
    setError("");
  }

  function selectNetwork(chainKey: ChainKey) {
    const chain = CHAIN_REGISTRY.find((entry) => entry.key === chainKey);
    setSelectedChainKey(chainKey);
    setError("");
    setStep("select-wallet");
    prefetchAuthNonce();
    if (chain?.ecosystem === "vara") {
      warmVaraWallet();
    }
  }

  const modal = (
    <div className="player-modal-backdrop">
      <div
        className="connect-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-modal-title"
      >
        <Logo variant="login" />
        {step === "select-network" ? (
          <>
            <h2 id="connect-modal-title" className="player-modal-title">
              Choose a network
            </h2>
            <p className="player-modal-hint">
              Pick the network you want to connect with ArcadeX. Daily Streak
              is available on Base.
            </p>

            <div className="wallet-list">
              {availableNetworks.length === 0 ? (
                <p className="player-modal-hint">
                  No wallet connections are available right now. Please check
                  back later.
                </p>
              ) : (
                availableNetworks.map((chain) => {
                  const isBaseMainnet =
                    chain.key === "base" &&
                    chain.chainId === PRIMARY_EVM_CHAIN_ID;
                  return (
                    <button
                      key={chain.key}
                      type="button"
                      className="wallet-option"
                      disabled={busy}
                      onClick={() => selectNetwork(chain.key)}
                    >
                      <span className="wallet-option__label">
                        {chain.name}
                        {isBaseMainnet ? (
                          <span className="wallet-option__badge">
                            Daily Streak
                          </span>
                        ) : null}
                      </span>
                      <span className="wallet-option__chain">
                        {getEcosystemLabel(chain.ecosystem)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </>
        ) : step === "select-wallet" ? (
          <>
            <h2 id="connect-modal-title" className="player-modal-title">
              Connect your wallet
            </h2>
            <p className="player-modal-hint">
              Wallets available on{" "}
              <strong>{selectedNetwork?.name ?? "this network"}</strong>.
            </p>

            <div className="wallet-list">
              {walletsForNetwork.length === 0 ? (
                <p className="player-modal-hint">
                  No wallets are available for this network right now.
                </p>
              ) : (
                walletsForNetwork.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="wallet-option"
                    disabled={busy}
                    onClick={() => handleSelect(option)}
                  >
                    <span className="wallet-option__label">{option.label}</span>
                  </button>
                ))
              )}
            </div>

            <button
              type="button"
              className="network-switch-back"
              disabled={busy}
              onClick={goBackToNetworks}
            >
              Choose a different network
            </button>

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
              onClick={goBackToWallets}
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
