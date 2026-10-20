import type { SocialProfile } from "@/types";

/** Public search and profile pages never include the email address. */
export function toPublicSocialProfile(profile: SocialProfile | null) {
  if (!profile) return null;
  return {
    playerId: profile.playerId,
    fid: profile.fid,
    primaryWallet: profile.primaryWallet,
    username: profile.username,
    displayName: profile.displayName,
    fname: profile.fname,
    pfpUrl: profile.pfpUrl,
    custodyAddress: profile.custodyAddress,
    recoveryAddress: profile.recoveryAddress,
    emailVerified: Boolean(profile.emailVerifiedAt),
  };
}
