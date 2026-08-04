import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import {
  assertVaraShopRecipientConfigured,
  findVaraShopPaymentToken,
  VARA_SHOP_RECIPIENT_ADDRESS,
} from "@/lib/shop-vara";
import {
  isShopProductId,
  SHOP_PRODUCTS,
  shopPriceToAmount,
  SHOP_TOKEN_DECIMALS,
  type ShopProductId,
} from "@/lib/shop";

export const dynamic = "force-dynamic";

/**
 * Returns transfer parameters for the browser Gear client.
 * Extrinsic building stays client-side to keep the Worker under 3 MiB.
 */
export async function POST(request: Request) {
  try {
    const session = await readSessionFromCookies();
    if (!session || session.ecosystem !== "vara") {
      return NextResponse.json(
        { error: "Sign in with a Vara wallet to continue." },
        { status: 401 }
      );
    }

    assertVaraShopRecipientConfigured();

    const body = (await request.json()) as {
      tokenProgramId?: string;
      productId?: string;
      amount?: string;
    };

    const token = findVaraShopPaymentToken(body.tokenProgramId ?? "");
    if (!token) {
      return NextResponse.json(
        { error: "Unsupported payment token." },
        { status: 400 }
      );
    }

    let amount: bigint;
    if (body.productId && isShopProductId(body.productId)) {
      const product = SHOP_PRODUCTS[body.productId as ShopProductId];
      amount = shopPriceToAmount(product.priceUsd, SHOP_TOKEN_DECIMALS);
    } else if (body.amount) {
      amount = BigInt(body.amount);
    } else {
      return NextResponse.json(
        { error: "A valid purchase amount is required." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      // Client builds + signs the extrinsic with Gear in the browser.
      buildOnClient: true,
      tokenProgramId: token.programId,
      amount: amount.toString(),
      recipient: VARA_SHOP_RECIPIENT_ADDRESS,
      fromAddress: session.address,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not prepare Vara transfer.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
