import { NextResponse } from "next/server";
import { createAuthNonce, storeAuthNonce } from "@/lib/auth-nonce";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const nonce = createAuthNonce();
    await storeAuthNonce(nonce);
    return NextResponse.json({ nonce });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create auth nonce.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
