import { requireSocialDb } from "@/lib/farcaster/social-db";
import { ensureCircleSchema } from "@/lib/circle-invites";
import { ModerationError, screenText } from "@/lib/moderation";
import { cleanPostBody, ensureSocialBoardSchema } from "@/lib/social-board";

export type CirclePost = {
  id: string;
  circleId: string;
  circleName?: string;
  fid: number;
  authorName: string;
  authorHandle: string | null;
  pfpUrl: string | null;
  body: string;
  createdAt: number;
};

export type CircleMember = {
  fid: number;
  name: string;
  handle: string;
  role: "creator" | "member";
};

type PostRow = {
  id: string;
  circle_id: string;
  fid: number;
  author_name: string;
  author_handle: string | null;
  pfp_url: string | null;
  body: string;
  created_at: number;
  circle_name?: string | null;
};

let schemaReady: Promise<void> | null = null;

export function ensureCircleContentSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensureCircleSchema();
      await ensureSocialBoardSchema();
      const db = await requireSocialDb();
      const statements = [
        `CREATE TABLE IF NOT EXISTS circle_posts (
          id TEXT PRIMARY KEY NOT NULL,
          circle_id TEXT NOT NULL,
          fid INTEGER NOT NULL,
          player_id TEXT NOT NULL,
          author_name TEXT NOT NULL,
          author_handle TEXT,
          pfp_url TEXT,
          body TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          removed_at INTEGER
        )`,
        `CREATE INDEX IF NOT EXISTS idx_circle_posts_circle
         ON circle_posts (circle_id, created_at DESC)`,
        `CREATE TABLE IF NOT EXISTS circle_invite_declines (
          token_hash TEXT NOT NULL,
          fid INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (token_hash, fid)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_circles_updated ON circles (updated_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_circle_join_requests_circle
         ON circle_join_requests (circle_id, status)`,
      ];
      for (const sql of statements) {
        await db.prepare(sql).bind().run();
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function toPost(row: PostRow): CirclePost {
  return {
    id: row.id,
    circleId: row.circle_id,
    circleName: row.circle_name ?? undefined,
    fid: row.fid,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    pfpUrl: row.pfp_url,
    body: row.body,
    createdAt: row.created_at,
  };
}

export async function listCirclePosts(
  circleId: string,
  viewerIsMember: boolean,
  visibility: "public" | "private"
): Promise<CirclePost[] | null> {
  if (visibility === "private" && !viewerIsMember) return null;
  await ensureCircleContentSchema();
  const db = await requireSocialDb();
  const result = await db
    .prepare(
      `SELECT id, circle_id, fid, author_name, author_handle, pfp_url, body, created_at
       FROM circle_posts
       WHERE circle_id = ? AND removed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 40`
    )
    .bind(circleId)
    .all<PostRow>();
  return (result.results ?? []).map(toPost);
}

export async function createCirclePost(input: {
  circleId: string;
  fid: number;
  playerId: string;
  authorName: string;
  authorHandle: string | null;
  pfpUrl: string | null;
  body: string;
}): Promise<CirclePost> {
  await ensureCircleContentSchema();
  const db = await requireSocialDb();
  const member = await db
    .prepare(`SELECT fid FROM circle_members WHERE circle_id = ? AND fid = ?`)
    .bind(input.circleId, input.fid)
    .first<{ fid: number }>();
  if (!member) throw new Error("Join this circle before posting.");
  const screened = screenText(input.body);
  const body = cleanPostBody(screened);
  if (!body) throw new ModerationError("Write a post up to 280 characters.");
  const post: CirclePost = {
    id: crypto.randomUUID(),
    circleId: input.circleId,
    fid: input.fid,
    authorName: input.authorName,
    authorHandle: input.authorHandle,
    pfpUrl: input.pfpUrl,
    body,
    createdAt: Date.now(),
  };
  await db
    .prepare(
      `INSERT INTO circle_posts (
        id, circle_id, fid, player_id, author_name, author_handle, pfp_url, body, created_at, removed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .bind(
      post.id,
      post.circleId,
      post.fid,
      input.playerId,
      post.authorName,
      post.authorHandle,
      post.pfpUrl,
      post.body,
      post.createdAt
    )
    .run();
  await db
    .prepare(`UPDATE circles SET updated_at = ? WHERE id = ?`)
    .bind(post.createdAt, input.circleId)
    .run();
  return post;
}

export async function removeCirclePost(input: {
  circleId: string;
  postId: string;
  fid: number;
}): Promise<boolean> {
  await ensureCircleContentSchema();
  const db = await requireSocialDb();
  const post = await db
    .prepare(
      `SELECT fid FROM circle_posts
       WHERE id = ? AND circle_id = ? AND removed_at IS NULL`
    )
    .bind(input.postId, input.circleId)
    .first<{ fid: number }>();
  if (!post) return false;
  const circle = await db
    .prepare(`SELECT creator_fid FROM circles WHERE id = ?`)
    .bind(input.circleId)
    .first<{ creator_fid: number }>();
  if (post.fid !== input.fid && circle?.creator_fid !== input.fid) return false;
  await db
    .prepare(`UPDATE circle_posts SET removed_at = ? WHERE id = ?`)
    .bind(Date.now(), input.postId)
    .run();
  return true;
}

export async function listCircleMembers(circleId: string): Promise<CircleMember[] | null> {
  await ensureCircleContentSchema();
  const db = await requireSocialDb();
  const circle = await db
    .prepare(`SELECT visibility FROM circles WHERE id = ?`)
    .bind(circleId)
    .first<{ visibility: string }>();
  if (!circle) return null;
  const result = await db
    .prepare(
      `SELECT m.fid, m.role, p.display_name, p.username, p.fname
       FROM circle_members m
       LEFT JOIN profiles p ON p.fid = m.fid
       WHERE m.circle_id = ?
       ORDER BY m.joined_at ASC
       LIMIT 100`
    )
    .bind(circleId)
    .all<{
      fid: number;
      role: string;
      display_name: string | null;
      username: string | null;
      fname: string | null;
    }>();
  return (result.results ?? []).map((row) => ({
    fid: row.fid,
    role: row.role === "creator" ? "creator" : "member",
    name: row.display_name || row.username || row.fname || `FID ${row.fid}`,
    handle: row.username || row.fname || String(row.fid),
  }));
}

export async function listJoinedCircleActivity(fid: number): Promise<{
  circles: Array<{
    id: string;
    name: string;
    description: string;
    visibility: "public" | "private";
    memberCount: number;
  }>;
  posts: CirclePost[];
}> {
  await ensureCircleContentSchema();
  const db = await requireSocialDb();
  const [circles, posts] = await Promise.all([
    db
      .prepare(
        `SELECT c.id, c.name, c.description, c.visibility, c.member_count
         FROM circle_members m
         JOIN circles c ON c.id = m.circle_id
         WHERE m.fid = ?
         ORDER BY c.updated_at DESC
         LIMIT 30`
      )
      .bind(fid)
      .all<{
        id: string;
        name: string;
        description: string;
        visibility: string;
        member_count: number;
      }>(),
    db
      .prepare(
        `SELECT p.id, p.circle_id, c.name AS circle_name, p.fid, p.author_name,
                p.author_handle, p.pfp_url, p.body, p.created_at
         FROM circle_members m
         JOIN circle_posts p ON p.circle_id = m.circle_id
         JOIN circles c ON c.id = p.circle_id
         WHERE m.fid = ? AND p.removed_at IS NULL
         ORDER BY p.created_at DESC
         LIMIT 30`
      )
      .bind(fid)
      .all<PostRow>(),
  ]);
  return {
    circles: (circles.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      visibility: row.visibility === "private" ? "private" : "public",
      memberCount: row.member_count,
    })),
    posts: (posts.results ?? []).map(toPost),
  };
}
