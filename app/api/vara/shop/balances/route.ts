import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Balances are fetched in the browser via Gear API (Worker size budget).
 * This route remains for compatibility and points clients at the browser path.
 */
export async function GET() {
  return NextResponse.json(
    {
      error:
        "Fetch Vara balances from the client Gear connection (browser).",
      code: "VARA_BALANCES_CLIENT",
      buildOnClient: true,
    },
    { status: 200 }
  );
}
