import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { profileHref } from "@/lib/farcaster/public-profile";
import {
  fetchNeynarUserByFid,
  searchNeynarUsers,
} from "@/lib/farcaster/neynar";
import {
  fetchSocialProfileByFid,
  searchSocialProfiles,
} from "@/lib/farcaster/social-db";
import { suggestPlayers } from "@/lib/player-suggest";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type Hit = {
  fid: number | null;
  name: string;
  handle: string | null;
  pfpUrl: string | null;
  href: string;
};

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`farcaster:search:${ip}`, 40, 60_000))) {
    return rateLimitResponse();
  }

  const q = new URL(request.url).searchParams.get("q")?.trim().replace(/^@/, "") ?? "";
  if (q.length < 1 || q.length > 40) {
    return NextResponse.json({ players: [] as Hit[] });
  }

  try {
    const session = await readSessionFromCookies();
    const suggested = await suggestPlayers(q, session?.fid ?? null).catch(() => []);
    const [local, remote] = await Promise.all([
      searchSocialProfiles(q).catch(() => []),
      /^\d+$/.test(q)
        ? fetchNeynarUserByFid(Number(q))
            .then((user) => (user ? [user] : []))
            .catch(() => [])
        : searchNeynarUsers(q).catch(() => []),
    ]);

    const hits: Hit[] = [];
    const seen = new Set<string>();

    function add(hit: Hit) {
      if (seen.has(hit.href)) return;
      seen.add(hit.href);
      hits.push(hit);
    }

    for (const player of suggested) {
      const href = profileHref({
        username: player.handle?.replace(/^@/, ""),
        fid: player.fid,
      });
      if (!href) continue;
      add({
        fid: player.fid,
        name: player.name,
        handle: player.handle,
        pfpUrl: player.pfpUrl,
        href,
      });
    }

    for (const profile of local) {
      const href = profileHref({
        username: profile.username,
        fid: profile.fid,
      });
      if (!href) continue;
      add({
        fid: profile.fid ?? null,
        name:
          profile.displayName ||
          profile.username ||
          profile.fname ||
          (profile.fid ? `FID ${profile.fid}` : "Player"),
        handle: profile.username
          ? `@${profile.username}`
          : profile.fname
            ? `@${profile.fname}`
            : null,
        pfpUrl: profile.pfpUrl ?? null,
        href,
      });
    }

    const localFids = new Set(
      local.map((profile) => profile.fid).filter((fid): fid is number => Boolean(fid))
    );
    for (const user of remote) {
      if (!user.fid || localFids.has(user.fid)) continue;
      const arcade = await fetchSocialProfileByFid(user.fid).catch(() => null);
      const href = profileHref({
        username: arcade?.username,
        fid: user.fid,
      });
      if (!href) continue;
      add({
        fid: user.fid,
        name:
          arcade?.displayName ||
          user.display_name ||
          arcade?.username ||
          user.username ||
          `FID ${user.fid}`,
        handle: arcade?.username
          ? `@${arcade.username}`
          : user.username
            ? `@${user.username}`
            : null,
        pfpUrl: arcade?.pfpUrl || user.pfp_url || null,
        href,
      });
    }

    return NextResponse.json({ players: hits.slice(0, 8) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
