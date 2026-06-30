import { NextResponse } from "next/server";
import { getAddress, type Hash } from "viem";
import { readSessionFromCookies } from "@/lib/auth-session";
import {
  applyShopPurchaseOnServer,
  ShopPurchaseError,
} from "@/lib/rtdb-server";
import { resolvePlayerId } from "@/lib/player-identity";
import {
  findShopPaymentToken,
  isShopProductId,
  type ShopProductId,
} from "@/lib/shop";
import { verifyShopPaymentTx } from "@/lib/shop-server";
import { isValidSuiTxDigest } from "@/lib/shop-sui";
import { verifySuiShopPaymentTx } from "@/lib/shop-sui-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await readSessionFromCookies();
    if (!session) {
      return NextResponse.json(
        { error: "Sign in to complete your purchase.", code: "NO_SESSION" },
        { status: 401 }
      );
    }

    if (session.ecosystem !== "evm" && session.ecosystem !== "sui") {
      return NextResponse.json(
        {
          error: "Shop purchases require an EVM wallet on MegaETH or a Sui wallet.",
          code: "UNSUPPORTED_WALLET",
        },
        { status: 400 }
      );
    }

    const body = (await request.json()) as {
      playerId?: string;
      productId?: string;
      txHash?: string;
      tokenAddress?: string;
    };

    const playerId = resolvePlayerId(body.playerId ?? session.playerId);
    if (!playerId || playerId !== session.playerId) {
      return NextResponse.json(
        { error: "Purchase session mismatch.", code: "SESSION_MISMATCH" },
        { status: 403 }
      );
    }

    const productId = body.productId ?? "";
    if (!isShopProductId(productId)) {
      return NextResponse.json(
        { error: "Unknown shop item.", code: "INVALID_PRODUCT" },
        { status: 400 }
      );
    }

    const txId = body.txHash?.trim() ?? "";

    if (session.ecosystem === "evm") {
      if (!/^0x[0-9a-fA-F]{64}$/.test(txId)) {
        return NextResponse.json(
          { error: "A valid transaction hash is required.", code: "INVALID_TX" },
          { status: 400 }
        );
      }

      const token = findShopPaymentToken(body.tokenAddress ?? "");
      if (!token) {
        return NextResponse.json(
          { error: "Unsupported payment token.", code: "INVALID_TOKEN" },
          { status: 400 }
        );
      }

      await verifyShopPaymentTx({
        txHash: txId as Hash,
        productId: productId as ShopProductId,
        tokenAddress: getAddress(token.address),
        expectedFrom: session.address,
      });

      const result = await applyShopPurchaseOnServer(
        playerId,
        productId as ShopProductId,
        txId,
        "evm"
      );

      return NextResponse.json(result);
    }

    if (!isValidSuiTxDigest(txId)) {
      return NextResponse.json(
        {
          error: "A valid Sui transaction digest is required.",
          code: "INVALID_TX",
        },
        { status: 400 }
      );
    }

    await verifySuiShopPaymentTx({
      txDigest: txId,
      productId: productId as ShopProductId,
      expectedFrom: session.address,
    });

    const result = await applyShopPurchaseOnServer(
      playerId,
      productId as ShopProductId,
      txId,
      "sui"
    );

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ShopPurchaseError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 409 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to complete purchase.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
