import { getAddress, type Address, type Hex } from "viem";
import {
  FARCASTER_RECOVERY_PROXY,
  ID_GATEWAY_ABI,
  ID_GATEWAY_ADDRESS,
  ID_REGISTRY_ABI,
  ID_REGISTRY_ADDRESS,
} from "@/lib/farcaster/constants";
import {
  getOptimismPublicClient,
  listOptimismRpcUrls,
} from "@/lib/farcaster/optimism-client";

function isTransientRpcError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("429") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("521") ||
    message.includes("rate limit")
  );
}

async function readIdRegistry<T>(
  functionName: "idOf" | "custodyOf" | "recoveryOf",
  args: readonly unknown[]
): Promise<T> {
  let lastError: unknown;

  for (const rpcUrl of listOptimismRpcUrls()) {
    try {
      const client = getOptimismPublicClient(rpcUrl);
      return (await client.readContract({
        address: ID_REGISTRY_ADDRESS,
        abi: ID_REGISTRY_ABI,
        functionName,
        args: args as never,
        blockTag: "latest",
      })) as T;
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not read Farcaster Id Registry on Optimism.");
}

/** Returns FID for an address, or 0 if none. */
export async function idOf(owner: Address | string): Promise<number> {
  const address = getAddress(owner);
  const fid = await readIdRegistry<bigint>("idOf", [address]);
  return Number(fid);
}

/** Custody address that currently owns `fid`. */
export async function custodyOf(fid: number): Promise<Address | null> {
  if (!Number.isFinite(fid) || fid <= 0) return null;
  const owner = await readIdRegistry<Address>("custodyOf", [BigInt(fid)]);
  if (!owner || owner === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  return getAddress(owner);
}

/** Recovery address for `fid`. */
export async function recoveryOf(fid: number): Promise<Address | null> {
  if (!Number.isFinite(fid) || fid <= 0) return null;
  const recovery = await readIdRegistry<Address>("recoveryOf", [BigInt(fid)]);
  if (!recovery || recovery === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  return getAddress(recovery);
}

export function defaultRecoveryAddress(): Hex {
  return FARCASTER_RECOVERY_PROXY;
}

/** IdGateway nonce used in the EIP-712 Register signature. */
export async function registrationNonce(owner: Address | string): Promise<bigint> {
  const address = getAddress(owner);
  let lastError: unknown;

  for (const rpcUrl of listOptimismRpcUrls()) {
    try {
      const client = getOptimismPublicClient(rpcUrl);
      return (await client.readContract({
        address: ID_GATEWAY_ADDRESS,
        abi: ID_GATEWAY_ABI,
        functionName: "nonces",
        args: [address],
        blockTag: "latest",
      })) as bigint;
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not read Farcaster IdGateway nonce.");
}
