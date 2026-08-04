import type { HexString } from "@/lib/shop-vara";
import { compactFromU8aLim, hexToU8a, u8aToHex } from "@polkadot/util";
import { decodeAddress } from "@polkadot/util-crypto";

export function toVaraActorId(address: string): HexString {
  const trimmed = address.trim();
  if (trimmed.startsWith("0x") && trimmed.length === 66) {
    return trimmed as HexString;
  }

  return u8aToHex(decodeAddress(trimmed)) as HexString;
}

export function getVftPayloadDataOffset(payloadHex: HexString): number {
  const payload = hexToU8a(payloadHex);
  const [serviceOffset, serviceSize] = compactFromU8aLim(payload);
  const fnStart = serviceOffset + serviceSize;
  const [fnOffset, fnSize] = compactFromU8aLim(payload.subarray(fnStart));
  return fnStart + fnOffset + fnSize;
}
