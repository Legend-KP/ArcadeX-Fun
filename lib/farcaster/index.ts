/**
 * ArcadeX Farcaster layer
 *
 * Sponsor policy: FID registration is paid by ArcadeX via Neynar app wallet
 * (`NEYNAR_WALLET_ID`). Never drip ETH to users for mint.
 *
 * Identity storage: Cloudflare D1 (`ARCADEX_SOCIAL_DB`) — not Firebase RTDB.
 */

export {
  ID_REGISTRY_ADDRESS,
  FARCASTER_RECOVERY_PROXY,
  SPONSORED_MINT_DAILY_LIMIT,
} from "@/lib/farcaster/constants";
export {
  idOf,
  custodyOf,
  recoveryOf,
  registrationNonce,
  defaultRecoveryAddress,
} from "@/lib/farcaster/id-registry";
export {
  fetchNeynarUserByFid,
  fetchNeynarUserByCustodyAddress,
  fetchSponsoredFid,
  registerSponsoredAccount,
} from "@/lib/farcaster/neynar";
export {
  fetchSocialProfileByPlayerId,
  fetchSocialProfileByFid,
  fetchSocialProfileByUsername,
  upsertSocialProfile,
  isUsernameSkipped,
  setUsernameSkipped,
} from "@/lib/farcaster/social-db";
export { verifySiwfMessage } from "@/lib/farcaster/siwf";
