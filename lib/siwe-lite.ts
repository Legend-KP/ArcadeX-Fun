/**
 * Tiny EIP-4361 helper — avoids bundling `siwe` (and ethers) into the Worker.
 */
import { getAddress, verifyMessage, type Address, type Hex } from "viem";

export function buildSiweMessage(params: {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId: number;
  nonce: string;
}): string {
  const address = getAddress(params.address);
  const issuedAt = new Date().toISOString();
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    params.statement,
    "",
    `URI: ${params.uri}`,
    "Version: 1",
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

function parseSiweField(message: string, label: string): string | null {
  const match = message.match(new RegExp(`^${label}: (.+)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

export async function verifySiweMessage(params: {
  message: string;
  signature: string;
  nonce: string;
  domain: string;
}): Promise<{ address: Address; chainId?: number }> {
  const lines = params.message.split("\n");
  if (!lines[0]?.endsWith(" wants you to sign in with your Ethereum account:")) {
    throw new Error("Invalid signature.");
  }
  const domain = lines[0].slice(
    0,
    lines[0].indexOf(" wants you to sign in with your Ethereum account:")
  );
  if (domain !== params.domain) {
    throw new Error("Invalid signature.");
  }

  const addressLine = lines[1]?.trim();
  if (!addressLine) {
    throw new Error("Invalid signature.");
  }
  const address = getAddress(addressLine);

  const nonce = parseSiweField(params.message, "Nonce");
  if (!nonce || nonce !== params.nonce) {
    throw new Error("Invalid or expired nonce.");
  }

  const chainRaw = parseSiweField(params.message, "Chain ID");
  const chainId = chainRaw ? Number(chainRaw) : undefined;

  const valid = await verifyMessage({
    address,
    message: params.message,
    signature: params.signature as Hex,
  });
  if (!valid) {
    throw new Error("Invalid signature.");
  }

  return {
    address,
    chainId: Number.isFinite(chainId) ? chainId : undefined,
  };
}
