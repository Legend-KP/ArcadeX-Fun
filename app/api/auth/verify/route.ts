import { NextResponse } from "next/server";
import { SiweMessage } from "siwe";
import { RpcProvider } from "starknet";
import { consumeAuthNonce } from "@/lib/auth-nonce";
import {
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth-session";
import {
  AptosSignMessageOutput,
  isAptosAuthMessageValid,
  verifyAptosSignMessage,
} from "@/lib/aptos-auth";
import {
  isMovementAuthMessageValid,
  verifyMovementSignMessage,
} from "@/lib/movement-auth";
import { isStellarAuthMessageValid } from "@/lib/stellar-auth";
import { verifyStellarSignedMessage } from "@/lib/stellar-verify";
import { isVaraAuthMessageValid } from "@/lib/vara-auth";
import { verifyVaraSignature } from "@/lib/vara-verify";
import { buildStarknetAuthTypedData } from "@/lib/starknet-auth";
import { isSuiAuthMessageValid } from "@/lib/sui-auth";
import { isValidPersonalMessageSignature } from "@mysten/sui/verify";
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

async function verifySuiAuth(body: VerifyBody): Promise<{ address: string }> {
  const { signature, nonce, address, message } = body;
  if (!signature || !nonce || !address || !message) {
    throw new Error("signature, nonce, address, and message are required.");
  }

  const consumed = await consumeAuthNonce(nonce);
  if (!consumed) {
    throw new Error("Invalid or expired nonce.");
  }

  if (!isSuiAuthMessageValid(message, nonce)) {
    throw new Error("Invalid sign-in message.");
  }

  const signer = normalizeAddress("sui", address);
  const messageBytes = new TextEncoder().encode(message);
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

  const consumed = await consumeAuthNonce(nonce);
  if (!consumed) {
    throw new Error("Invalid or expired nonce.");
  }

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

  const consumed = await consumeAuthNonce(nonce);
  if (!consumed) {
    throw new Error("Invalid or expired nonce.");
  }

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

  const consumed = await consumeAuthNonce(nonce);
  if (!consumed) {
    throw new Error("Invalid or expired nonce.");
  }

  if (!isStellarAuthMessageValid(message, nonce)) {
    throw new Error("Invalid sign-in message.");
  }

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

  const consumed = await consumeAuthNonce(nonce);
  if (!consumed) {
    throw new Error("Invalid or expired nonce.");
  }

  if (!isVaraAuthMessageValid(message, nonce)) {
    throw new Error("Invalid sign-in message.");
  }

  const signer = normalizeAddress("vara", address);
  if (!verifyVaraSignature(message, signature, signer)) {
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
