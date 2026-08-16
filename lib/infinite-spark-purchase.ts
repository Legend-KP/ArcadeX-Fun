"use client";

import { formatUnits, type Address, type Hash } from "viem";
import { base } from "@/lib/chains";
import {
  getBasePublicClient,
  readBaseContract,
} from "@/lib/base-public-client";
import { resolveEvmAccountForSession } from "@/lib/evm-session-wallet";
import {
  BASE_USDC,
  ERC20_ABI,
  INFINITE_SPARK_ABI,
  INFINITE_SPARK_CONTRACT_ADDRESS,
  isInfiniteSparkConfigured,
  type InfiniteSparkPaymentToken,
  STABLECOIN_DECIMALS,
  tokenAddress,
} from "@/lib/infinite-spark";

async function readBalance(token: Address, account: Address): Promise<bigint> {
  return readBaseContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  });
}

export async function purchaseInfiniteSparkOnChain(): Promise<{
  txHash: Hash;
  token: InfiniteSparkPaymentToken;
}> {
  if (!isInfiniteSparkConfigured()) {
    throw new Error("InfiniteSpark contract is not configured yet.");
  }

  const { account, walletClient } = await resolveEvmAccountForSession(base);

  const fee = await readBaseContract({
    address: INFINITE_SPARK_CONTRACT_ADDRESS,
    abi: INFINITE_SPARK_ABI,
    functionName: "fee",
  });

  const usdcBalance = await readBalance(BASE_USDC, account);
  if (usdcBalance < fee) {
    const needed = formatUnits(fee, STABLECOIN_DECIMALS);
    throw new Error(`Insufficient USDC balance. You need $${needed} in USDC.`);
  }

  const tokenAddr = tokenAddress("USDC");
  const allowance = await readBaseContract({
    address: tokenAddr,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account, INFINITE_SPARK_CONTRACT_ADDRESS],
  });

  const publicClient = getBasePublicClient();

  if (allowance < fee) {
    const approveHash = await walletClient.writeContract({
      account,
      chain: base,
      address: tokenAddr,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [INFINITE_SPARK_CONTRACT_ADDRESS, fee],
    });

    const approveReceipt = await publicClient.waitForTransactionReceipt({
      hash: approveHash,
    });

    if (approveReceipt.status !== "success") {
      throw new Error("Token approval failed.");
    }
  }

  const payHash = await walletClient.writeContract({
    account,
    chain: base,
    address: INFINITE_SPARK_CONTRACT_ADDRESS,
    abi: INFINITE_SPARK_ABI,
    functionName: "payWithUSDC",
  });

  const payReceipt = await publicClient.waitForTransactionReceipt({
    hash: payHash,
  });

  if (payReceipt.status !== "success") {
    throw new Error("Infinite Spark payment failed.");
  }

  return { txHash: payHash, token: "USDC" };
}
