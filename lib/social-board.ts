import { requireSocialDb } from "@/lib/farcaster/social-db";

const DAY_MS = 86_400_000;

export type TextPost = {
  id: string;
  fid: number;
  authorName: string;
  pfpUrl: string | null;
  body: string;
  createdAt: number;
};

export type FidStreak = {
  fid: number;
  currentStreak: number;
  checkedInToday: boolean;
  lastCheckIn: number | null;
};

type PostRow = {
  id: string;
  fid: number;
  author_name: string;
  pfp_url: string | null;
  body: string;
  created_at: number;
};

type StreakRow = {
  fid: number;
  current_streak: number;
  last_check_in: number;
};

function utcDay(timestamp: number): number {
  return Math.floor(timestamp / DAY_MS);
}

function toPost(row: PostRow): TextPost {
  return {
    id: row.id,
    fid: row.fid,
    authorName: row.author_name,
    pfpUrl: row.pfp_url,
    body: row.body,
    createdAt: row.created_at,
  };
}

export function cleanPostBody(raw: string): string | null {
  const body = raw.replace(/\r\n/g, "\n").trim();
  if (!body || body.length > 280) return null;
  return body;
}

export async function listTextPosts(limit = 40): Promise<TextPost[]> {
  const db = await requireSocialDb();
  const result = await db
    .prepare(
      `SELECT id, fid, author_name, pfp_url, body, created_at
       FROM posts
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<PostRow>();
  return (result.results ?? []).map(toPost);
}

export async function createTextPost(input: {
  fid: number;
  playerId: string;
  authorName: string;
  pfpUrl?: string | null;
  body: string;
}): Promise<TextPost> {
  const db = await requireSocialDb();
  const post: TextPost = {
    id: crypto.randomUUID(),
    fid: input.fid,
    authorName: input.authorName,
    pfpUrl: input.pfpUrl ?? null,
    body: input.body,
    createdAt: Date.now(),
  };
  await db
    .prepare(
      `INSERT INTO posts (id, fid, player_id, author_name, pfp_url, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      post.id,
      post.fid,
      input.playerId,
      post.authorName,
      post.pfpUrl,
      post.body,
      post.createdAt
    )
    .run();
  return post;
}

export async function readFidStreak(fid: number): Promise<FidStreak> {
  const db = await requireSocialDb();
  const row = await db
    .prepare(
      `SELECT fid, current_streak, last_check_in FROM fid_streaks WHERE fid = ?`
    )
    .bind(fid)
    .first<StreakRow>();
  if (!row) {
    return {
      fid,
      currentStreak: 0,
      checkedInToday: false,
      lastCheckIn: null,
    };
  }
  const today = utcDay(Date.now());
  const lastDay = utcDay(row.last_check_in);
  const stillGoing = lastDay === today || lastDay === today - 1;
  return {
    fid,
    currentStreak: stillGoing ? row.current_streak : 0,
    checkedInToday: lastDay === today,
    lastCheckIn: row.last_check_in,
  };
}

export async function checkInFidStreak(
  fid: number,
  playerId: string
): Promise<FidStreak> {
  const db = await requireSocialDb();
  const now = Date.now();
  const today = utcDay(now);
  const existing = await db
    .prepare(
      `SELECT fid, current_streak, last_check_in FROM fid_streaks WHERE fid = ?`
    )
    .bind(fid)
    .first<StreakRow>();

  if (existing && utcDay(existing.last_check_in) === today) {
    return {
      fid,
      currentStreak: existing.current_streak,
      checkedInToday: true,
      lastCheckIn: existing.last_check_in,
    };
  }

  const streak =
    existing && utcDay(existing.last_check_in) === today - 1
      ? existing.current_streak + 1
      : 1;

  await db
    .prepare(
      `INSERT INTO fid_streaks (fid, player_id, current_streak, last_check_in, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(fid) DO UPDATE SET
         player_id = excluded.player_id,
         current_streak = excluded.current_streak,
         last_check_in = excluded.last_check_in,
         updated_at = excluded.updated_at`
    )
    .bind(fid, playerId, streak, now, now)
    .run();

  return {
    fid,
    currentStreak: streak,
    checkedInToday: true,
    lastCheckIn: now,
  };
}
