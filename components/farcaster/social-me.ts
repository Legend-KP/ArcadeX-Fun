import type { SocialProfile } from "@/types";

/** Shape of GET /api/farcaster/me. Email stays on this signed-in payload. */
export type SocialMe = {
  signedIn?: boolean;
  playerId?: string;
  fid?: number;
  address?: string;
  profile?: SocialProfile | null;
  usernameSkipped?: boolean;
  custody?: string | null;
  recovery?: string | null;
  custodyChanged?: boolean;
  neynar?: {
    username?: string;
    display_name?: string;
    pfp_url?: string;
  } | null;
  error?: string;
};

/** Account, email, and username (or skip) are done. */
export function isSocialProfileReady(me: SocialMe | null | undefined): boolean {
  if (!me?.fid) return false;
  const emailVerified = Boolean(me.profile?.emailVerifiedAt);
  const usernameDone =
    Boolean(me.profile?.username) || Boolean(me.usernameSkipped);
  return emailVerified && usernameDone;
}

export function socialIdentity(me: SocialMe) {
  const profile = me.profile;
  const displayName =
    profile?.displayName ||
    me.neynar?.display_name ||
    profile?.fname ||
    profile?.username ||
    "Player";

  return {
    displayName,
    fname: profile?.fname || me.neynar?.username || null,
    username: profile?.username || null,
    pfpUrl: profile?.pfpUrl || me.neynar?.pfp_url || null,
    fid: me.fid ?? profile?.fid ?? null,
    playerId: me.playerId || profile?.playerId || null,
  };
}
