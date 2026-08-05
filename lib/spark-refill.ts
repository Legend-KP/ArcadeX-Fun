import type { Address } from "viem";
import { BASE_USDC_ADDRESS } from "@/lib/chains";
import {
  BASE_MAINNET_DEPLOYMENTS,
  envAddress,
} from "@/lib/base-deployments";

export const SPARK_REFILL_CONTRACT_ADDRESS = envAddress(
  process.env.NEXT_PUBLIC_SPARK_REFILL_CONTRACT,
  BASE_MAINNET_DEPLOYMENTS.sparkRefill
);

export const BASE_USDC = envAddress(
  process.env.NEXT_PUBLIC_USDC_ADDRESS,
  BASE_MAINNET_DEPLOYMENTS.usdc || BASE_USDC_ADDRESS
);

/** @deprecated Use BASE_USDC — kept for transitional imports. */
export const CELO_USDC_ADDRESS = BASE_USDC;

export const STABLECOIN_DECIMALS = 6;

export type SparkRefillPaymentToken = "USDC";

export function isSparkRefillConfigured(): boolean {
  return (
    Boolean(SPARK_REFILL_CONTRACT_ADDRESS) &&
    SPARK_REFILL_CONTRACT_ADDRESS !==
      "0x0000000000000000000000000000000000000000"
  );
}

/** Minimal ABI used by shop purchase / verify (USDC only). */
export const SPARK_REFILL_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "player", type: "address" },
      { indexed: true, internalType: "address", name: "token", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "timestamp", type: "uint256" },
    ],
    name: "EntryPaid",
    type: "event",
  },
  {
    inputs: [],
    name: "USDC",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "fee",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "paused",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "payWithUSDC",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const ERC20_ABI = [
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export function tokenAddress(_token: SparkRefillPaymentToken = "USDC"): Address {
  return BASE_USDC;
}
