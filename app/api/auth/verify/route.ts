import { NextResponse } from "next/server";
import { SiweMessage } from "siwe";
import { RpcProvider } from "starknet";
import { consumeAuthNonce } from "@/lib/auth-nonce";
import {
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth-session";
import { buildStarknetAuthTypedData } from "@/lib/starknet-auth";
import {
  buildPlayerId,
  normalizeAddress,
  WalletEcosystem,
} from "@/lib/player-identity";

export const dynamic = "force-dynamic";

interface VerifyBody {
  ecosystem?: WalletEcosystem;
  message?: string;
  signature?: string;
  nonce?: string;
  chainId?: number;
  address?: string;
}

function getAppOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    return configured.startsWith("http")
      ? configured
      : `https://${configured}`;
  }
  return new URL(request.url).origin;
}

async function verifyEvmSiwe(
  body: VerifyBody,
  origin: string
): Promise<{ address: string; chainId?: number }> {
  const { message, signature, nonce } = body;
  if (!message || !signature || !nonce) {
    throw new Error("message, signature, and nonce are required.");
  }

  const consumed = await consumeAuthNonce(nonce);
  if (!consumed) {
    throw new Error("Invalid or expired nonce.");
  }

  const siwe = new SiweMessage(message);
  const result = await siwe.verify({
    signature,
    nonce,
    domain: new URL(origin).host,
  });

  if (!result.success) {
    throw new Error("Invalid signature.");
  }

  return {
    address: normalizeAddress("evm", siwe.address),
    chainId: siwe.chainId,
  };
}

async function verifyStarknetAuth(
  body: VerifyBody
): Promise<{ address: string }> {
  const { signature, nonce, address } = body;
  if (!signature || !nonce || !address) {
    throw new Error("signature, nonce, and address are required.");
  }

  const consumed = await consumeAuthNonce(nonce);
  if (!consumed) {
    throw new Error("Invalid or expired nonce.");
  }

  let sigArray: string[];
  try {
    const parsed = JSON.parse(signature) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 2) {
      throw new Error("bad sig");
    }
    sigArray = parsed.map(String);
  } catch {
    throw new Error("Invalid Starknet signature format.");
  }

  const signer = normalizeAddress("starknet", address);
  const typedData = buildStarknetAuthTypedData(nonce);

  const provider = new RpcProvider({
    nodeUrl:
      process.env.STARKNET_RPC_URL?.trim() ||
      "https://starknet-mainnet.public.blastapi.io/rpc/v0_9",
  });

  const valid = await provider.verifyMessageInStarknet(
    typedData,
    sigArray,
    signer
  );

  if (!valid) {
    throw new Error("Invalid Starknet signature.");
  }

  return { address: signer };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as VerifyBody;
    const ecosystem = body.ecosystem;
    const origin = getAppOrigin(request);

    if (ecosystem !== "evm" && ecosystem !== "starknet") {
      return NextResponse.json(
        { error: "ecosystem must be evm or starknet." },
        { status: 400 }
      );
    }

    const verified =
      ecosystem === "evm"
        ? await verifyEvmSiwe(body, origin)
        : await verifyStarknetAuth(body);

    const playerId = buildPlayerId(ecosystem, verified.address);
    const token = await createSessionToken({
      playerId,
      address: verified.address,
      ecosystem,
      chainId: ecosystem === "evm" ? body.chainId : undefined,
    });

    const response = NextResponse.json({
      ok: true,
      playerId,
      address: verified.address,
      ecosystem,
    });
    response.cookies.set(sessionCookieOptions(token));
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Authentication failed.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
