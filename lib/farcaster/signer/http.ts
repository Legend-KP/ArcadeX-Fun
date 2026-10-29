import { NextResponse } from "next/server";
import { SignerHttpError } from "@/lib/farcaster/signer/errors";

export function signerErrorResponse(error: unknown) {
  if (error instanceof SignerHttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(
    "[ArcadeX] farcaster signer",
    error instanceof Error ? error.message : "request failed"
  );
  return NextResponse.json(
    { error: "Could not complete the Farcaster signer request." },
    { status: 500 }
  );
}
