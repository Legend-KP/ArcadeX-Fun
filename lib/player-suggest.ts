import { fetchSocialProfileByFid, searchSocialProfiles } from "@/lib/farcaster/social-db";
import {
  fetchNeynarFollowingFids,
  fetchNeynarUsersByFids,
  searchNeynarUsers,
  type NeynarUser,
} from "@/lib/farcaster/neynar";

export type SuggestedPlayer = {
  fid: number;
  name: string;
  handle: string | null;
  pfpUrl: string | null;
};

export function playerQueryMatches(
  query: string,
  ...fields: Array<string | null | undefined>
): boolean {
  const needle = query.trim().toLowerCase().replace(/^@/, "").replace(/\s+/g, " ");
  if (!needle) return false;
  const hay = fields
    .map((field) => field?.trim().toLowerCase())
    .filter((field): field is string => Boolean(field));
  if (hay.some((field) => field.includes(needle))) return true;
  const words = needle.split(" ").filter((word) => word.length > 1);
  if (words.length < 2) return false;
  return words.every((word) => hay.some((field) => field.includes(word)));
}

const followingCache = new Map<number, { at: number; users: NeynarUser[] }>();
const followingInflight = new Map<number, Promise<NeynarUser[]>>();

async function followingUsers(fid: number): Promise<NeynarUser[]> {
  const cached = followingCache.get(fid);
  if (cached && Date.now() - cached.at < 60_000) return cached.users;
  const pending = followingInflight.get(fid);
  if (pending) return pending;
  const request = fetchNeynarFollowingFids(fid)
    .then((fids) => fetchNeynarUsersByFids(fids))
    .then((users) => {
      followingCache.set(fid, { at: Date.now(), users });
      followingInflight.delete(fid);
      return users;
    })
    .catch((err) => {
      followingInflight.delete(fid);
      throw err;
    });
  followingInflight.set(fid, request);
  return request;
}

function fromNeynar(user: NeynarUser, handle?: string | null): SuggestedPlayer | null {
  if (!user.fid) return null;
  const username = handle?.replace(/^@/, "") || user.username || null;
  return {
    fid: user.fid,
    name: user.display_name || username || `FID ${user.fid}`,
    handle: username ? `@${username}` : null,
    pfpUrl: user.pfp_url || null,
  };
}

export async function suggestPlayers(
  query: string,
  viewerFid: number | null
): Promise<SuggestedPlayer[]> {
  const q = query.trim().replace(/^@/, "").slice(0, 40);
  if (!q) return [];

  const [local, following, remote] = await Promise.all([
    searchSocialProfiles(q, 8).catch(() => []),
    viewerFid
      ? followingUsers(viewerFid).catch(() => [] as NeynarUser[])
      : Promise.resolve([] as NeynarUser[]),
    q.length >= 2 ? searchNeynarUsers(q).catch(() => [] as NeynarUser[]) : Promise.resolve([]),
  ]);

  const players: SuggestedPlayer[] = [];
  const seen = new Set<number>();

  function add(player: SuggestedPlayer | null) {
    if (!player || seen.has(player.fid)) return;
    seen.add(player.fid);
    players.push(player);
  }

  for (const user of following) {
    if (!playerQueryMatches(q, user.display_name, user.username)) continue;
    add(fromNeynar(user));
  }

  for (const profile of local) {
    if (!profile.fid) continue;
    if (!playerQueryMatches(q, profile.displayName, profile.username, profile.fname)) continue;
    add({
      fid: profile.fid,
      name:
        profile.displayName ||
        profile.username ||
        profile.fname ||
        `FID ${profile.fid}`,
      handle: profile.username
        ? `@${profile.username}`
        : profile.fname
          ? `@${profile.fname}`
          : null,
      pfpUrl: profile.pfpUrl ?? null,
    });
  }

  for (const user of remote) {
    if (!playerQueryMatches(q, user.display_name, user.username)) continue;
    const arcade = await fetchSocialProfileByFid(user.fid).catch(() => null);
    const player = fromNeynar(user, arcade?.username || arcade?.fname || user.username);
    if (player && arcade) {
      player.name = arcade.displayName || player.name;
      player.pfpUrl = arcade.pfpUrl || player.pfpUrl;
    }
    add(player);
  }

  return players.slice(0, 8);
}
