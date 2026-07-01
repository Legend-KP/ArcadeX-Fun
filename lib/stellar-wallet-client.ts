"use client";

import {
  getAddress,
  isConnected,
  requestAccess,
  signMessage,
} from "@stellar/freighter-api";
import { buildStellarAuthMessage } from "@/lib/stellar-auth";

export async function connectFreighterWallet(): Promise<string> {
  const connected = await isConnected();
  if (!connected.isConnected) {
    const access = await requestAccess();
    if (access.error || !access.address) {
      throw new Error(
        access.error ?? "Could not connect Freighter wallet."
      );
    }
    return access.address;
  }

  const address = await getAddress();
  if (address.error || !address.address) {
    throw new Error(address.error ?? "Could not read Freighter address.");
  }

  return address.address;
}

export async function signFreighterMessage(
  nonce: string
): Promise<{ address: string; message: string; signedMessage: string }> {
  const message = buildStellarAuthMessage(nonce);
  const result = await signMessage(message);
  if (result.error || !result.signedMessage) {
    throw new Error(result.error ?? "Could not sign message with Freighter.");
  }

  const address = await getAddress();
  if (address.error || !address.address) {
    throw new Error(address.error ?? "Could not read Freighter address.");
  }

  return {
    address: address.address,
    message,
    signedMessage:
      typeof result.signedMessage === "string"
        ? result.signedMessage
        : Buffer.from(result.signedMessage).toString("base64"),
  };
}
