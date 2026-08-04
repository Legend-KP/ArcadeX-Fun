export type HexString = `0x${string}`;

export const VARA_SHOP_EXPLORER_TX_URL =
  "https://vara.subscan.io/extrinsic";

export const VARA_RPC_URL =
  process.env.NEXT_PUBLIC_VARA_RPC_URL?.trim() || "wss://rpc.vara.network";

export const VARA_SHOP_RECIPIENT_ADDRESS =
  process.env.NEXT_PUBLIC_VARA_SHOP_RECIPIENT_ADDRESS?.trim() ||
  "kGkSGVF3kua4y3FnKrAomeRDG5W7SxWxbHg122N41VVcTqAnk";

export interface VaraShopPaymentToken {
  id: "wusdc" | "wusdt";
  symbol: string;
  programId: HexString;
}

export const VARA_SHOP_PAYMENT_TOKENS: VaraShopPaymentToken[] = [
  {
    id: "wusdc",
    symbol: "WUSDC",
    programId:
      "0xd1de816d7dce6439504552686ab333e5b7302b1549763656b30af1f8a5871b6a",
  },
  {
    id: "wusdt",
    symbol: "WUSDT",
    programId:
      "0x4255ff4a87a4c13dc39f74ace8c4948bbef2f75fb639d66639a1cfcc99e6243e",
  },
];

export function findVaraShopPaymentToken(
  programId: string
): VaraShopPaymentToken | undefined {
  const normalized = programId.trim().toLowerCase();
  return VARA_SHOP_PAYMENT_TOKENS.find(
    (token) => token.programId.toLowerCase() === normalized
  );
}

export function isValidVaraExtrinsicHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

export function normalizeVaraExtrinsicHash(value: string): string {
  const hash = value.trim().toLowerCase();
  if (!isValidVaraExtrinsicHash(hash)) {
    throw new Error("Invalid Vara extrinsic hash.");
  }
  return hash;
}

export function assertVaraShopRecipientConfigured(): void {
  if (!VARA_SHOP_RECIPIENT_ADDRESS) {
    throw new Error(
      "Vara shop recipient is not configured. Set NEXT_PUBLIC_VARA_SHOP_RECIPIENT_ADDRESS."
    );
  }
}
