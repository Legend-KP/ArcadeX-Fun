"use client";

import {
  assertVaraShopRecipientConfigured,
  VARA_SHOP_PAYMENT_TOKENS,
} from "@/lib/shop-vara";
import { readVftBalance, readVftDecimals } from "@/lib/vara-http-rpc";

export async function fetchVaraVftBalances(
  accountAddress: string
): Promise<Record<string, { balance: bigint; decimals: number }>> {
  assertVaraShopRecipientConfigured();

  const nextBalances: Record<string, { balance: bigint; decimals: number }> =
    {};

  for (const token of VARA_SHOP_PAYMENT_TOKENS) {
    const [balance, decimals] = await Promise.all([
      readVftBalance(token.programId, accountAddress),
      readVftDecimals(token.programId),
    ]);
    nextBalances[token.id] = { balance, decimals };
  }

  return nextBalances;
}

export async function transferVaraVftToken(params: {
  tokenProgramId: string;
  fromAddress: string;
  toAddress: string;
  amount: bigint;
  productId: string;
}): Promise<string> {
  const { transferVaraVftTokenOnClient } = await import(
    "@/lib/vara-shop-transfer-client"
  );

  return transferVaraVftTokenOnClient({
    tokenProgramId: params.tokenProgramId,
    fromAddress: params.fromAddress,
    productId: params.productId,
  });
}
