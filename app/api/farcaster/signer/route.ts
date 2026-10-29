import { NextResponse } from "next/server";
import { signerErrorResponse } from "@/lib/farcaster/signer/http";
import { signerStatus } from "@/lib/farcaster/signer/service";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`farcaster:signer:status:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }
  try {
    return NextResponse.json(await signerStatus());
  } catch (error) {
    return signerErrorResponse(error);
  }
}
