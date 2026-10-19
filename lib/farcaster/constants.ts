/**
 * Farcaster Id Registry on Optimism mainnet.
 * @see https://docs.farcaster.xyz/reference/contracts
 *
 * Sponsor policy (v0): ArcadeX pays FID registration via Neynar app wallet
 * (`NEYNAR_WALLET_ID` → `x-wallet-id`). Never drip ETH to the user.
 */

export const ID_REGISTRY_ADDRESS =
  "0x00000000Fc6c5F01Fc30151999387Bb99A9f489b" as const;

/** Protocol recovery proxy — default when user does not supply a recovery address. */
export const FARCASTER_RECOVERY_PROXY =
  "0x00000000FcB080a4D6c39a9354dA9EB9bC104cd7" as const;

export const ID_REGISTRY_ABI = [
  {
    type: "function",
    name: "idOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "fid", type: "uint256" }],
  },
  {
    type: "function",
    name: "custodyOf",
    stateMutability: "view",
    inputs: [{ name: "fid", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
  {
    type: "function",
    name: "recoveryOf",
    stateMutability: "view",
    inputs: [{ name: "fid", type: "uint256" }],
    outputs: [{ name: "recovery", type: "address" }],
  },
] as const;

export const NEYNAR_API_BASE = "https://api.neynar.com/v2";

/** Max sponsored FID mints per IP per day (P1 spend guard). */
export const SPONSORED_MINT_DAILY_LIMIT = 5;
