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
import { PRIMARY_EVM_CHAIN_ID, primaryEvmChain } from "@/lib/chains";
import { connect as connectStarknet, disconnect as disconnectStarknet } from "starknetkit";
import { InjectedConnector } from "starknetkit/injected";
import type { Connector } from "starknetkit";
import { RpcProvider } from "starknet";
import Logo from "@/components/Logo";
import { signInWithEvm, signInWithStarknet, signInWithSui } from "@/lib/wallet-auth-client";
import {
  connectSlushWallet,
  disconnectSlushWallet,
  ensureSlushWalletRegistered,
  signSlushPersonalMessage,
} from "@/lib/sui-wallet-client";
import type { Wallet } from "@mysten/wallet-standard";

export type WalletOption = {
  id: string;
  label: string;
  ecosystem: "evm" | "starknet" | "sui";
  connectorId?: string;
  starknetId?: "braavos" | "argentX";
};

function getEcosystemLabel(ecosystem: WalletOption["ecosystem"]): string {
  switch (ecosystem) {
    case "evm":
      return "EVM";
    case "starknet":
      return "Starknet";
    case "sui":
      return "Sui";
  }
}

const WALLET_OPTIONS: WalletOption[] = [
  { id: "slush", label: "Slush", ecosystem: "sui" },
  { id: "metamask", label: "MetaMask", ecosystem: "evm", connectorId: "metaMaskSDK" },
  { id: "coinbase", label: "Coinbase Wallet", ecosystem: "evm", connectorId: "coinbaseWalletSDK" },
  { id: "walletconnect", label: "WalletConnect", ecosystem: "evm", connectorId: "walletConnect" },
  { id: "braavos", label: "Braavos", ecosystem: "starknet", starknetId: "braavos" },
  { id: "argent", label: "Ready Wallet", ecosystem: "starknet", starknetId: "argentX" },
];

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"wallet" | "network">("wallet");
  const [pendingEvmAddress, setPendingEvmAddress] = useState("");
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
    }
  }, [open]);

  useEffect(() => {
    if (externalError) setError(externalError);
  }, [externalError]);

  async function handleEvmSignIn(connectedAddress: string, activeChainId: number) {
    await signInWithEvm({
      address: connectedAddress,
      chainId: activeChainId,
      signMessageAsync,
    });
  }

  async function completeEvmSignIn(connectedAddress: string, activeChainId: number) {
    if (activeChainId !== PRIMARY_EVM_CHAIN_ID) {
      setPendingEvmAddress(connectedAddress);
      setStep("network");
      return;
    }

    await handleEvmSignIn(connectedAddress, activeChainId);
    onSignedIn();
  }

  async function handleSwitchToMegaEth() {
    if (!pendingEvmAddress) return;

    setBusy(true);
    setError("");

    try {
      await switchChainAsync({ chainId: PRIMARY_EVM_CHAIN_ID });
      await handleEvmSignIn(pendingEvmAddress, PRIMARY_EVM_CHAIN_ID);
      onSignedIn();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not switch to MegaETH. Approve the network switch in your wallet."
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
      if (option.ecosystem === "evm") {
        try {
          await disconnectAsync();
        } catch {
          // ignore
        }
        await disconnectStarknet();
        await disconnectSlushWallet();
        starknetConnectorRef.current = null;
        suiWalletRef.current = null;

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
          chainId: PRIMARY_EVM_CHAIN_ID,
        });
        const connectedAddress = result.accounts[0];
        if (!connectedAddress) {
          throw new Error("Could not read wallet address.");
        }
        const activeChainId = result.chainId ?? chainId ?? PRIMARY_EVM_CHAIN_ID;
        await completeEvmSignIn(connectedAddress, activeChainId);
        return;
      }

      if (option.ecosystem === "sui") {
        try {
          await disconnectAsync();
        } catch {
          // ignore
        }
        await disconnectStarknet();
        await disconnectSlushWallet();
        starknetConnectorRef.current = null;
        suiWalletRef.current = null;

        const { wallet, account } = await connectSlushWallet();
        suiWalletRef.current = wallet;

        await signInWithSui({
          address: account.address,
          signPersonalMessage: async (message) =>
            signSlushPersonalMessage(wallet, account, message),
        });
      } else {
        try {
          await disconnectAsync();
        } catch {
          // ignore
        }
        await disconnectStarknet();
        await disconnectSlushWallet();
        starknetConnectorRef.current = null;
        suiWalletRef.current = null;

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
              {WALLET_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="wallet-option"
                  disabled={busy}
                  onClick={() => handleSelect(option)}
                >
                  <span className="wallet-option__label">{option.label}</span>
                  <span className="wallet-option__chain">
                    {getEcosystemLabel(option.ecosystem)}
                  </span>
                </button>
              ))}
            </div>

            {busy && (
              <p className="connect-modal-status">Connecting and signing in…</p>
            )}
          </>
        ) : (
          <>
            <h2 id="connect-modal-title" className="player-modal-title">
              Switch to MegaETH
            </h2>
            <p className="player-modal-hint">
              Your wallet is connected, but you&apos;re not on{" "}
              <strong>{primaryEvmChain.name}</strong> yet. Switch networks in
              your wallet to continue.
            </p>

            <div className="network-switch-card">
              <span className="network-switch-card__label">Required network</span>
              <span className="network-switch-card__name">{primaryEvmChain.name}</span>
              <span className="network-switch-card__id">
                Chain ID {PRIMARY_EVM_CHAIN_ID}
              </span>
            </div>

            <button
              type="button"
              className="player-modal-submit network-switch-btn"
              disabled={busy}
              onClick={handleSwitchToMegaEth}
            >
              {busy ? "Switching…" : "Switch to MegaETH"}
            </button>

            <button
              type="button"
              className="network-switch-back"
              disabled={busy}
              onClick={() => {
                setStep("wallet");
                setPendingEvmAddress("");
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
