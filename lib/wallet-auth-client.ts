"use client";

import { SiweMessage } from "siwe";
import { buildSiweStatement } from "@/lib/auth-message";
import { buildStarknetAuthTypedData } from "@/lib/starknet-auth";
import { buildSuiAuthMessage } from "@/lib/sui-auth";
import type { AptosSignMessageOutput } from "@/lib/aptos-auth";
import { WalletEcosystem } from "@/lib/player-identity";
import type { TypedData } from "starknet";

export async function fetchAuthNonce(): Promise<string> {
  const res = await fetch("/api/auth/nonce", { cache: "no-store" });
  const data = (await res.json()) as { nonce?: string; error?: string };
  if (!res.ok || !data.nonce) {
    throw new Error(data.error ?? "Could not start sign-in.");
  }
  return data.nonce;
}

export async function signInWithEvm(params: {
  address: string;
  chainId: number;
  signMessageAsync: (args: { message: string }) => Promise<string>;
}): Promise<void> {
  const nonce = await fetchAuthNonce();
  const domain =
    typeof window !== "undefined" ? window.location.host : "arcadex.fun";
  const uri =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://arcadex.fun";

  const siwe = new SiweMessage({
    domain,
    address: params.address,
    statement: buildSiweStatement(),
    uri,
    version: "1",
    chainId: params.chainId,
    nonce,
  });

  const message = siwe.prepareMessage();
  const signature = await params.signMessageAsync({ message });

  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ecosystem: "evm" satisfies WalletEcosystem,
      message,
      signature,
      nonce,
      chainId: params.chainId,
    }),
  });

  const data = (await res.json()) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Sign-in failed.");
  }
}

export async function signInWithStarknet(params: {
  address: string;
  signTypedData: (typedData: TypedData) => Promise<string[] | readonly string[]>;
}): Promise<void> {
  const nonce = await fetchAuthNonce();
  const typedData = buildStarknetAuthTypedData(nonce);
  const signature = await params.signTypedData(typedData);
  const sigArray = Array.isArray(signature)
    ? signature.map(String)
    : [String(signature)];

  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ecosystem: "starknet" satisfies WalletEcosystem,
      nonce,
      address: params.address,
      signature: JSON.stringify(signature),
    }),
  });

  const data = (await res.json()) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Sign-in failed.");
  }
}

export async function signInWithSui(params: {
  address: string;
  signPersonalMessage: (message: Uint8Array) => Promise<string>;
}): Promise<void> {
  const nonce = await fetchAuthNonce();
  const message = buildSuiAuthMessage(nonce);
  const messageBytes = new TextEncoder().encode(message);
  const signature = await params.signPersonalMessage(messageBytes);

  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ecosystem: "sui" satisfies WalletEcosystem,
      nonce,
      address: params.address,
      message,
      signature,
    }),
  });

  const data = (await res.json()) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Sign-in failed.");
  }
}

async function postAuthVerify(body: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Sign-in failed.");
  }
}

export async function signInWithAptos(params: {
  address: string;
  publicKey?: string;
  signMessage: (nonce: string) => Promise<AptosSignMessageOutput>;
}): Promise<void> {
  const nonce = await fetchAuthNonce();
  const signed = await params.signMessage(nonce);

  await postAuthVerify({
    ecosystem: "aptos" satisfies WalletEcosystem,
    nonce,
    address: params.address,
    signedMessage: { ...signed, publicKey: signed.publicKey ?? params.publicKey },
  });
}

export async function signInWithMovement(params: {
  address: string;
  publicKey?: string;
  signMessage: (nonce: string) => Promise<AptosSignMessageOutput>;
}): Promise<void> {
  const nonce = await fetchAuthNonce();
  const signed = await params.signMessage(nonce);

  await postAuthVerify({
    ecosystem: "movement" satisfies WalletEcosystem,
    nonce,
    address: params.address,
    signedMessage: { ...signed, publicKey: signed.publicKey ?? params.publicKey },
  });
}

export async function signInWithStellar(params: {
  signMessage: (
    nonce: string
  ) => Promise<{ address: string; message: string; signedMessage: string }>;
}): Promise<void> {
  const nonce = await fetchAuthNonce();
  const result = await params.signMessage(nonce);

  await postAuthVerify({
    ecosystem: "stellar" satisfies WalletEcosystem,
    nonce,
    address: result.address,
    message: result.message,
    signature: result.signedMessage,
  });
}

export async function signInWithVara(params: {
  address: string;
  signMessage: (
    nonce: string
  ) => Promise<{ address: string; message: string; signature: string }>;
}): Promise<void> {
  const nonce = await fetchAuthNonce();
  const result = await params.signMessage(nonce);

  await postAuthVerify({
    ecosystem: "vara" satisfies WalletEcosystem,
    nonce,
    address: result.address,
    message: result.message,
    signature: result.signature,
  });
}
