/**
 * Light verify + state reads for ArcadeXRewards on Vara (Workers-safe).
 */
import type { HexString } from "@/lib/shop-vara";
import { isValidVaraExtrinsicHash, VARA_RPC_URL } from "@/lib/shop-vara";
import { toVaraActorId } from "@/lib/vara-address";
import { findVaraExtrinsic } from "@/lib/vara-extrinsic-lookup";
import {
  assertVaraArcadeXRewardsConfigured,
  VARA_REWARDS_CHECK_IN_METHOD,
  VARA_REWARDS_SERVICE,
  VARA_REWARDS_SPIN_METHOD,
  VARA_REWARD_OFFCHAIN,
} from "@/lib/vara-rewards";
import {
  decodeRewardsCampaignReply,
  decodeRewardsProgressReply,
  decodeRewardsU64Reply,
  encodeRewardsCheckInPayload,
  encodeRewardsGetCampaignPayload,
  encodeRewardsGetProgressPayload,
  encodeRewardsScaleString,
  encodeRewardsSpinNoncePayload,
  encodeRewardsSpinPayload,
  type VaraRewardsCampaign,
  type VaraRewardsProgress,
} from "@/lib/vara-rewards-codec";

const HTTP_RPC = VARA_RPC_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
const ZERO_ORIGIN =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function includesBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(HTTP_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Vara RPC HTTP ${res.status}`);
  const json = (await res.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (json.error) throw new Error(json.error.message || "Vara RPC error");
  return json.result as T;
}

async function calculateReplyForHandle(
  programId: string,
  payload: string
): Promise<string> {
  const reply = await rpc<{ payload?: string }>("gear_calculateReplyForHandle", [
    ZERO_ORIGIN,
    programId,
    payload,
    250_000_000_000,
    "0",
  ]);
  if (!reply?.payload) {
    throw new Error("Empty Gear reply payload.");
  }
  return reply.payload;
}

export async function readVaraRewardsProgress(
  walletAddress: string,
  campaignId: number
): Promise<VaraRewardsProgress> {
  const programId = assertVaraArcadeXRewardsConfigured();
  const payload = encodeRewardsGetProgressPayload(walletAddress, campaignId);
  const reply = await calculateReplyForHandle(programId, payload);
  return decodeRewardsProgressReply(reply);
}

export async function readVaraRewardsCampaign(
  campaignId: number
): Promise<VaraRewardsCampaign> {
  const programId = assertVaraArcadeXRewardsConfigured();
  const payload = encodeRewardsGetCampaignPayload(campaignId);
  const reply = await calculateReplyForHandle(programId, payload);
  return decodeRewardsCampaignReply(reply);
}

export async function readVaraSpinNonce(
  walletAddress: string,
  campaignId: number
): Promise<bigint> {
  const programId = assertVaraArcadeXRewardsConfigured();
  const payload = encodeRewardsSpinNoncePayload(walletAddress, campaignId);
  const reply = await calculateReplyForHandle(programId, payload);
  return decodeRewardsU64Reply(reply);
}

function utcDay(tsSecs: number): number {
  return Math.floor(tsSecs / 86_400);
}

export async function readVaraStreakProgress(
  walletAddress: string,
  campaignId: number
) {
  const [progress, campaign] = await Promise.all([
    readVaraRewardsProgress(walletAddress, campaignId),
    readVaraRewardsCampaign(campaignId),
  ]);

  const nowSec = Math.floor(Date.now() / 1000);
  const last = progress.lastCheckInAt || 0;
  let canCheckIn = true;
  let streakWouldReset = false;

  if (progress.initialized && last > 0) {
    const lastDay = utcDay(last);
    const today = utcDay(nowSec);
    canCheckIn = today > lastDay;
    streakWouldReset = today > lastDay + 1;
  }

  if (!campaign.active || campaign.cancelled) {
    canCheckIn = false;
  }

  return {
    campaignId,
    currentDay: progress.currentDay,
    lastCheckInAt: progress.lastCheckInAt,
    milestoneReached: progress.milestoneReached,
    onChainClaimed: progress.onChainClaimed,
    initialized: progress.initialized,
    canCheckIn,
    streakWouldReset,
    campaign: {
      active: campaign.active,
      cancelled: campaign.cancelled,
      requireEligibility: campaign.requireEligibility,
      campaignType: campaign.campaignType,
      requiredDays: campaign.requiredDays,
      minIntervalSeconds: campaign.minIntervalSeconds,
      maxClaims: campaign.maxClaims,
      startTime: campaign.startTime,
      endTime: campaign.endTime,
      rewardMode: campaign.rewardMode,
      resetAfterMilestone: campaign.resetAfterMilestone,
      maxSinglePayout: campaign.maxSinglePayout.toString(),
    },
  };
}

export async function verifyVaraCheckInTx(params: {
  txHash: HexString | string;
  expectedFrom: string;
  campaignId: number;
}): Promise<{
  day: number;
  timestamp: number;
  milestone: boolean;
  programId: HexString;
}> {
  const programIdHex = assertVaraArcadeXRewardsConfigured();
  if (!isValidVaraExtrinsicHash(String(params.txHash))) {
    throw new Error("Invalid Vara extrinsic hash.");
  }

  const { extrinsicHex } = await findVaraExtrinsic(params.txHash);
  const bytes = hexToBytes(extrinsicHex);
  const programId = hexToBytes(programIdHex.toLowerCase());
  const signerId = hexToBytes(toVaraActorId(params.expectedFrom));
  const expectedPayload = hexToBytes(
    encodeRewardsCheckInPayload(params.campaignId)
  );

  if (!includesBytes(bytes, programId)) {
    throw new Error("Check-in transaction does not target ArcadeXRewards.");
  }
  if (!includesBytes(bytes, signerId)) {
    throw new Error("Check-in transaction signer mismatch.");
  }
  if (!includesBytes(bytes, expectedPayload)) {
    if (
      !includesBytes(bytes, encodeRewardsScaleString(VARA_REWARDS_SERVICE)) ||
      !includesBytes(bytes, encodeRewardsScaleString(VARA_REWARDS_CHECK_IN_METHOD))
    ) {
      throw new Error("Check-in transaction method mismatch.");
    }
  }

  // Prefer live progress after the extrinsic is included.
  const [progress, campaign] = await Promise.all([
    readVaraRewardsProgress(params.expectedFrom, params.campaignId),
    readVaraRewardsCampaign(params.campaignId),
  ]);
  if (!progress.initialized || progress.lastCheckInAt <= 0) {
    throw new Error("Check-in not reflected on-chain yet. Retry shortly.");
  }

  const milestone =
    progress.milestoneReached ||
    (campaign.resetAfterMilestone &&
      progress.currentDay === 0 &&
      progress.lastCheckInAt > 0);

  return {
    day: progress.currentDay || (milestone ? campaign.requiredDays : 1),
    timestamp: progress.lastCheckInAt,
    milestone,
    rewardMode: campaign.rewardMode,
    rewardMeta: campaign.rewardMeta,
    programId: programIdHex,
  };
}

export async function verifyVaraSpinTx(params: {
  txHash: HexString | string;
  expectedFrom: string;
  campaignId: number;
  rewardMode: number;
  rewardAmount: bigint | number;
  nonce: number | bigint;
  deadline: number | bigint;
  signature: string;
}): Promise<{ programId: HexString }> {
  const programIdHex = assertVaraArcadeXRewardsConfigured();
  if (!isValidVaraExtrinsicHash(String(params.txHash))) {
    throw new Error("Invalid Vara extrinsic hash.");
  }
  if (params.rewardMode !== VARA_REWARD_OFFCHAIN) {
    throw new Error("Vara lite shuffle only supports off-chain rewards.");
  }

  const { extrinsicHex } = await findVaraExtrinsic(params.txHash);
  const bytes = hexToBytes(extrinsicHex);
  const programId = hexToBytes(programIdHex.toLowerCase());
  const signerId = hexToBytes(toVaraActorId(params.expectedFrom));
  const expectedPayload = hexToBytes(
    encodeRewardsSpinPayload({
      campaignId: params.campaignId,
      rewardMode: params.rewardMode,
      rewardAmount: params.rewardAmount,
      nonce: params.nonce,
      deadline: params.deadline,
      signature: params.signature,
    })
  );

  if (!includesBytes(bytes, programId)) {
    throw new Error("Spin transaction does not target ArcadeXRewards.");
  }
  if (!includesBytes(bytes, signerId)) {
    throw new Error("Spin transaction signer mismatch.");
  }
  if (!includesBytes(bytes, expectedPayload)) {
    if (
      !includesBytes(bytes, encodeRewardsScaleString(VARA_REWARDS_SERVICE)) ||
      !includesBytes(bytes, encodeRewardsScaleString(VARA_REWARDS_SPIN_METHOD))
    ) {
      throw new Error("Spin transaction method mismatch.");
    }
  }

  return { programId: programIdHex };
}
