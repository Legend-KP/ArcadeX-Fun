import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Disabled on CF free tier — @gear-js/@polkadot blow the 3 MiB Worker limit. */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Vara shop transfers are temporarily unavailable on this deployment. Use Base USDC or Sui.",
      code: "VARA_DISABLED",
    },
    { status: 503 }
  );
}
