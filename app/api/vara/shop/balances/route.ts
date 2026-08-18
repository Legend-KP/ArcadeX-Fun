import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Balances are fetched in the browser via Gear HTTP RPC (Worker size budget).
 * This route is not a data source. Do not treat any 2xx as a balance payload —
 * callers must use fetchVaraVftBalances() in the client.
 */
export async function GET() {
  return NextResponse.json(
    {
      error:
        "Fetch Vara balances from the client Gear connection (browser).",
      code: "VARA_BALANCES_CLIENT",
      buildOnClient: true,
    },
    { status: 400 }
  );
}
