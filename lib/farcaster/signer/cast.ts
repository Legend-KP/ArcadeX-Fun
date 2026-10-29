import {
  CastType,
  FarcasterNetwork,
  Message,
  MessageType,
  NobleEd25519Signer,
  makeCastAdd,
} from "@farcaster/core";
import { bytesToHex } from "viem";
import { SignerHttpError } from "@/lib/farcaster/signer/errors";
import { CAST_TEXT_MAX_BYTES } from "@/lib/farcaster/signer/permissions";

function messageHash(hash: Uint8Array | undefined): string {
  if (!hash || hash.length === 0) return "";
  return bytesToHex(hash);
}

/**
 * Build and sign one CastAdd. This module does not import builders for
 * reactions, links, profile data, verifications, or deletes.
 */
export async function signCastAdd(input: {
  fid: number;
  privateKey: Uint8Array;
  text: string;
}): Promise<{ encoded: Uint8Array; hash: string }> {
  const bytes = new TextEncoder().encode(input.text);
  if (bytes.length === 0 || bytes.length > CAST_TEXT_MAX_BYTES) {
    throw new SignerHttpError(
      `Cast text must be 1 to ${CAST_TEXT_MAX_BYTES} bytes.`,
      400
    );
  }

  const signer = new NobleEd25519Signer(input.privateKey);
  const result = await makeCastAdd(
    {
      type: CastType.CAST,
      formatVersion: 0,
      text: input.text,
      embeds: [],
      embedsDeprecated: [],
      mentions: [],
      mentionsPositions: [],
    },
    { fid: input.fid, network: FarcasterNetwork.MAINNET },
    signer
  );

  if (result.isErr()) {
    throw new SignerHttpError("Could not build the cast message.", 400);
  }

  const message = result.value;
  if (message.data?.type !== MessageType.CAST_ADD) {
    throw new SignerHttpError("Refusing to sign a message that is not a CastAdd.", 403);
  }

  const encoded = Message.encode(message).finish();
  return {
    encoded,
    hash: messageHash(message.hash),
  };
}
