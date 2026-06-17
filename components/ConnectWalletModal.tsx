"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useConnect,
  useDisconnect,
  useSignMessage,
  useChainId,
} from "wagmi";
import { connect as connectStarknet, disconnect as disconnectStarknet } from "starknetkit";
import { InjectedConnector } from "starknetkit/injected";
import type { Connector } from "starknetkit";
import { RpcProvider } from "starknet";
import Logo from "@/components/Logo";
import { signInWithEvm, signInWithStarknet } from "@/lib/wallet-auth-client";

export type WalletOption = {
  id: string;
  label: string;
  ecosystem: "evm" | "starknet";
  connectorId?: string;
  starknetId?: "braavos" | "argentX";
};

const WALLET_OPTIONS: WalletOption[] = [
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
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const starknetConnectorRef = useRef<Connector | null>(null);

  useEffect(() => {
    if (!open) {
      setError("");
      setBusy(false);
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
        starknetConnectorRef.current = null;

        const connector =
          connectors.find((c) => c.id === option.connectorId) ??
          connectors.find((c) =>
            c.name.toLowerCase().includes(option.label.toLowerCase())
          );
        if (!connector) {
          throw new Error(`${option.label} is not available.`);
        }

        const result = await connectAsync({ connector });
        const connectedAddress = result.accounts[0];
        if (!connectedAddress) {
          throw new Error("Could not read wallet address.");
        }
        await handleEvmSignIn(
          connectedAddress,
          result.chainId ?? chainId ?? 8453
        );
      } else {
        try {
          await disconnectAsync();
        } catch {
          // ignore
        }
        await disconnectStarknet();

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
        <h2 id="connect-modal-title" className="player-modal-title">
          Connect your wallet
        </h2>
        <p className="player-modal-hint">
          Choose a wallet to sign in. Supports Base, Arbitrum, MegaETH, Abstract,
          and Starknet.
        </p>

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
                {option.ecosystem === "evm" ? "EVM" : "Starknet"}
              </span>
            </button>
          ))}
        </div>

        {error && <p className="error-msg">{error}</p>}
        {busy && <p className="connect-modal-status">Connecting and signing in…</p>}
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : modal;
}
