import { fetchNeynarUsersByFids, fetchNeynarFollowingFids } from "@/lib/farcaster/neynar";
import { requireSocialDb } from "@/lib/farcaster/social-db";
import { ensureSocialBoardSchema } from "@/lib/social-board";

const DAY_MS = 24 * 60 * 60 * 1000;
const ONLINE_MS = DAY_MS;

export type RailFriend = {
  fid: number;
  name: string;
  handle: string;
  pfpUrl: string | null;
};

export type RailActivity = {
  id: string;
  fid: number;
  name: string;
  handle: string;
  pfpUrl: string | null;
  gameId: string;
  gameName: string;
  createdAt: number;
};

type ProfileBit = {
  fid: number;
  username: string | null;
  display_name: string | null;
  fname: string | null;
  pfp_url: string | null;
};

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function friendFrom(
  fid: number,
  profile: ProfileBit | undefined,
  neynar?: { username?: string; display_name?: string; pfp_url?: string }
): RailFriend {
  const name =
    profile?.display_name ||
    neynar?.display_name ||
    profile?.fname ||
    neynar?.username ||
    profile?.username ||
    `FID ${fid}`;
  const handle = profile?.username || profile?.fname || neynar?.username || String(fid);
  return {
    fid,
    name,
    handle,
    pfpUrl: profile?.pfp_url || neynar?.pfp_url || null,
  };
}

export async function loadFriendsRail(viewerFid: number): Promise<{
  online: RailFriend[];
  activity: RailActivity[];
  suggestions: RailFriend[];
}> {
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();

  let following: number[] = [];
  try {
    following = (await fetchNeynarFollowingFids(viewerFid)).slice(0, 24);
  } catch {
    following = [];
  }

  const profileResult = await db
    .prepare(
      `SELECT fid, username, display_name, fname, pfp_url
       FROM profiles
       WHERE fid IS NOT NULL AND fid != ?
       ORDER BY updated_at DESC
       LIMIT 24`
    )
    .bind(viewerFid)
    .all<ProfileBit>();
  const arcadeProfiles = (profileResult.results ?? []).filter((row) => row.fid > 0);
  const byFid = new Map(arcadeProfiles.map((row) => [row.fid, row]));

  const lookupFids = [...new Set([...following, ...arcadeProfiles.map((row) => row.fid)])].slice(
    0,
    40
  );
  let neynarByFid = new Map<number, { username?: string; display_name?: string; pfp_url?: string }>();
  if (lookupFids.length > 0) {
    try {
      const users = await fetchNeynarUsersByFids(lookupFids);
      neynarByFid = new Map(users.map((user) => [user.fid, user]));
    } catch {
      neynarByFid = new Map();
    }
  }

  const friendFids = following.filter((fid) => byFid.has(fid)).slice(0, 16);

  const onlineFids = new Set<number>();
  if (friendFids.length > 0) {
    const marks = placeholders(friendFids.length);
    const since = Date.now() - ONLINE_MS;
    const [streaks, posts, challenges] = await Promise.all([
      db
        .prepare(
          `SELECT fid FROM fid_streaks
           WHERE fid IN (${marks}) AND last_check_in >= ?`
        )
        .bind(...friendFids, since)
        .all<{ fid: number }>(),
      db
        .prepare(
          `SELECT fid FROM posts
           WHERE fid IN (${marks}) AND created_at >= ?`
        )
        .bind(...friendFids, since)
        .all<{ fid: number }>(),
      db
        .prepare(
          `SELECT challenger_fid, target_fid FROM challenges
           WHERE created_at >= ?
             AND (challenger_fid IN (${marks}) OR target_fid IN (${marks}))`
        )
        .bind(since, ...friendFids, ...friendFids)
        .all<{ challenger_fid: number; target_fid: number }>(),
    ]);
    for (const row of streaks.results ?? []) onlineFids.add(row.fid);
    for (const row of posts.results ?? []) onlineFids.add(row.fid);
    for (const row of challenges.results ?? []) {
      if (friendFids.includes(row.challenger_fid)) onlineFids.add(row.challenger_fid);
      if (friendFids.includes(row.target_fid)) onlineFids.add(row.target_fid);
    }
  }

  const online = [...onlineFids]
    .slice(0, 8)
    .map((fid) => friendFrom(fid, byFid.get(fid), neynarByFid.get(fid)));

  let activity: RailActivity[] = [];
  if (friendFids.length > 0) {
    const marks = placeholders(friendFids.length);
    const rows = await db
      .prepare(
        `SELECT id, challenger_fid, challenger_name, target_fid, target_label,
                game_id, game_name, created_at
         FROM challenges
         WHERE challenger_fid IN (${marks}) OR target_fid IN (${marks})
         ORDER BY created_at DESC
         LIMIT 8`
      )
      .bind(...friendFids, ...friendFids)
      .all<{
        id: string;
        challenger_fid: number;
        challenger_name: string;
        target_fid: number;
        target_label: string;
        game_id: string;
        game_name: string;
        created_at: number;
      }>();
    activity = (rows.results ?? []).map((row) => {
      const friendIsChallenger = friendFids.includes(row.challenger_fid);
      const fid = friendIsChallenger ? row.challenger_fid : row.target_fid;
      const person = friendFrom(fid, byFid.get(fid), neynarByFid.get(fid));
      return {
        id: row.id,
        fid,
        name: friendIsChallenger ? row.challenger_name : person.name,
        handle: person.handle,
        pfpUrl: person.pfpUrl,
        gameId: row.game_id,
        gameName: row.game_name,
        createdAt: row.created_at,
      };
    });
  }

  const suggestionSource =
    online.length === 0
      ? (friendFids.length > 0 ? friendFids : arcadeProfiles.map((row) => row.fid)).filter(
          (fid) => fid !== viewerFid
        )
      : [];
  const suggestions = suggestionSource
    .slice(0, 6)
    .map((fid) => friendFrom(fid, byFid.get(fid), neynarByFid.get(fid)));

  return { online, activity, suggestions };
}
