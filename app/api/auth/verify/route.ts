import { NextResponse } from "next/server";
import { consumeAuthNonce } from "@/lib/auth-nonce";
import {
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth-session";
import type { AptosSignMessageOutput } from "@/lib/aptos-auth";
import { verifySiweMessage } from "@/lib/siwe-lite";
import {
  buildPlayerId,
  normalizeAddress,
  WalletEcosystem,
} from "@/lib/player-identity";
import { isWalletEcosystem } from "@/lib/wallet-ecosystems";

export const dynamic = "force-dynamic";

interface VerifyBody {
  ecosystem?: WalletEcosystem;
  message?: string;
  signature?: string;
  nonce?: string;
  chainId?: number;
  address?: string;
  signedMessage?: AptosSignMessageOutput;
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

async function consumeNonce(nonce: string | undefined): Promise<void> {
  if (!nonce) {
    throw new Error("signature, nonce, and address are required.");
  }
  const consumed = await consumeAuthNonce(nonce);
  if (!consumed) {
    throw new Error("Invalid or expired nonce.");
  }
}

async function verifyEvmSiwe(
  body: VerifyBody,
  origin: string
): Promise<{ address: string; chainId?: number }> {
  const { message, signature, nonce } = body;
  if (!message || !signature || !nonce) {
    throw new Error("message, signature, and nonce are required.");
  }

  await consumeNonce(nonce);

  return verifySiweMessage({
    message,
    signature,
    nonce,
    domain: new URL(origin).host,
  });
}

async function verifyStarknetAuth(
  body: VerifyBody
): Promise<{ address: string }> {
  const { signature, nonce, address } = body;
  if (!signature || !nonce || !address) {
    throw new Error("signature, nonce, and address are required.");
  }
  await consumeNonce(nonce);
  const { verifyStarknetAuthSignature } = await import("@/lib/starknet-verify");
  const signer = await verifyStarknetAuthSignature({
    signature,
    nonce,
    address,
  });
  return { address: signer };
}

async function verifySuiAuth(body: VerifyBody): Promise<{ address: string }> {
  const { signature, nonce, address, message } = body;
  if (!signature || !nonce || !address || !message) {
    throw new Error("signature, nonce, address, and message are required.");
  }
  await consumeNonce(nonce);

  const { isSuiAuthMessageValid } = await import("@/lib/sui-auth");
  if (!isSuiAuthMessageValid(message, nonce)) {
    throw new Error("Invalid sign-in message.");
  }

  const signer = normalizeAddress("sui", address);
  const messageBytes = new TextEncoder().encode(message);
  const { isValidPersonalMessageSignature } = await import(
    "@/lib/sui-verify-lite"
  );
  const valid = await isValidPersonalMessageSignature(messageBytes, signature, {
    address: signer,
  });
  if (!valid) {
    throw new Error("Invalid Sui signature.");
  }
  return { address: signer };
}

async function verifyAptosAuth(body: VerifyBody): Promise<{ address: string }> {
  const { signedMessage, nonce, address } = body;
  if (!signedMessage || !nonce || !address) {
    throw new Error("signedMessage, nonce, and address are required.");
  }
  await consumeNonce(nonce);

  const { isAptosAuthMessageValid, verifyAptosSignMessage } = await import(
    "@/lib/aptos-auth"
  );
  if (!isAptosAuthMessageValid(signedMessage.message, nonce)) {
    throw new Error("Invalid sign-in message.");
  }
  if (!verifyAptosSignMessage(signedMessage)) {
    throw new Error("Invalid Aptos signature.");
  }

  const signer = normalizeAddress("aptos", address);
  if (normalizeAddress("aptos", signedMessage.address) !== signer) {
    throw new Error("Aptos address mismatch.");
  }
  return { address: signer };
}

async function verifyMovementAuth(
  body: VerifyBody
): Promise<{ address: string }> {
  const { signedMessage, nonce, address } = body;
  if (!signedMessage || !nonce || !address) {
    throw new Error("signedMessage, nonce, and address are required.");
  }
  await consumeNonce(nonce);

  const { isMovementAuthMessageValid, verifyMovementSignMessage } =
    await import("@/lib/movement-auth");
  if (!isMovementAuthMessageValid(signedMessage.message, nonce)) {
    throw new Error("Invalid sign-in message.");
  }
  if (!verifyMovementSignMessage(signedMessage)) {
    throw new Error("Invalid Movement signature.");
  }

  const signer = normalizeAddress("movement", address);
  if (normalizeAddress("movement", signedMessage.address) !== signer) {
    throw new Error("Movement address mismatch.");
  }
  return { address: signer };
}

async function verifyStellarAuth(body: VerifyBody): Promise<{ address: string }> {
  const { signature, nonce, address, message } = body;
  if (!signature || !nonce || !address || !message) {
    throw new Error("signature, nonce, address, and message are required.");
  }
  await consumeNonce(nonce);

  const { isStellarAuthMessageValid } = await import("@/lib/stellar-auth");
  if (!isStellarAuthMessageValid(message, nonce)) {
    throw new Error("Invalid sign-in message.");
  }

  const { verifyStellarSignedMessage } = await import("@/lib/stellar-verify");
  const signer = normalizeAddress("stellar", address);
  if (!verifyStellarSignedMessage(message, signature, signer)) {
    throw new Error("Invalid Stellar signature.");
  }
  return { address: signer };
}

async function verifyVaraAuth(body: VerifyBody): Promise<{ address: string }> {
  const { signature, nonce, address, message } = body;
  if (!signature || !nonce || !address || !message) {
    throw new Error("signature, nonce, address, and message are required.");
  }
  await consumeNonce(nonce);

  const { isVaraAuthMessageValid } = await import("@/lib/vara-auth");
  if (!isVaraAuthMessageValid(message, nonce)) {
    throw new Error("Invalid sign-in message.");
  }

  const { verifyVaraSignature } = await import("@/lib/vara-verify");
  const rawAddress = address.trim();
  const signer = normalizeAddress("vara", rawAddress);
  const valid =
    (await verifyVaraSignature(message, signature, signer)) ||
    (await verifyVaraSignature(message, signature, rawAddress));
  if (!valid) {
    throw new Error("Invalid Vara signature.");
  }
  return { address: signer };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as VerifyBody;
    const ecosystem = body.ecosystem;
    const origin = getAppOrigin(request);

    if (!ecosystem || !isWalletEcosystem(ecosystem)) {
      return NextResponse.json(
        { error: "Unsupported wallet ecosystem." },
        { status: 400 }
      );
    }

    const verified =
      ecosystem === "evm"
        ? await verifyEvmSiwe(body, origin)
        : ecosystem === "starknet"
          ? await verifyStarknetAuth(body)
          : ecosystem === "sui"
            ? await verifySuiAuth(body)
            : ecosystem === "aptos"
              ? await verifyAptosAuth(body)
              : ecosystem === "movement"
                ? await verifyMovementAuth(body)
                : ecosystem === "stellar"
                  ? await verifyStellarAuth(body)
                  : await verifyVaraAuth(body);

    const playerId = buildPlayerId(ecosystem, verified.address);
    const token = await createSessionToken({
      playerId,
      address: verified.address,
      ecosystem,
      chainId: ecosystem === "evm" ? body.chainId : undefined,
    });

    const sessionChainId = ecosystem === "evm" ? body.chainId : undefined;
    const response = NextResponse.json({
      ok: true,
      playerId,
      address: verified.address,
      ecosystem,
      chainId: sessionChainId,
    });
    response.cookies.set(sessionCookieOptions(token));
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Authentication failed.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
