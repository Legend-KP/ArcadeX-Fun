"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useSignTypedData } from "wagmi";

type SignerCard = {
  generation: number;
  publicKey: string;
  status: string;
  manifest?: string;
};

type SignerStatus = {
  fid: number;
  revokeInstructions: string[];
  active: SignerCard | null;
  pending: SignerCard | null;
  error?: string;
};

type TypedMessage = {
  owner: `0x${string}`;
  keyType: number;
  key: `0x${string}`;
  metadataType: number;
  metadata: `0x${string}`;
  nonce: string;
  deadline: string;
};

type PreparedApproval = {
  custodyAddress: `0x${string}`;
  generation: number;
  publicKey: string;
  manifest: string;
  previousPublicKey?: string;
  revokeInstructions?: string[];
  typedData: {
    domain: {
      name: "Farcaster KeyGateway";
      version: "1";
      chainId: 10;
      verifyingContract: `0x${string}`;
    };
    types: {
      Add: { name: string; type: string }[];
    };
    primaryType: "Add";
    message: TypedMessage;
  };
  error?: string;
};

type RemovePrepared = {
  cancelled?: boolean;
  generation: number;
  publicKey?: string;
  custodyAddress?: `0x${string}`;
  revokeInstructions?: string[];
  typedData?: {
    domain: {
      name: "Farcaster KeyRegistry";
      version: "1";
      chainId: 10;
      verifyingContract: `0x${string}`;
    };
    types: { Remove: { name: string; type: string }[] };
    primaryType: "Remove";
    message: {
      owner: `0x${string}`;
      key: `0x${string}`;
      nonce: string;
      deadline: string;
    };
  };
  error?: string;
};

type TxRequest = {
  chainId: number;
  to: `0x${string}`;
  data: `0x${string}`;
  value: `0x${string}`;
};

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getEthereum(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  const provider = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  return provider ?? null;
}

async function sendOptimismTransaction(
  from: `0x${string}`,
  tx: TxRequest
): Promise<string> {
  const ethereum = getEthereum();
  if (!ethereum) throw new Error("No EVM wallet found in this browser.");
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xa" }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0xa",
          chainName: "Optimism",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.optimism.io"],
          blockExplorerUrls: ["https://optimistic.etherscan.io"],
        },
      ],
    });
  }
  const hash = await ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from, to: tx.to, data: tx.data, value: tx.value }],
  });
  if (typeof hash !== "string" || !hash.startsWith("0x")) {
    throw new Error("The wallet did not return a transaction hash.");
  }
  return hash;
}

export default function SignerApproval() {
  const { address } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { signTypedDataAsync } = useSignTypedData();
  const [status, setStatus] = useState<SignerStatus | null>(null);
  const [prepared, setPrepared] = useState<PreparedApproval | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deeplink, setDeeplink] = useState("");
  const [phoneApproval, setPhoneApproval] = useState("");
  const [narrow, setNarrow] = useState(false);
  const watching = useRef(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/farcaster/signer", { cache: "no-store" });
    const data = (await res.json()) as SignerStatus;
    if (!res.ok) throw new Error(data.error || "Could not load signer status.");
    setStatus(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Could not load signer status.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function ensureCustody(expected: string): Promise<`0x${string}`> {
    let current = address;
    if (!current) {
      const connector =
        connectors.find((item) => item.id === "metaMask") ??
        connectors.find((item) => item.type === "injected") ??
        connectors[0];
      if (!connector) throw new Error("No EVM wallet found in this browser.");
      const connected = await connectAsync({ connector });
      current = connected.accounts[0];
    }
    if (!current || current.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Connect the Farcaster custody wallet ${expected}.`);
    }
    return current;
  }

  async function watchDeeplink(token: string, generation: number) {
    if (watching.current) return;
    watching.current = true;
    try {
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const statusRes = await fetch(
          `/api/farcaster/signer/deeplink?token=${encodeURIComponent(token)}&generation=${generation}`
        );
        const statusBody = (await statusRes.json()) as {
          error?: string;
          state?: string;
          confirmed?: boolean;
        };
        if (!statusRes.ok) {
          throw new Error(statusBody.error || "Could not check the Farcaster approval.");
        }
        if (statusBody.confirmed) {
          sessionStorage.removeItem("arcadex.farcaster.signerDeeplink");
          setPrepared(null);
          setAccepted(false);
          setDeeplink("");
          setPhoneApproval("");
          await load();
          return;
        }
        if (statusBody.state === "approved") {
          setPhoneApproval("Approved in Farcaster. Waiting for Optimism.");
        }
      }
      setPhoneApproval(
        "Still waiting. Open the link on your phone. The Farcaster app shows the approval only after that link opens."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check the Farcaster approval.");
    } finally {
      watching.current = false;
    }
  }

  useEffect(() => {
    const raw = sessionStorage.getItem("arcadex.farcaster.signerDeeplink");
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as {
        token?: string;
        generation?: number;
        url?: string;
      };
      if (!saved.token || !saved.generation || !saved.url) return;
      setDeeplink(saved.url);
      setPhoneApproval("Waiting for the Farcaster app.");
      void watchDeeplink(saved.token, saved.generation);
    } catch {
      sessionStorage.removeItem("arcadex.farcaster.signerDeeplink");
    }
    // Resume once when this panel mounts after the Farcaster app returns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function review(path: "/api/farcaster/signer/prepare" | "/api/farcaster/signer/rotate") {
    setBusy(true);
    setError("");
    setAccepted(false);
    setDeeplink("");
    setPhoneApproval("");
    sessionStorage.removeItem("arcadex.farcaster.signerDeeplink");
    try {
      const res = await fetch(path, {
        method: "POST",
        signal: AbortSignal.timeout(20000),
      });
      const data = (await res.json()) as PreparedApproval;
      if (!res.ok) throw new Error(data.error || "Could not prepare the signer.");
      setPrepared(data);
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "TimeoutError";
      setError(
        timedOut
          ? "Preparing the signer took too long. Refresh the page and try again."
          : err instanceof Error
            ? err.message
            : "Could not prepare the signer."
      );
    } finally {
      setBusy(false);
    }
  }

  async function approveInFarcaster() {
    if (!prepared || !accepted) return;
    setBusy(true);
    setError("");
    setPhoneApproval("");
    try {
      const res = await fetch("/api/farcaster/signer/deeplink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generation: prepared.generation }),
      });
      const data = (await res.json()) as {
        error?: string;
        deeplinkUrl?: string;
        token?: string;
      };
      if (!res.ok || !data.deeplinkUrl || !data.token) {
        throw new Error(data.error || "Could not open Farcaster.");
      }
      setDeeplink(data.deeplinkUrl);
      sessionStorage.setItem(
        "arcadex.farcaster.signerDeeplink",
        JSON.stringify({
          token: data.token,
          generation: prepared.generation,
          url: data.deeplinkUrl,
        })
      );
      await watchDeeplink(data.token, prepared.generation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open Farcaster.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!prepared || !accepted) return;
    setBusy(true);
    setError("");
    try {
      const custody = await ensureCustody(prepared.custodyAddress);
      const message = prepared.typedData.message;
      const signature = await signTypedDataAsync({
        domain: prepared.typedData.domain,
        types: {
          Add: prepared.typedData.types.Add,
        },
        primaryType: "Add",
        message: {
          ...message,
          nonce: BigInt(message.nonce),
          deadline: BigInt(message.deadline),
        },
      });
      const approved = await fetch("/api/farcaster/signer/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generation: prepared.generation, signature }),
      });
      const approvedBody = (await approved.json()) as {
        error?: string;
        transaction?: TxRequest;
      };
      if (!approved.ok || !approvedBody.transaction) {
        throw new Error(approvedBody.error || "Could not verify the approval.");
      }
      const txHash = await sendOptimismTransaction(custody, approvedBody.transaction);
      let confirmed = false;
      let lastError = "The signer is not on the KeyRegistry yet.";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const confirm = await fetch("/api/farcaster/signer/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generation: prepared.generation, txHash }),
        });
        const confirmBody = (await confirm.json()) as { error?: string };
        if (confirm.ok) {
          confirmed = true;
          break;
        }
        lastError = confirmBody.error || lastError;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!confirmed) throw new Error(lastError);
      setPrepared(null);
      setAccepted(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve the signer.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    const generation = status?.active?.generation;
    if (!generation) return;
    setBusy(true);
    setError("");
    try {
      const preparedRevoke = await fetch("/api/farcaster/signer/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generation }),
      });
      const revokeBody = (await preparedRevoke.json()) as RemovePrepared;
      if (!preparedRevoke.ok) {
        throw new Error(revokeBody.error || "Could not start revoke.");
      }
      if (revokeBody.cancelled || !revokeBody.typedData || !revokeBody.custodyAddress) {
        await load();
        return;
      }
      const custody = await ensureCustody(revokeBody.custodyAddress);
      const message = revokeBody.typedData.message;
      const signature = await signTypedDataAsync({
        domain: revokeBody.typedData.domain,
        types: { Remove: revokeBody.typedData.types.Remove },
        primaryType: "Remove",
        message: {
          ...message,
          nonce: BigInt(message.nonce),
          deadline: BigInt(message.deadline),
        },
      });
      const submitted = await fetch("/api/farcaster/signer/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "submit",
          generation,
          signature,
          nonce: message.nonce,
          deadline: message.deadline,
        }),
      });
      const submittedBody = (await submitted.json()) as {
        error?: string;
        transaction?: TxRequest;
      };
      if (!submitted.ok || !submittedBody.transaction) {
        throw new Error(submittedBody.error || "Could not verify the revoke signature.");
      }
      const txHash = await sendOptimismTransaction(custody, submittedBody.transaction);
      const confirmed = await fetch("/api/farcaster/signer/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "confirm", generation, txHash }),
      });
      const confirmedBody = (await confirmed.json()) as { error?: string };
      if (!confirmed.ok) {
        throw new Error(
          confirmedBody.error ||
            "Submit finished. If the key is still listed, remove it in Farcaster settings and refresh."
        );
      }
      setPrepared(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke the signer.");
    } finally {
      setBusy(false);
    }
  }

  const instructions = status?.revokeInstructions ?? [];

  return (
    <section className="signer-approval" aria-label="Farcaster signer">
      {status?.active ? (
        <p>
          Posting to Farcaster as fid {status.fid}. Casts are limited to 10 an hour
          and 40 a day. Signer {status.active.publicKey}
        </p>
      ) : (
        <p>Farcaster posting stays off until you approve a cast-only signer.</p>
      )}

      {prepared && (
        <>
          <pre>{prepared.manifest}</pre>
          {prepared.previousPublicKey && (
            <p>
              After the new key is onchain, remove the previous key {prepared.previousPublicKey}{" "}
              in Farcaster settings. ArcadeX deletes its copy when the new key is confirmed.
            </p>
          )}
          <label className="signer-approval__check">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            I have read this and I approve ArcadeX to publish casts for my fid with this signer.
          </label>
          {narrow ? (
            <button
              type="button"
              disabled={busy || !accepted}
              onClick={() => void approveInFarcaster()}
            >
              {busy ? "Waiting for Farcaster" : "Approve in Farcaster"}
            </button>
          ) : (
            <button type="button" disabled={busy || !accepted} onClick={() => void approve()}>
              {busy ? "Waiting for wallet" : "Sign and add signer"}
            </button>
          )}
          {!narrow && (
            <button
              type="button"
              disabled={busy || !accepted}
              onClick={() => void approveInFarcaster()}
            >
              Approve in the Farcaster app
            </button>
          )}
          {deeplink && (
            <div className="signer-approval__deeplink">
              <p>
                Farcaster does not send a notification. Open this page on the phone
                where the Farcaster app is installed, then tap the button. The approval
                screen appears only after that link opens.
              </p>
              <a className="signer-approval__open" href={deeplink}>
                Open approval in the Farcaster app
              </a>
            </div>
          )}
          {phoneApproval && <p>{phoneApproval}</p>}
        </>
      )}

      {!prepared && !status?.active && (
        <button type="button" disabled={busy} onClick={() => void review("/api/farcaster/signer/prepare")}>
          {busy ? "Preparing" : "Review what ArcadeX can do"}
        </button>
      )}

      {status?.active && !prepared && (
        <div className="signer-approval__actions">
          <button type="button" disabled={busy} onClick={() => void review("/api/farcaster/signer/rotate")}>
            Rotate key
          </button>
          <button type="button" disabled={busy} onClick={() => void revoke()}>
            Remove signer
          </button>
        </div>
      )}

      {instructions.length > 0 && (
        <ul>
          {instructions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {error && <p className="board-error">{error}</p>}
    </section>
  );
}
