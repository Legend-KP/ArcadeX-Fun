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
  isSparkRefillConfigured,
  SPARK_REFILL_ABI,
  SPARK_REFILL_CONTRACT_ADDRESS,
  type SparkRefillPaymentToken,
  STABLECOIN_DECIMALS,
  tokenAddress,
} from "@/lib/spark-refill";

async function readBalance(token: Address, account: Address): Promise<bigint> {
  return readBaseContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  });
}

export async function purchaseSparkRefillOnChain(): Promise<{
  txHash: Hash;
  token: SparkRefillPaymentToken;
}> {
  if (!isSparkRefillConfigured()) {
    throw new Error("SparkRefill contract is not configured yet.");
  }

  const { account, walletClient } = await resolveEvmAccountForSession(base);

  const fee = await readBaseContract({
    address: SPARK_REFILL_CONTRACT_ADDRESS,
    abi: SPARK_REFILL_ABI,
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
    args: [account, SPARK_REFILL_CONTRACT_ADDRESS],
  });

  const publicClient = getBasePublicClient();

  if (allowance < fee) {
    const approveHash = await walletClient.writeContract({
      account,
      chain: base,
      address: tokenAddr,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [SPARK_REFILL_CONTRACT_ADDRESS, fee],
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
    address: SPARK_REFILL_CONTRACT_ADDRESS,
    abi: SPARK_REFILL_ABI,
    functionName: "payWithUSDC",
  });

  const payReceipt = await publicClient.waitForTransactionReceipt({
    hash: payHash,
  });

  if (payReceipt.status !== "success") {
    throw new Error("Spark Refill payment failed.");
  }

  return { txHash: payHash, token: "USDC" };
}
