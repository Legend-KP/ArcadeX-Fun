import { NextResponse } from "next/server";
import {
  FARCASTER_RECOVERY_PROXY,
  ID_GATEWAY_EIP712_DOMAIN,
  ID_GATEWAY_REGISTER_TYPES,
} from "@/lib/farcaster/constants";
import { registrationNonce } from "@/lib/farcaster/id-registry";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { getAddress } from "viem";

export const dynamic = "force-dynamic";

/**
 * EIP-712 Register payload for Path B. The custody wallet signs this;
 * Neynar submits registerFor and ArcadeX pays.
 */
export async function GET(request: Request) {
  try {
    const ip = getClientIp(request);
    if (!(await checkRateLimit(`farcaster:sign-data:${ip}`, 20, 60_000))) {
      return rateLimitResponse();
    }

    const addressRaw = new URL(request.url).searchParams.get("address")?.trim();
    const recoveryRaw = new URL(request.url).searchParams
      .get("recovery")
      ?.trim();
    if (!addressRaw) {
      return NextResponse.json(
        { error: "address is required." },
        { status: 400 }
      );
    }

    let to: `0x${string}`;
    let recovery: `0x${string}`;
    try {
      to = getAddress(addressRaw);
      recovery = recoveryRaw
        ? getAddress(recoveryRaw)
        : FARCASTER_RECOVERY_PROXY;
    } catch {
      return NextResponse.json(
        { error: "Invalid address." },
        { status: 400 }
      );
    }

    const nonce = await registrationNonce(to);
    const deadline = Math.floor(Date.now() / 1000) + 10 * 60;

    return NextResponse.json({
      domain: ID_GATEWAY_EIP712_DOMAIN,
      types: ID_GATEWAY_REGISTER_TYPES,
      primaryType: "Register",
      message: {
        to,
        recovery,
        nonce: nonce.toString(),
        deadline,
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not build registration signature.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
