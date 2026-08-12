/**
 * ArcadeXTxHub (Base) — free play sign-in constants + purpose hashing.
 *
 * Play purpose: keccak256(UTF-8 `PLAY:{gameId}`) → bytes32.
 */
import { keccak256, stringToHex, type Address, type Hex } from "viem";
import {
  BASE_MAINNET_DEPLOYMENTS,
  envAddress,
} from "@/lib/base-deployments";
import { base } from "@/lib/chains";

export const ARCADEX_TX_HUB_CHAIN_ID = base.id;

export const ARCADEX_TX_HUB_CONTRACT_ADDRESS = envAddress(
  process.env.NEXT_PUBLIC_ARCADEX_TX_HUB_CONTRACT,
  BASE_MAINNET_DEPLOYMENTS.arcadeXTxHub
);

export const ARCADEX_TX_HUB_ABI = [
  {
    type: "function",
    name: "signIn",
    stateMutability: "nonpayable",
    inputs: [{ name: "purpose", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "signInCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "event",
    name: "SignedIn",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "purpose", type: "bytes32", indexed: true },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
] as const;

export function getArcadeXTxHubAddress(): Address {
  if (!isArcadeXTxHubConfigured()) {
    throw new Error(
      "ArcadeXTxHub is not configured. Set NEXT_PUBLIC_ARCADEX_TX_HUB_CONTRACT."
    );
  }
  return ARCADEX_TX_HUB_CONTRACT_ADDRESS;
}

export function isArcadeXTxHubConfigured(): boolean {
  return (
    ARCADEX_TX_HUB_CONTRACT_ADDRESS !==
    "0x0000000000000000000000000000000000000000"
  );
}

/** True when this EVM session should require Base TxHub play sign-in. */
export function shouldRequireBaseTxHubSignIn(opts: {
  ecosystem?: string | null;
  chainId?: number | null;
}): boolean {
  if (!isArcadeXTxHubConfigured()) return false;
  if (opts.ecosystem && opts.ecosystem !== "evm") return false;
  if (
    typeof opts.chainId === "number" &&
    Number.isFinite(opts.chainId) &&
    opts.chainId !== ARCADEX_TX_HUB_CHAIN_ID
  ) {
    return false;
  }
  return true;
}

/**
 * Play purpose digest for Start Game on Base.
 * `keccak256("PLAY:{gameId}")` → 32-byte hex.
 */
export function playPurposeKeccak(gameId: string): Hex {
  const id = gameId.trim();
  if (!id) throw new Error("gameId is required for play purpose.");
  return keccak256(stringToHex(`PLAY:${id}`));
}
