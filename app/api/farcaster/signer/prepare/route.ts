import { NextResponse } from "next/server";
import { signerErrorResponse } from "@/lib/farcaster/signer/http";
import { prepareSignerApproval } from "@/lib/farcaster/signer/service";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await prepareSignerApproval());
  } catch (error) {
    return signerErrorResponse(error);
  }
}
