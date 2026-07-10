"use client";

import {
  assertVaraShopRecipientConfigured,
  VARA_SHOP_PAYMENT_TOKENS,
} from "@/lib/shop-vara";

export async function fetchVaraVftBalances(
  accountAddress: string
): Promise<Record<string, { balance: bigint; decimals: number }>> {
  assertVaraShopRecipientConfigured();

  const res = await fetch(
    `/api/vara/shop/balances?address=${encodeURIComponent(accountAddress)}`,
    { cache: "no-store" }
  );
  const data = (await res.json()) as {
    balances?: Record<
      string,
      { balance: string; decimals: number; symbol: string }
    >;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load Vara token balances.");
  }

  const nextBalances: Record<string, { balance: bigint; decimals: number }> =
    {};

  for (const token of VARA_SHOP_PAYMENT_TOKENS) {
    const entry = data.balances?.[token.id];
    nextBalances[token.id] = {
      balance: BigInt(entry?.balance ?? "0"),
      decimals: entry?.decimals ?? 6,
    };
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
