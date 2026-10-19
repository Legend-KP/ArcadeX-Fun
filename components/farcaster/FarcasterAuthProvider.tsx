"use client";

import "@farcaster/auth-kit/styles.css";
import { AuthKitProvider } from "@farcaster/auth-kit";
import type { ReactNode } from "react";

function getAuthKitConfig() {
  const rpcUrl =
    process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_OP_MAINNET_RPC_URL?.trim() ||
    "https://mainnet.optimism.io";

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (typeof window !== "undefined" ? window.location.origin : "https://arcadex.fun");

  const origin = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
  let domain = "arcadex.fun";
  try {
    domain = new URL(origin).host;
  } catch {
    // keep default
  }

  return {
    relay: "https://relay.farcaster.xyz",
    rpcUrl,
    domain,
    siweUri: origin,
  } as const;
}

/**
 * Auth Kit provider for Sign-In with Farcaster (Path A).
 * Wrap pages that show SIWF UI.
 */
export default function FarcasterAuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AuthKitProvider config={getAuthKitConfig()}>{children}</AuthKitProvider>
  );
}
