"use client";

import { buildSiweStatement } from "@/lib/auth-message";
import { buildSiweMessage } from "@/lib/siwe-lite";
import { buildStarknetAuthTypedData } from "@/lib/starknet-auth";
import { buildSuiAuthMessage } from "@/lib/sui-auth";
import type { AptosSignMessageOutput } from "@/lib/aptos-auth";
import { WalletEcosystem } from "@/lib/player-identity";

type StarknetTypedData = ReturnType<typeof buildStarknetAuthTypedData>;

export type AuthSessionPayload = {
  playerId: string;
  address: string;
  ecosystem: WalletEcosystem;
  chainId?: number;
};

type VerifyResponse = {
  ok?: boolean;
  playerId?: string;
  address?: string;
  ecosystem?: WalletEcosystem;
  chainId?: number;
  error?: string;
};

/** Prefetch while the user picks a wallet so SIWE is not blocked on nonce RTT. */
let prefetchedNonce: Promise<string> | null = null;

export function prefetchAuthNonce(): void {
  if (prefetchedNonce) return;
  prefetchedNonce = fetchAuthNonce().catch((err) => {
    prefetchedNonce = null;
    throw err;
  });
}

async function takeAuthNonce(): Promise<string> {
  const pending = prefetchedNonce;
  prefetchedNonce = null;
  if (pending) {
    try {
      return await pending;
    } catch {
      // Fall through to a fresh fetch.
    }
  }
  return fetchAuthNonce();
}

export async function fetchAuthNonce(): Promise<string> {
  const res = await fetch("/api/auth/nonce", { cache: "no-store" });
  const data = (await res.json()) as { nonce?: string; error?: string };
  if (!res.ok || !data.nonce) {
    throw new Error(data.error ?? "Could not start sign-in.");
  }
  return data.nonce;
}

function parseAuthSession(
  data: VerifyResponse,
  fallback?: Partial<AuthSessionPayload>
): AuthSessionPayload {
  const playerId = data.playerId ?? fallback?.playerId;
  const address = data.address ?? fallback?.address;
  const ecosystem = data.ecosystem ?? fallback?.ecosystem;
  if (!playerId || !address || !ecosystem) {
    throw new Error(data.error ?? "Sign-in failed.");
  }
  return {
    playerId,
    address,
    ecosystem,
    chainId:
      data.chainId != null
        ? Number(data.chainId)
        : fallback?.chainId != null
          ? Number(fallback.chainId)
          : undefined,
  };
}

async function postAuthVerify(
  body: Record<string, unknown>,
  fallback?: Partial<AuthSessionPayload>
): Promise<AuthSessionPayload> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as VerifyResponse;
  if (!res.ok) {
    throw new Error(data.error ?? "Sign-in failed.");
  }
  return parseAuthSession(data, fallback);
}

export async function signInWithEvm(params: {
  address: string;
  chainId: number;
  signMessageAsync: (args: { message: string }) => Promise<string>;
}): Promise<AuthSessionPayload> {
  const nonce = await takeAuthNonce();
  const domain =
    typeof window !== "undefined" ? window.location.host : "arcadex.fun";
  const uri =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://arcadex.fun";

  const message = buildSiweMessage({
    domain,
    address: params.address,
    statement: buildSiweStatement(),
    uri,
    chainId: params.chainId,
    nonce,
  });
  const signature = await params.signMessageAsync({ message });

  return postAuthVerify(
    {
      ecosystem: "evm" satisfies WalletEcosystem,
      message,
      signature,
      nonce,
      chainId: params.chainId,
    },
    {
      address: params.address,
      ecosystem: "evm",
      chainId: params.chainId,
    }
  );
}

export async function signInWithStarknet(params: {
  address: string;
  signTypedData: (
    typedData: StarknetTypedData
  ) => Promise<string[] | readonly string[]>;
}): Promise<AuthSessionPayload> {
  const nonce = await takeAuthNonce();
  const typedData = buildStarknetAuthTypedData(nonce);
  const signature = await params.signTypedData(typedData);

  return postAuthVerify(
    {
      ecosystem: "starknet" satisfies WalletEcosystem,
      nonce,
      address: params.address,
      signature: JSON.stringify(signature),
    },
    { address: params.address, ecosystem: "starknet" }
  );
}

export async function signInWithSui(params: {
  address: string;
  signPersonalMessage: (message: Uint8Array) => Promise<string>;
}): Promise<AuthSessionPayload> {
  const nonce = await takeAuthNonce();
  const message = buildSuiAuthMessage(nonce);
  const messageBytes = new TextEncoder().encode(message);
  const signature = await params.signPersonalMessage(messageBytes);

  return postAuthVerify(
    {
      ecosystem: "sui" satisfies WalletEcosystem,
      nonce,
      address: params.address,
      message,
      signature,
    },
    { address: params.address, ecosystem: "sui" }
  );
}

export async function signInWithAptos(params: {
  address: string;
  publicKey?: string;
  signMessage: (nonce: string) => Promise<AptosSignMessageOutput>;
}): Promise<AuthSessionPayload> {
  const nonce = await takeAuthNonce();
  const signed = await params.signMessage(nonce);

  return postAuthVerify(
    {
      ecosystem: "aptos" satisfies WalletEcosystem,
      nonce,
      address: params.address,
      signedMessage: { ...signed, publicKey: signed.publicKey ?? params.publicKey },
    },
    { address: params.address, ecosystem: "aptos" }
  );
}

export async function signInWithMovement(params: {
  address: string;
  publicKey?: string;
  signMessage: (nonce: string) => Promise<AptosSignMessageOutput>;
}): Promise<AuthSessionPayload> {
  const nonce = await takeAuthNonce();
  const signed = await params.signMessage(nonce);

  return postAuthVerify(
    {
      ecosystem: "movement" satisfies WalletEcosystem,
      nonce,
      address: params.address,
      signedMessage: { ...signed, publicKey: signed.publicKey ?? params.publicKey },
    },
    { address: params.address, ecosystem: "movement" }
  );
}

export async function signInWithStellar(params: {
  signMessage: (
    nonce: string
  ) => Promise<{ address: string; message: string; signedMessage: string }>;
}): Promise<AuthSessionPayload> {
  const nonce = await takeAuthNonce();
  const result = await params.signMessage(nonce);

  return postAuthVerify(
    {
      ecosystem: "stellar" satisfies WalletEcosystem,
      nonce,
      address: result.address,
      message: result.message,
      signature: result.signedMessage,
    },
    { address: result.address, ecosystem: "stellar" }
  );
}

export async function signInWithVara(params: {
  address: string;
  signMessage: (
    nonce: string
  ) => Promise<{ address: string; message: string; signature: string }>;
}): Promise<AuthSessionPayload> {
  const nonce = await takeAuthNonce();
  const result = await params.signMessage(nonce);

  return postAuthVerify(
    {
      ecosystem: "vara" satisfies WalletEcosystem,
      nonce,
      address: result.address,
      message: result.message,
      signature: result.signature,
    },
    { address: result.address, ecosystem: "vara" }
  );
}
