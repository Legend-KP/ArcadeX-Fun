import type { Address, Hex } from "viem";
import { keccak256, toBytes } from "viem";
import {
  BASE_MAINNET_DEPLOYMENTS,
  envAddress,
} from "@/lib/base-deployments";
import {
  AVALANCHE_MAINNET_DEPLOYMENTS,
  avalancheEnvAddress,
} from "@/lib/avalanche-deployments";
import { avalanche, base, PRIMARY_EVM_CHAIN_ID } from "@/lib/chains";

/** ArcadeXRewards on Base mainnet — daily check-in is app sign-in. */
export const ARCADEX_REWARDS_CONTRACT_ADDRESS = envAddress(
  process.env.NEXT_PUBLIC_ARCADEX_REWARDS_CONTRACT,
  BASE_MAINNET_DEPLOYMENTS.arcadeXRewards
);

/** ArcadeXRewards on Avalanche C-Chain — parallel streak check-in. */
export const AVALANCHE_ARCADEX_REWARDS_CONTRACT_ADDRESS = avalancheEnvAddress(
  process.env.NEXT_PUBLIC_AVALANCHE_ARCADEX_REWARDS_CONTRACT,
  AVALANCHE_MAINNET_DEPLOYMENTS.arcadeXRewards
);

export const DEFAULT_STREAK_CAMPAIGN_ID = Number(
  process.env.NEXT_PUBLIC_STREAK_CAMPAIGN_ID?.trim() ||
    String(BASE_MAINNET_DEPLOYMENTS.streakCampaignId)
);

export const AVALANCHE_STREAK_CAMPAIGN_ID = Number(
  process.env.NEXT_PUBLIC_AVALANCHE_STREAK_CAMPAIGN_ID?.trim() ||
    String(AVALANCHE_MAINNET_DEPLOYMENTS.streakCampaignId)
);

export const AVALANCHE_CHAIN_ID = avalanche.id;

export function isAvalancheRewardsChainId(chainId?: number | null): boolean {
  return Number(chainId) === AVALANCHE_CHAIN_ID;
}

export function getArcadeXRewardsAddress(
  chainId?: number | null
): Address {
  if (isAvalancheRewardsChainId(chainId)) {
    return AVALANCHE_ARCADEX_REWARDS_CONTRACT_ADDRESS;
  }
  return ARCADEX_REWARDS_CONTRACT_ADDRESS;
}

export function getStreakCampaignIdForChain(
  chainId?: number | null
): number {
  if (isAvalancheRewardsChainId(chainId)) {
    return AVALANCHE_STREAK_CAMPAIGN_ID;
  }
  return DEFAULT_STREAK_CAMPAIGN_ID;
}

export function isArcadeXRewardsConfiguredForChain(
  chainId?: number | null
): boolean {
  if (isAvalancheRewardsChainId(chainId)) {
    return (
      AVALANCHE_ARCADEX_REWARDS_CONTRACT_ADDRESS !==
      "0x0000000000000000000000000000000000000000"
    );
  }
  if (
    chainId == null ||
    Number(chainId) === PRIMARY_EVM_CHAIN_ID ||
    Number(chainId) === base.id
  ) {
    return isArcadeXRewardsConfigured();
  }
  return false;
}

export const CAMPAIGN_TYPE_STREAK = 0;
export const CAMPAIGN_TYPE_SHUFFLE = 1;

export const REWARD_OFFCHAIN = 0;
export const REWARD_ERC721 = 1;
export const REWARD_USDT = 2;
export const REWARD_USDC = 3;

/** Must match deploy script rewardMeta = ethers.id("INFINITE_SPARK_24H") */
export const INFINITE_SPARK_REWARD_META = keccak256(
  toBytes("INFINITE_SPARK_24H")
) as Hex;

/** Full ABI — ArcadeXRewards on Base mainnet */
/** Minimal ABI for Base ArcadeXRewards (Worker size budget). */
export const ARCADEX_REWARDS_ABI = [
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "player",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "day",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "CheckedIn",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "player",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "day",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "rewardMode",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "rewardMeta",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "MilestoneReached",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "player",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "rewardMode",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "rewardTarget",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "rewardAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "SpinResultGranted",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "deadline",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      }
    ],
    "name": "checkIn",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "name": "claim",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "name": "getCampaign",
    "outputs": [
      {
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "cancelled",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "requireEligibility",
        "type": "bool"
      },
      {
        "internalType": "enum ArcadeXRewards.CampaignType",
        "name": "campaignType",
        "type": "uint8"
      },
      {
        "internalType": "uint16",
        "name": "requiredDays",
        "type": "uint16"
      },
      {
        "internalType": "uint32",
        "name": "minIntervalSeconds",
        "type": "uint32"
      },
      {
        "internalType": "uint32",
        "name": "maxClaims",
        "type": "uint32"
      },
      {
        "internalType": "uint64",
        "name": "startTime",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "endTime",
        "type": "uint64"
      },
      {
        "internalType": "uint8",
        "name": "rewardMode",
        "type": "uint8"
      },
      {
        "internalType": "address",
        "name": "rewardTarget",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "rewardAmount",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "rewardMeta",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "resetAfterMilestone",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "maxSinglePayout",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "player",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "name": "getProgress",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "currentDay",
        "type": "uint16"
      },
      {
        "internalType": "uint64",
        "name": "lastCheckInAt",
        "type": "uint64"
      },
      {
        "internalType": "bool",
        "name": "milestoneReached",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "onChainClaimed",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "initialized",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "canCheckIn",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "streakWouldReset",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "rewardMode",
        "type": "uint8"
      },
      {
        "internalType": "address",
        "name": "rewardTarget",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "rewardAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "nonce",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "deadline",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      }
    ],
    "name": "spin",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "spinNonce",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export function isArcadeXRewardsConfigured(): boolean {
  return (
    ARCADEX_REWARDS_CONTRACT_ADDRESS !==
    "0x0000000000000000000000000000000000000000"
  );
}

export function isAnyArcadeXRewardsConfigured(): boolean {
  return (
    isArcadeXRewardsConfigured() ||
    isArcadeXRewardsConfiguredForChain(AVALANCHE_CHAIN_ID)
  );
}
