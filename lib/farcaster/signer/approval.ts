import { encodeAbiParameters, verifyTypedData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  FARCASTER_ED25519_KEY_TYPE,
  FARCASTER_SIGNED_KEY_REQUEST_METADATA_TYPE,
  KEY_GATEWAY_ADD_TYPES,
  KEY_GATEWAY_EIP712_DOMAIN,
  KEY_REGISTRY_EIP712_DOMAIN,
  KEY_REGISTRY_REMOVE_TYPES,
  SIGNED_KEY_REQUEST_EIP712_DOMAIN,
  SIGNED_KEY_REQUEST_TYPES,
} from "@/lib/farcaster/constants";
import {
  appAccountPrivateKey,
  appFid,
  requireAppAttribution,
} from "@/lib/farcaster/signer/config";
import { SignerHttpError } from "@/lib/farcaster/signer/errors";
import { SIGNER_APPROVAL_TTL_SEC } from "@/lib/farcaster/signer/permissions";

export type AddTypedData = {
  domain: typeof KEY_GATEWAY_EIP712_DOMAIN;
  types: typeof KEY_GATEWAY_ADD_TYPES;
  primaryType: "Add";
  message: {
    owner: Address;
    keyType: number;
    key: Hex;
    metadataType: number;
    metadata: Hex;
    nonce: string;
    deadline: string;
  };
};

export type RemoveTypedData = {
  domain: typeof KEY_REGISTRY_EIP712_DOMAIN;
  types: typeof KEY_REGISTRY_REMOVE_TYPES;
  primaryType: "Remove";
  message: {
    owner: Address;
    key: Hex;
    nonce: string;
    deadline: string;
  };
};

export function approvalDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + SIGNER_APPROVAL_TTL_SEC);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashManifest(manifest: string): Promise<string> {
  return sha256Hex(manifest);
}

function appRequestSigner(): { fid: number; accountKey: `0x${string}` } | null {
  const fid = appFid();
  const accountKey = appAccountPrivateKey();
  if (requireAppAttribution() && (fid === null || !accountKey)) {
    throw new SignerHttpError(
      "Set FARCASTER_APP_FID and FARCASTER_APP_ACCOUNT_PRIVATE_KEY. Authorize that account on the SignedKeyRequestValidator for the ArcadeX app fid before asking users to approve a signer.",
      503
    );
  }
  if (fid === null || !accountKey) return null;
  return { fid, accountKey };
}

/** App-account SignedKeyRequest. The custody key never leaves the Farcaster app. */
export async function signAppKeyRequest(
  publicKey: Hex,
  deadline: bigint
): Promise<{ requestFid: number; requestSigner: Address; signature: Hex }> {
  const app = appRequestSigner();
  if (!app) {
    throw new SignerHttpError(
      "Set FARCASTER_APP_FID and FARCASTER_APP_ACCOUNT_PRIVATE_KEY before asking the Farcaster app to approve a signer.",
      503
    );
  }
  const account = privateKeyToAccount(app.accountKey);
  const signature = await account.signTypedData({
    domain: SIGNED_KEY_REQUEST_EIP712_DOMAIN,
    types: SIGNED_KEY_REQUEST_TYPES,
    primaryType: "SignedKeyRequest",
    message: {
      requestFid: BigInt(app.fid),
      key: publicKey,
      deadline,
    },
  });
  return { requestFid: app.fid, requestSigner: account.address, signature };
}

export async function buildKeyMetadata(
  publicKey: Hex,
  deadline: bigint
): Promise<{ metadataType: number; metadata: Hex; appFid: number | null }> {
  const app = appRequestSigner();
  if (!app) {
    return { metadataType: 0, metadata: "0x", appFid: null };
  }

  const signed = await signAppKeyRequest(publicKey, deadline);

  const metadata = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "requestFid", type: "uint256" },
          { name: "requestSigner", type: "address" },
          { name: "signature", type: "bytes" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    [
      {
        requestFid: BigInt(signed.requestFid),
        requestSigner: signed.requestSigner,
        signature: signed.signature,
        deadline,
      },
    ]
  );

  return {
    metadataType: FARCASTER_SIGNED_KEY_REQUEST_METADATA_TYPE,
    metadata,
    appFid: signed.requestFid,
  };
}

export function addTypedData(input: {
  owner: Address;
  key: Hex;
  metadataType: number;
  metadata: Hex;
  nonce: bigint;
  deadline: bigint;
}): AddTypedData {
  return {
    domain: KEY_GATEWAY_EIP712_DOMAIN,
    types: KEY_GATEWAY_ADD_TYPES,
    primaryType: "Add",
    message: {
      owner: input.owner,
      keyType: FARCASTER_ED25519_KEY_TYPE,
      key: input.key,
      metadataType: input.metadataType,
      metadata: input.metadata,
      nonce: input.nonce.toString(),
      deadline: input.deadline.toString(),
    },
  };
}

export async function verifyAddSignature(input: {
  owner: Address;
  key: Hex;
  metadataType: number;
  metadata: Hex;
  nonce: bigint;
  deadline: bigint;
  signature: Hex;
}): Promise<boolean> {
  return verifyTypedData({
    address: input.owner,
    domain: KEY_GATEWAY_EIP712_DOMAIN,
    types: KEY_GATEWAY_ADD_TYPES,
    primaryType: "Add",
    message: {
      owner: input.owner,
      keyType: FARCASTER_ED25519_KEY_TYPE,
      key: input.key,
      metadataType: input.metadataType,
      metadata: input.metadata,
      nonce: input.nonce,
      deadline: input.deadline,
    },
    signature: input.signature,
  });
}

export function removeTypedData(input: {
  owner: Address;
  key: Hex;
  nonce: bigint;
  deadline: bigint;
}): RemoveTypedData {
  return {
    domain: KEY_REGISTRY_EIP712_DOMAIN,
    types: KEY_REGISTRY_REMOVE_TYPES,
    primaryType: "Remove",
    message: {
      owner: input.owner,
      key: input.key,
      nonce: input.nonce.toString(),
      deadline: input.deadline.toString(),
    },
  };
}

export async function verifyRemoveSignature(input: {
  owner: Address;
  key: Hex;
  nonce: bigint;
  deadline: bigint;
  signature: Hex;
}): Promise<boolean> {
  return verifyTypedData({
    address: input.owner,
    domain: KEY_REGISTRY_EIP712_DOMAIN,
    types: KEY_REGISTRY_REMOVE_TYPES,
    primaryType: "Remove",
    message: {
      owner: input.owner,
      key: input.key,
      nonce: input.nonce,
      deadline: input.deadline,
    },
    signature: input.signature,
  });
}
