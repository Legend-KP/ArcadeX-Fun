/**
 * Sails codecs for ArcadeXRewards lite (CheckIn / Spin / queries).
 */
import {
  compactToU8a,
  hexToU8a,
  stringToU8a,
  u8aConcat,
  u8aToHex,
} from "@polkadot/util";
import type { HexString } from "@/lib/shop-vara";
import { toVaraActorId } from "@/lib/vara-address";
import {
  VARA_REWARDS_CHECK_IN_METHOD,
  VARA_REWARDS_SERVICE,
  VARA_REWARDS_SPIN_METHOD,
} from "@/lib/vara-rewards";

function encodeString(value: string): Uint8Array {
  const bytes = stringToU8a(value);
  return u8aConcat(compactToU8a(bytes.length), bytes);
}

function encodeU64(value: number | bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = BigInt(value);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return out;
}

function encodeU128(value: number | bigint): Uint8Array {
  const out = new Uint8Array(16);
  let v = BigInt(value);
  for (let i = 0; i < 16; i++) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return out;
}

function encodeU8(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}

function encodeBytes32(hexOrBytes: string | Uint8Array): Uint8Array {
  const bytes =
    typeof hexOrBytes === "string" ? hexToU8a(hexOrBytes) : hexOrBytes;
  if (bytes.length !== 32) {
    throw new Error("Expected 32 bytes.");
  }
  return bytes;
}

function encodeBytes64(hexOrBytes: string | Uint8Array): Uint8Array {
  const bytes =
    typeof hexOrBytes === "string" ? hexToU8a(hexOrBytes) : hexOrBytes;
  if (bytes.length !== 64) {
    throw new Error("Expected 64-byte signature.");
  }
  return bytes;
}

const ZERO_SIG = new Uint8Array(64);

/** `ArcadeXRewards::CheckIn(campaign_id, deadline, signature)` */
export function encodeRewardsCheckInPayload(
  campaignId: number,
  deadline: number | bigint = 0,
  signature: string | Uint8Array = ZERO_SIG
): HexString {
  return u8aToHex(
    u8aConcat(
      encodeString(VARA_REWARDS_SERVICE),
      encodeString(VARA_REWARDS_CHECK_IN_METHOD),
      encodeU64(campaignId),
      encodeU64(deadline),
      encodeBytes64(signature)
    )
  ) as HexString;
}

/** `ArcadeXRewards::Spin(...)` */
export function encodeRewardsSpinPayload(params: {
  campaignId: number;
  rewardMode: number;
  rewardAmount: bigint | number;
  nonce: number | bigint;
  deadline: number | bigint;
  signature: string | Uint8Array;
}): HexString {
  return u8aToHex(
    u8aConcat(
      encodeString(VARA_REWARDS_SERVICE),
      encodeString(VARA_REWARDS_SPIN_METHOD),
      encodeU64(params.campaignId),
      encodeU8(params.rewardMode),
      encodeU128(params.rewardAmount),
      encodeU64(params.nonce),
      encodeU64(params.deadline),
      encodeBytes64(params.signature)
    )
  ) as HexString;
}

export function encodeRewardsGetProgressPayload(
  playerAddress: string,
  campaignId: number
): HexString {
  return u8aToHex(
    u8aConcat(
      encodeString(VARA_REWARDS_SERVICE),
      encodeString("GetProgress"),
      encodeBytes32(toVaraActorId(playerAddress)),
      encodeU64(campaignId)
    )
  ) as HexString;
}

export function encodeRewardsGetCampaignPayload(campaignId: number): HexString {
  return u8aToHex(
    u8aConcat(
      encodeString(VARA_REWARDS_SERVICE),
      encodeString("GetCampaign"),
      encodeU64(campaignId)
    )
  ) as HexString;
}

export function encodeRewardsSpinNoncePayload(
  playerAddress: string,
  campaignId: number
): HexString {
  return u8aToHex(
    u8aConcat(
      encodeString(VARA_REWARDS_SERVICE),
      encodeString("SpinNonceOf"),
      encodeBytes32(toVaraActorId(playerAddress)),
      encodeU64(campaignId)
    )
  ) as HexString;
}

function readCompact(bytes: Uint8Array, offset: number): [number, number] {
  const first = bytes[offset];
  const mode = first & 0b11;
  if (mode === 0) return [1, first >> 2];
  if (mode === 1) {
    return [2, ((first | (bytes[offset + 1] << 8)) >> 2) >>> 0];
  }
  if (mode === 2) {
    return [
      4,
      ((first |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>
        2) >>>
        0,
    ];
  }
  throw new Error("Unsupported compact length.");
}

/** Skip sails service+method string prefixes in a reply. */
function skipTwoStrings(bytes: Uint8Array, offset: number): number {
  let o = offset;
  for (let i = 0; i < 2; i++) {
    const [lenBytes, strLen] = readCompact(bytes, o);
    o += lenBytes + strLen;
  }
  return o;
}

function readU16(bytes: Uint8Array, offset: number): [number, number] {
  return [bytes[offset] | (bytes[offset + 1] << 8), offset + 2];
}

function readU32(bytes: Uint8Array, offset: number): [number, number] {
  return [
    bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24),
    offset + 4,
  ];
}

function readU64(bytes: Uint8Array, offset: number): [bigint, number] {
  let v = BigInt(0);
  for (let i = 0; i < 8; i++) {
    v |= BigInt(bytes[offset + i]) << BigInt(8 * i);
  }
  return [v, offset + 8];
}

function readU128(bytes: Uint8Array, offset: number): [bigint, number] {
  let v = BigInt(0);
  for (let i = 0; i < 16; i++) {
    v |= BigInt(bytes[offset + i]) << BigInt(8 * i);
  }
  return [v, offset + 16];
}

function readBool(bytes: Uint8Array, offset: number): [boolean, number] {
  return [bytes[offset] !== 0, offset + 1];
}

export type VaraRewardsProgress = {
  currentDay: number;
  lastCheckInAt: number;
  milestoneReached: boolean;
  onChainClaimed: boolean;
  initialized: boolean;
};

export type VaraRewardsCampaign = {
  active: boolean;
  cancelled: boolean;
  requireEligibility: boolean;
  campaignType: number;
  requiredDays: number;
  minIntervalSeconds: number;
  maxClaims: number;
  startTime: number;
  endTime: number;
  rewardMode: number;
  rewardAmount: bigint;
  rewardMeta: HexString;
  resetAfterMilestone: boolean;
  maxSinglePayout: bigint;
};

/** Decode GetProgress reply (service/method strings + Progress struct). */
export function decodeRewardsProgressReply(payloadHex: string): VaraRewardsProgress {
  const bytes = hexToU8a(payloadHex);
  let o = 0;
  try {
    o = skipTwoStrings(bytes, 0);
  } catch {
    o = 0;
  }
  let currentDay: number;
  [currentDay, o] = readU16(bytes, o);
  let lastCheckInAt: bigint;
  [lastCheckInAt, o] = readU64(bytes, o);
  let milestoneReached: boolean;
  [milestoneReached, o] = readBool(bytes, o);
  let onChainClaimed: boolean;
  [onChainClaimed, o] = readBool(bytes, o);
  let initialized: boolean;
  [initialized, o] = readBool(bytes, o);
  return {
    currentDay,
    lastCheckInAt: Number(lastCheckInAt),
    milestoneReached,
    onChainClaimed,
    initialized,
  };
}

/** Decode GetCampaign reply. */
export function decodeRewardsCampaignReply(payloadHex: string): VaraRewardsCampaign {
  const bytes = hexToU8a(payloadHex);
  let o = 0;
  try {
    o = skipTwoStrings(bytes, 0);
  } catch {
    o = 0;
  }
  let active: boolean;
  [active, o] = readBool(bytes, o);
  let cancelled: boolean;
  [cancelled, o] = readBool(bytes, o);
  let requireEligibility: boolean;
  [requireEligibility, o] = readBool(bytes, o);
  const campaignType = bytes[o++];
  let requiredDays: number;
  [requiredDays, o] = readU16(bytes, o);
  let minIntervalSeconds: number;
  [minIntervalSeconds, o] = readU32(bytes, o);
  let maxClaims: number;
  [maxClaims, o] = readU32(bytes, o);
  let startTime: bigint;
  [startTime, o] = readU64(bytes, o);
  let endTime: bigint;
  [endTime, o] = readU64(bytes, o);
  const rewardMode = bytes[o++];
  let rewardAmount: bigint;
  [rewardAmount, o] = readU128(bytes, o);
  const rewardMeta = u8aToHex(bytes.slice(o, o + 32)) as HexString;
  o += 32;
  let resetAfterMilestone: boolean;
  [resetAfterMilestone, o] = readBool(bytes, o);
  let maxSinglePayout: bigint;
  [maxSinglePayout, o] = readU128(bytes, o);
  return {
    active,
    cancelled,
    requireEligibility,
    campaignType,
    requiredDays,
    minIntervalSeconds,
    maxClaims,
    startTime: Number(startTime),
    endTime: Number(endTime),
    rewardMode,
    rewardAmount,
    rewardMeta,
    resetAfterMilestone,
    maxSinglePayout,
  };
}

export function decodeRewardsU64Reply(payloadHex: string): bigint {
  const bytes = hexToU8a(payloadHex);
  let o = 0;
  try {
    o = skipTwoStrings(bytes, 0);
  } catch {
    o = 0;
  }
  const [v] = readU64(bytes, o);
  return v;
}

export { encodeString as encodeRewardsScaleString };
