import { createAppClient, viemConnector } from "@farcaster/auth-client";
import { getAddress } from "viem";
import { custodyOf } from "@/lib/farcaster/id-registry";

export type SiwfVerifyInput = {
  domain: string;
  nonce: string;
  message: string;
  signature: string;
  acceptAuthAddress?: boolean;
};

export type SiwfVerifyResult = {
  fid: number;
  custody: `0x${string}`;
  /** Address that signed the SIWF message (custody or auth address). */
  signer: `0x${string}`;
};

function getOptimismRpcUrl(): string {
  return (
    process.env.OPTIMISM_RPC_URL?.trim() ||
    process.env.OP_MAINNET_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL?.trim() ||
    "https://mainnet.optimism.io"
  );
}

/**
 * Verify Sign-In with Farcaster (EIP-4361) via auth-client (no React).
 * Do not import @farcaster/auth-kit here — it pulls createContext into API routes.
 */
export async function verifySiwfMessage(
  input: SiwfVerifyInput
): Promise<SiwfVerifyResult> {
  const appClient = createAppClient({
    ethereum: viemConnector({ rpcUrl: getOptimismRpcUrl() }),
  });

  const result = await appClient.verifySignInMessage({
    domain: input.domain,
    nonce: input.nonce,
    message: input.message,
    signature: input.signature as `0x${string}`,
    acceptAuthAddress: input.acceptAuthAddress ?? true,
  });

  if (result.isError && result.error) {
    throw result.error;
  }

  if (!result.success) {
    throw new Error("Invalid Farcaster sign-in message.");
  }

  const fid = Number(result.fid);
  if (!Number.isFinite(fid) || fid <= 0) {
    throw new Error("SIWF response missing fid.");
  }

  const signerRaw =
    result.data &&
    typeof result.data === "object" &&
    "address" in result.data &&
    typeof (result.data as { address?: unknown }).address === "string"
      ? (result.data as { address: string }).address
      : null;

  if (!signerRaw) {
    throw new Error("SIWF response missing signer address.");
  }

  const signer = getAddress(signerRaw);
  const onchainCustody = await custodyOf(fid);
  const custody = onchainCustody ?? signer;

  return { fid, custody, signer };
}
