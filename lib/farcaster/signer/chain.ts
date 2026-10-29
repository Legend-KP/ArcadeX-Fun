import {
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import {
  FARCASTER_ED25519_KEY_TYPE,
  KEY_GATEWAY_ADDRESS,
  KEY_REGISTRY_ADDRESS,
  STORAGE_REGISTRY_ADDRESS,
} from "@/lib/farcaster/constants";
import { SignerHttpError } from "@/lib/farcaster/signer/errors";
import {
  getOptimismPublicClient,
  listOptimismRpcUrls,
} from "@/lib/farcaster/optimism-client";

const KEY_GATEWAY_READ_ABI = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const KEY_GATEWAY_WRITE_ABI = [
  {
    type: "function",
    name: "addFor",
    stateMutability: "payable",
    inputs: [
      { name: "fidOwner", type: "address" },
      { name: "keyType", type: "uint32" },
      { name: "key", type: "bytes" },
      { name: "metadataType", type: "uint8" },
      { name: "metadata", type: "bytes" },
      { name: "deadline", type: "uint256" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const KEY_REGISTRY_ABI = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "keyDataOf",
    stateMutability: "view",
    inputs: [
      { name: "fid", type: "uint256" },
      { name: "key", type: "bytes" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "state", type: "uint8" },
          { name: "keyType", type: "uint32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "removeFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "fidOwner", type: "address" },
      { name: "key", type: "bytes" },
      { name: "deadline", type: "uint256" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const STORAGE_REGISTRY_ABI = [
  {
    type: "function",
    name: "unitPrice",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const KEY_STATE_NULL = 0;
export const KEY_STATE_ADDED = 1;
export const KEY_STATE_REMOVED = 2;

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

async function readOptimism<T>(read: (rpcUrl: string) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const rpcUrl of listOptimismRpcUrls()) {
    try {
      return await read(rpcUrl);
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) break;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : "Optimism RPC failed.";
  throw new SignerHttpError(`Could not read Farcaster contracts. ${detail}`, 503);
}

export async function readCustodyAddress(fid: number): Promise<Address> {
  const { custodyOf } = await import("@/lib/farcaster/id-registry");
  const custody = await custodyOf(fid);
  if (!custody) {
    throw new SignerHttpError("This fid has no custody address on Optimism.", 409);
  }
  return getAddress(custody);
}

export async function readAddNonce(owner: Address): Promise<bigint> {
  return readOptimism((rpcUrl) =>
    getOptimismPublicClient(rpcUrl).readContract({
      address: KEY_GATEWAY_ADDRESS,
      abi: KEY_GATEWAY_READ_ABI,
      functionName: "nonces",
      args: [owner],
    })
  );
}

export async function readRemoveNonce(owner: Address): Promise<bigint> {
  return readOptimism((rpcUrl) =>
    getOptimismPublicClient(rpcUrl).readContract({
      address: KEY_REGISTRY_ADDRESS,
      abi: KEY_REGISTRY_ABI,
      functionName: "nonces",
      args: [owner],
    })
  );
}

export async function readStorageUnitPrice(): Promise<bigint> {
  return readOptimism((rpcUrl) =>
    getOptimismPublicClient(rpcUrl).readContract({
      address: STORAGE_REGISTRY_ADDRESS,
      abi: STORAGE_REGISTRY_ABI,
      functionName: "unitPrice",
    })
  );
}

export async function readSignerState(
  fid: number,
  publicKey: Hex
): Promise<number> {
  try {
    const data = await readOptimism((rpcUrl) =>
      getOptimismPublicClient(rpcUrl).readContract({
        address: KEY_REGISTRY_ADDRESS,
        abi: KEY_REGISTRY_ABI,
        functionName: "keyDataOf",
        args: [BigInt(fid), publicKey],
      })
    );
    return Number(data.state);
  } catch (error) {
    if (error instanceof SignerHttpError) throw error;
    return KEY_STATE_NULL;
  }
}

export function encodeAddFor(input: {
  fidOwner: Address;
  key: Hex;
  metadataType: number;
  metadata: Hex;
  deadline: bigint;
  signature: Hex;
}): Hex {
  return encodeFunctionData({
    abi: KEY_GATEWAY_WRITE_ABI,
    functionName: "addFor",
    args: [
      input.fidOwner,
      FARCASTER_ED25519_KEY_TYPE,
      input.key,
      input.metadataType,
      input.metadata,
      input.deadline,
      input.signature,
    ],
  });
}

export function encodeRemoveFor(input: {
  fidOwner: Address;
  key: Hex;
  deadline: bigint;
  signature: Hex;
}): Hex {
  return encodeFunctionData({
    abi: KEY_REGISTRY_ABI,
    functionName: "removeFor",
    args: [input.fidOwner, input.key, input.deadline, input.signature],
  });
}
