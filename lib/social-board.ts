import { requireSocialDb } from "@/lib/farcaster/social-db";

let schemaReady: Promise<void> | null = null;

/** Create post and streak tables when the D1 migration has not been applied yet. */
export function ensureSocialBoardSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = await requireSocialDb();
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY NOT NULL,
            fid INTEGER NOT NULL,
            player_id TEXT NOT NULL,
            author_name TEXT NOT NULL,
            pfp_url TEXT,
            body TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )`
        )
        .bind()
        .run();
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC)`
        )
        .bind()
        .run();
      try {
        await db
          .prepare(`ALTER TABLE posts ADD COLUMN author_handle TEXT`)
          .bind()
          .run();
      } catch {
        // Column already exists.
      }
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS fid_streaks (
            fid INTEGER PRIMARY KEY NOT NULL,
            player_id TEXT NOT NULL,
            current_streak INTEGER NOT NULL,
            last_check_in INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )`
        )
        .bind()
        .run();
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS challenges (
            id TEXT PRIMARY KEY NOT NULL,
            challenger_fid INTEGER NOT NULL,
            challenger_name TEXT NOT NULL,
            challenger_player_id TEXT NOT NULL,
            target_fid INTEGER NOT NULL,
            target_label TEXT NOT NULL,
            game_id TEXT NOT NULL,
            game_name TEXT NOT NULL,
            expiry_hours INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            accepted_at INTEGER,
            result_post_id TEXT
          )`
        )
        .bind()
        .run();
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS idx_challenges_target
           ON challenges (target_fid, created_at DESC)`
        )
        .bind()
        .run();
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS idx_challenges_challenger
           ON challenges (challenger_fid, created_at DESC)`
        )
        .bind()
        .run();
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

const DAY_MS = 86_400_000;

export type TextPost = {
  id: string;
  fid: number;
  authorName: string;
  authorHandle: string | null;
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
  author_handle: string | null;
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
    authorHandle: row.author_handle,
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
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();
  const result = await db
    .prepare(
      `SELECT id, fid, author_name, author_handle, pfp_url, body, created_at
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
  authorHandle?: string | null;
  pfpUrl?: string | null;
  body: string;
}): Promise<TextPost> {
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();
  const post: TextPost = {
    id: crypto.randomUUID(),
    fid: input.fid,
    authorName: input.authorName,
    authorHandle: input.authorHandle ?? null,
    pfpUrl: input.pfpUrl ?? null,
    body: input.body,
    createdAt: Date.now(),
  };
  await db
    .prepare(
      `INSERT INTO posts (id, fid, player_id, author_name, author_handle, pfp_url, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      post.id,
      post.fid,
      input.playerId,
      post.authorName,
      post.authorHandle,
      post.pfpUrl,
      post.body,
      post.createdAt
    )
    .run();
  return post;
}

export async function readFidStreak(fid: number): Promise<FidStreak> {
  await ensureSocialBoardSchema();
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
  await ensureSocialBoardSchema();
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
