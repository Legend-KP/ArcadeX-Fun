/**
 * Farcaster Id Registry on Optimism mainnet.
 * @see https://docs.farcaster.xyz/reference/contracts
 *
 * Sponsor policy (v0): ArcadeX pays FID registration via Neynar app wallet
 * (`NEYNAR_WALLET_ID` → `x-wallet-id`). Never drip ETH to the user.
 */

export const ID_REGISTRY_ADDRESS =
  "0x00000000Fc6c5F01Fc30151999387Bb99A9f489b" as const;

/** IdGateway on Optimism. EIP-712 domain for sponsored `registerFor`. */
export const ID_GATEWAY_ADDRESS =
  "0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69" as const;

export const ID_GATEWAY_EIP712_DOMAIN = {
  name: "Farcaster IdGateway",
  version: "1",
  chainId: 10,
  verifyingContract: ID_GATEWAY_ADDRESS,
} as const;

export const ID_GATEWAY_REGISTER_TYPES = {
  Register: [
    { name: "to", type: "address" },
    { name: "recovery", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

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
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const ID_GATEWAY_ABI = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** KeyGateway on Optimism. Users approve app signers with an EIP-712 Add. */
export const KEY_GATEWAY_ADDRESS =
  "0x00000000fC56947c7E7183f8Ca4B62398CaAdf0B" as const;

export const KEY_GATEWAY_EIP712_DOMAIN = {
  name: "Farcaster KeyGateway",
  version: "1",
  chainId: 10,
  verifyingContract: KEY_GATEWAY_ADDRESS,
} as const;

export const KEY_GATEWAY_ADD_TYPES = {
  Add: [
    { name: "owner", type: "address" },
    { name: "keyType", type: "uint32" },
    { name: "key", type: "bytes" },
    { name: "metadataType", type: "uint8" },
    { name: "metadata", type: "bytes" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** KeyRegistry on Optimism. Removing a signer is a separate EIP-712 Remove. */
export const KEY_REGISTRY_ADDRESS =
  "0x00000000Fc1237824fb747aBDE0FF18990E59b7e" as const;

export const KEY_REGISTRY_EIP712_DOMAIN = {
  name: "Farcaster KeyRegistry",
  version: "1",
  chainId: 10,
  verifyingContract: KEY_REGISTRY_ADDRESS,
} as const;

export const KEY_REGISTRY_REMOVE_TYPES = {
  Remove: [
    { name: "owner", type: "address" },
    { name: "key", type: "bytes" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Attributes a signer to ArcadeX's app fid when the app account signs it. */
export const SIGNED_KEY_REQUEST_VALIDATOR_ADDRESS =
  "0x00000000FC700472606ED4fA22623Acf62c60553" as const;

export const SIGNED_KEY_REQUEST_EIP712_DOMAIN = {
  name: "Farcaster SignedKeyRequestValidator",
  version: "1",
  chainId: 10,
  verifyingContract: SIGNED_KEY_REQUEST_VALIDATOR_ADDRESS,
} as const;

export const SIGNED_KEY_REQUEST_TYPES = {
  SignedKeyRequest: [
    { name: "requestFid", type: "uint256" },
    { name: "key", type: "bytes" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** One storage unit, paid by the custody wallet when the signer is added. */
export const STORAGE_REGISTRY_ADDRESS =
  "0x00000000fcCe7f938e7aE6D3c335bD6a1a7c593D" as const;

/** Ed25519 signer key type on the Farcaster key contracts. */
export const FARCASTER_ED25519_KEY_TYPE = 1;

/** SignedKeyRequest metadata. 0 means the user is adding a raw key. */
export const FARCASTER_SIGNED_KEY_REQUEST_METADATA_TYPE = 1;

export const NEYNAR_API_BASE = "https://api.neynar.com/v2";

/** Max sponsored FID mints per IP per day (P1 spend guard). */
export const SPONSORED_MINT_DAILY_LIMIT = 5;
