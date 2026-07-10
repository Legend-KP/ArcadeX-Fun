import { NextResponse } from "next/server";
import { getVaraGearApi } from "@/lib/vara-rpc";
import { VftProgram } from "@/lib/vara-vft";
import { toVaraActorId } from "@/lib/vara-address";
import { isVaraAddress } from "@/lib/player-identity";
import {
  assertVaraShopRecipientConfigured,
  VARA_SHOP_PAYMENT_TOKENS,
} from "@/lib/shop-vara";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertVaraShopRecipientConfigured();

    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address")?.trim() ?? "";

    if (!isVaraAddress(address)) {
      return NextResponse.json(
        { error: "A valid Vara wallet address is required." },
        { status: 400 }
      );
    }

    const api = await getVaraGearApi();
    const actorId = toVaraActorId(address);
    const balances: Record<
      string,
      { balance: string; decimals: number; symbol: string }
    > = {};

    for (const token of VARA_SHOP_PAYMENT_TOKENS) {
      const program = new VftProgram(api, token.programId);
      const [balance, decimals] = await Promise.all([
        program.vft.balanceOf(actorId, address),
        program.vft.decimals(address),
      ]);

      balances[token.id] = {
        balance: balance.toString(),
        decimals,
        symbol: token.symbol,
      };
    }

    return NextResponse.json({ balances });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not load Vara balances.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
