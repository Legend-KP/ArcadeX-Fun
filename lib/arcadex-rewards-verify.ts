import {
  decodeEventLog,
  getAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import {
  ARCADEX_REWARDS_ABI,
  DEFAULT_STREAK_CAMPAIGN_ID,
  INFINITE_SPARK_REWARD_META,
  REWARD_OFFCHAIN,
  getArcadeXRewardsAddress,
  isArcadeXRewardsConfiguredForChain,
  isAvalancheRewardsChainId,
} from "@/lib/arcadex-rewards";
import { readBaseContractWithFailover } from "@/lib/base-public-client";
import { readAvalancheContractWithFailover } from "@/lib/avalanche-public-client";
import { getPaymentTransactionReceipt } from "@/lib/payment-tx-verify";

export interface VerifiedCheckIn {
  player: Address;
  campaignId: bigint;
  day: number;
  timestamp: bigint;
  milestone: VerifiedMilestone | null;
}

export interface VerifiedMilestone {
  player: Address;
  campaignId: bigint;
  day: number;
  rewardMode: number;
  rewardMeta: Hex;
  timestamp: bigint;
}

function assertConfigured(chainId?: number | null): void {
  if (!isArcadeXRewardsConfiguredForChain(chainId)) {
    throw new Error("ArcadeXRewards contract address is not configured.");
  }
}

async function readRewardsContractWithFailover<T>(
  chainId: number | null | undefined,
  params: {
    address: Address;
    abi: typeof ARCADEX_REWARDS_ABI;
    functionName: string;
    args: readonly unknown[];
  }
): Promise<T> {
  if (isAvalancheRewardsChainId(chainId)) {
    return readAvalancheContractWithFailover<T>(params as never);
  }
  return readBaseContractWithFailover<T>(params as never);
}

export async function verifyCheckInTx(
  walletAddress: string,
  txHash: Hash,
  expectedCampaignId: number = DEFAULT_STREAK_CAMPAIGN_ID,
  chainId?: number | null
): Promise<VerifiedCheckIn> {
  assertConfigured(chainId);
  const rewardsAddress = getArcadeXRewardsAddress(chainId);
  const expectedPlayer = getAddress(walletAddress);
  // Fast receipt poll (same path as Spark payments) — long waitFor hangs Workers.
  const receipt = await getPaymentTransactionReceipt(txHash, chainId);

  if (receipt.status !== "success") {
    throw new Error("Check-in transaction did not succeed.");
  }

  if (receipt.to?.toLowerCase() !== rewardsAddress.toLowerCase()) {
    throw new Error("Transaction was not sent to ArcadeXRewards.");
  }

  let checkIn: VerifiedCheckIn | null = null;
  let milestone: VerifiedMilestone | null = null;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== rewardsAddress.toLowerCase()) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: ARCADEX_REWARDS_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === "CheckedIn") {
        const { player, campaignId, day, timestamp } = decoded.args as {
          player: Address;
          campaignId: bigint;
          day: number;
          timestamp: bigint;
        };

        if (getAddress(player) !== expectedPlayer) {
          throw new Error(
            `Check-in wallet does not match your account. Tx was from ${getAddress(player)}, but you are signed in as ${expectedPlayer}. Disconnect and reconnect with the wallet that sent the check-in, then tap Confirm.`
          );
        }
        if (Number(campaignId) !== expectedCampaignId) {
          throw new Error("Check-in is for a different campaign.");
        }

        checkIn = {
          player: getAddress(player),
          campaignId,
          day: Number(day),
          timestamp,
          milestone: null,
        };
      }

      if (decoded.eventName === "MilestoneReached") {
        const args = decoded.args as {
          player: Address;
          campaignId: bigint;
          day: number;
          rewardMode: number;
          rewardMeta: Hex;
          timestamp: bigint;
        };

        if (getAddress(args.player) !== expectedPlayer) {
          throw new Error("Milestone wallet does not match your account.");
        }
        if (Number(args.campaignId) !== expectedCampaignId) {
          throw new Error("Milestone is for a different campaign.");
        }

        milestone = {
          player: getAddress(args.player),
          campaignId: args.campaignId,
          day: Number(args.day),
          rewardMode: Number(args.rewardMode),
          rewardMeta: args.rewardMeta,
          timestamp: args.timestamp,
        };
      }
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("does not match") ||
          err.message.includes("different campaign"))
      ) {
        throw err;
      }
      // Skip unrelated / undecodable logs
    }
  }

  if (!checkIn) {
    throw new Error("No CheckedIn event found in this transaction.");
  }

  checkIn.milestone = milestone;
  return checkIn;
}

export async function verifyOffchainMilestoneTx(
  walletAddress: string,
  txHash: Hash,
  expectedCampaignId: number = DEFAULT_STREAK_CAMPAIGN_ID,
  chainId?: number | null
): Promise<VerifiedMilestone> {
  const checkIn = await verifyCheckInTx(
    walletAddress,
    txHash,
    expectedCampaignId,
    chainId
  );

  if (!checkIn.milestone) {
    throw new Error("This check-in did not complete the streak milestone.");
  }

  if (checkIn.milestone.rewardMode !== REWARD_OFFCHAIN) {
    throw new Error("This campaign is not an off-chain reward campaign.");
  }

  if (
    checkIn.milestone.rewardMeta.toLowerCase() !==
    INFINITE_SPARK_REWARD_META.toLowerCase()
  ) {
    throw new Error("Unexpected reward metadata for Infinite Spark grant.");
  }

  return checkIn.milestone;
}

export async function readStreakProgress(
  walletAddress: string,
  campaignId: number = DEFAULT_STREAK_CAMPAIGN_ID,
  chainId?: number | null
) {
  assertConfigured(chainId);
  const player = getAddress(walletAddress);
  const rewardsAddress = getArcadeXRewardsAddress(chainId);

  const [progress, campaign] = await Promise.all([
    readRewardsContractWithFailover<
      readonly [number, bigint, boolean, boolean, boolean, boolean, boolean]
    >(chainId, {
      address: rewardsAddress,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "getProgress",
      args: [player, BigInt(campaignId)],
    }),
    readRewardsContractWithFailover<
      readonly [
        boolean,
        boolean,
        boolean,
        number,
        number,
        number,
        number,
        bigint,
        bigint,
        number,
        Address,
        bigint,
        Hex,
        boolean,
        bigint,
      ]
    >(chainId, {
      address: rewardsAddress,
      abi: ARCADEX_REWARDS_ABI,
      functionName: "getCampaign",
      args: [BigInt(campaignId)],
    }),
  ]);

  const [
    currentDay,
    lastCheckInAt,
    milestoneReached,
    onChainClaimed,
    initialized,
    canCheckIn,
    streakWouldReset,
  ] = progress;

  const [
    active,
    cancelled,
    requireEligibility,
    campaignType,
    requiredDays,
    minIntervalSeconds,
    maxClaims,
    startTime,
    endTime,
    rewardMode,
    rewardTarget,
    rewardAmount,
    rewardMeta,
    resetAfterMilestone,
    maxSinglePayout,
  ] = campaign;

  return {
    campaignId,
    currentDay: Number(currentDay),
    lastCheckInAt: Number(lastCheckInAt),
    milestoneReached,
    onChainClaimed,
    initialized,
    canCheckIn,
    streakWouldReset,
    campaign: {
      active,
      cancelled,
      requireEligibility,
      campaignType: Number(campaignType),
      requiredDays: Number(requiredDays),
      minIntervalSeconds: Number(minIntervalSeconds),
      maxClaims: Number(maxClaims),
      startTime: Number(startTime),
      endTime: Number(endTime),
      rewardMode: Number(rewardMode),
      rewardTarget: rewardTarget as Address,
      rewardAmount: rewardAmount.toString(),
      rewardMeta: rewardMeta as Hex,
      resetAfterMilestone,
      maxSinglePayout: maxSinglePayout.toString(),
    },
  };
}

export interface VerifiedSpin {
  player: Address;
  campaignId: bigint;
  rewardMode: number;
  rewardTarget: Address;
  rewardAmount: bigint;
  timestamp: bigint;
}

export async function verifySpinTx(
  walletAddress: string,
  txHash: Hash,
  expectedCampaignId: number,
  chainId?: number | null
): Promise<VerifiedSpin> {
  assertConfigured(chainId);
  const rewardsAddress = getArcadeXRewardsAddress(chainId);
  const expectedPlayer = getAddress(walletAddress);
  const receipt = await getPaymentTransactionReceipt(txHash, chainId);

  if (receipt.status !== "success") {
    throw new Error("Spin transaction did not succeed.");
  }

  if (receipt.to?.toLowerCase() !== rewardsAddress.toLowerCase()) {
    throw new Error("Transaction was not sent to ArcadeXRewards.");
  }

  let spin: VerifiedSpin | null = null;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== rewardsAddress.toLowerCase()) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: ARCADEX_REWARDS_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== "SpinResultGranted") continue;

      const args = decoded.args as {
        player: Address;
        campaignId: bigint;
        rewardMode: number;
        rewardTarget: Address;
        rewardAmount: bigint;
        timestamp: bigint;
      };

      if (getAddress(args.player) !== expectedPlayer) {
        throw new Error("Spin wallet does not match your account.");
      }
      if (Number(args.campaignId) !== expectedCampaignId) {
        throw new Error("Spin is for a different campaign.");
      }

      spin = {
        player: getAddress(args.player),
        campaignId: args.campaignId,
        rewardMode: Number(args.rewardMode),
        rewardTarget: getAddress(args.rewardTarget),
        rewardAmount: args.rewardAmount,
        timestamp: args.timestamp,
      };
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("does not match") ||
          err.message.includes("different campaign"))
      ) {
        throw err;
      }
    }
  }

  if (!spin) {
    throw new Error("No SpinResultGranted event found in this transaction.");
  }

  return spin;
}

export async function readSpinNonce(
  walletAddress: string,
  campaignId: number,
  chainId?: number | null
): Promise<bigint> {
  assertConfigured(chainId);
  const player = getAddress(walletAddress);
  return readRewardsContractWithFailover<bigint>(chainId, {
    address: getArcadeXRewardsAddress(chainId),
    abi: ARCADEX_REWARDS_ABI,
    functionName: "spinNonce",
    args: [player, BigInt(campaignId)],
  });
}
