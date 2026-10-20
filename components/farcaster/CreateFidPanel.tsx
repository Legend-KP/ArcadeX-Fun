"use client";

import { useState } from "react";
import { useAccount, useConnect, useSignTypedData } from "wagmi";
import TurnstileWidget from "@/components/farcaster/TurnstileWidget";

type Props = {
  onCreated: () => void;
};

type SignPayload = {
  message: {
    to: `0x${string}`;
    recovery: `0x${string}`;
    nonce: string;
    deadline: number;
  };
  error?: string;
};

export default function CreateFidPanel({ onCreated }: Props) {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { signTypedDataAsync } = useSignTypedData();
  const [fname, setFname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

  async function connectWallet() {
    setError("");
    const connector =
      connectors.find((item) => item.id === "metaMask") ??
      connectors.find((item) => item.type === "injected") ??
      connectors[0];
    if (!connector) {
      setError("No EVM wallet found in this browser.");
      return;
    }
    try {
      await connectAsync({ connector });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet connection cancelled.");
    }
  }

  async function createAccount() {
    if (!address) return;
    setBusy(true);
    setError("");
    try {
      const reserved = await fetch("/api/farcaster/fid/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          custodyAddress: address,
          turnstileToken,
        }),
      });
      const reservedBody = (await reserved.json()) as {
        fid?: number;
        error?: string;
      };
      if (!reserved.ok || typeof reservedBody.fid !== "number") {
        throw new Error(reservedBody.error || "Could not reserve a FID.");
      }

      const signRes = await fetch(
        `/api/farcaster/fid/sign-data?address=${address}`
      );
      const signBody = (await signRes.json()) as SignPayload;
      if (!signRes.ok) {
        throw new Error(signBody.error || "Could not prepare the signature.");
      }

      const signature = await signTypedDataAsync({
        domain: {
          name: "Farcaster IdGateway",
          version: "1",
          chainId: 10,
          verifyingContract: "0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69",
        },
        types: {
          Register: [
            { name: "to", type: "address" },
            { name: "recovery", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Register",
        message: {
          to: signBody.message.to,
          recovery: signBody.message.recovery,
          nonce: BigInt(signBody.message.nonce),
          deadline: BigInt(signBody.message.deadline),
        },
      });

      const registered = await fetch("/api/farcaster/fid/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fid: reservedBody.fid,
          signature,
          custodyAddress: address,
          deadline: signBody.message.deadline,
          recoveryAddress: signBody.message.recovery,
          fname: fname.trim() || undefined,
          turnstileToken,
        }),
      });
      const registeredBody = (await registered.json()) as { error?: string };
      if (!registered.ok) {
        throw new Error(registeredBody.error || "Registration failed.");
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sx-card">
      <h2>Create a Farcaster account</h2>
      <p className="sx-muted">
        For wallets that do not already have a FID. ArcadeX pays the
        registration fee. You only sign a message. No ETH is sent to your
        wallet.
      </p>
      {!isConnected || !address ? (
        <div className="sx-row">
          <button type="button" onClick={() => void connectWallet()} disabled={isPending}>
            Connect EVM wallet
          </button>
        </div>
      ) : (
        <>
          <p className="sx-meta">Wallet {address}</p>
          <div className="sx-row">
            <input
              placeholder="Farcaster name (optional)"
              value={fname}
              onChange={(e) => setFname(e.target.value.toLowerCase())}
            />
            <button type="button" onClick={() => void createAccount()} disabled={busy}>
              {busy ? "Creating…" : "Create FID"}
            </button>
          </div>
          <TurnstileWidget onToken={setTurnstileToken} />
        </>
      )}
      {error && <p className="sx-error">{error}</p>}
    </section>
  );
}
