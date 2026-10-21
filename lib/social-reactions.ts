import { requireSocialDb } from "@/lib/farcaster/social-db";
import { cleanPostBody, ensureSocialBoardSchema } from "@/lib/social-board";

export type ReactionSummary = {
  likes: number;
  liked: boolean;
  comments: number;
  shares: number;
  shared: boolean;
};

export type PostComment = {
  id: string;
  authorName: string;
  authorHandle: string | null;
  body: string;
  createdAt: number;
};

const EMPTY: ReactionSummary = {
  likes: 0,
  liked: false,
  comments: 0,
  shares: 0,
  shared: false,
};

function cleanIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || id.length > 300 || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
    if (next.length >= 60) break;
  }
  return next;
}

export async function summarizeReactions(
  ids: string[],
  fid: number
): Promise<Record<string, ReactionSummary>> {
  await ensureSocialBoardSchema();
  const clean = cleanIds(ids);
  const summary: Record<string, ReactionSummary> = {};
  for (const id of clean) summary[id] = { ...EMPTY };
  if (clean.length === 0) return summary;

  const db = await requireSocialDb();
  const marks = clean.map(() => "?").join(",");

  const [likes, mineLikes, comments, shares, mineShares] = await Promise.all([
    db
      .prepare(
        `SELECT post_id, COUNT(*) AS total FROM post_likes
         WHERE post_id IN (${marks}) GROUP BY post_id`
      )
      .bind(...clean)
      .all<{ post_id: string; total: number }>(),
    db
      .prepare(
        `SELECT post_id FROM post_likes WHERE fid = ? AND post_id IN (${marks})`
      )
      .bind(fid, ...clean)
      .all<{ post_id: string }>(),
    db
      .prepare(
        `SELECT post_id, COUNT(*) AS total FROM post_comments
         WHERE post_id IN (${marks}) GROUP BY post_id`
      )
      .bind(...clean)
      .all<{ post_id: string; total: number }>(),
    db
      .prepare(
        `SELECT post_id, COUNT(*) AS total FROM post_shares
         WHERE post_id IN (${marks}) GROUP BY post_id`
      )
      .bind(...clean)
      .all<{ post_id: string; total: number }>(),
    db
      .prepare(
        `SELECT post_id FROM post_shares WHERE fid = ? AND post_id IN (${marks})`
      )
      .bind(fid, ...clean)
      .all<{ post_id: string }>(),
  ]);

  for (const row of likes.results ?? []) {
    const item = summary[row.post_id];
    if (item) item.likes = Number(row.total) || 0;
  }
  for (const row of mineLikes.results ?? []) {
    const item = summary[row.post_id];
    if (item) item.liked = true;
  }
  for (const row of comments.results ?? []) {
    const item = summary[row.post_id];
    if (item) item.comments = Number(row.total) || 0;
  }
  for (const row of shares.results ?? []) {
    const item = summary[row.post_id];
    if (item) item.shares = Number(row.total) || 0;
  }
  for (const row of mineShares.results ?? []) {
    const item = summary[row.post_id];
    if (item) item.shared = true;
  }
  return summary;
}

export async function toggleLike(
  postId: string,
  fid: number
): Promise<ReactionSummary> {
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();
  const existing = await db
    .prepare(`SELECT post_id FROM post_likes WHERE post_id = ? AND fid = ?`)
    .bind(postId, fid)
    .first<{ post_id: string }>();
  if (existing) {
    await db
      .prepare(`DELETE FROM post_likes WHERE post_id = ? AND fid = ?`)
      .bind(postId, fid)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO post_likes (post_id, fid, created_at) VALUES (?, ?, ?)`
      )
      .bind(postId, fid, Date.now())
      .run();
  }
  const summary = await summarizeReactions([postId], fid);
  return summary[postId] ?? { ...EMPTY, liked: !existing };
}

export async function toggleShare(
  postId: string,
  fid: number
): Promise<ReactionSummary> {
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();
  const existing = await db
    .prepare(`SELECT post_id FROM post_shares WHERE post_id = ? AND fid = ?`)
    .bind(postId, fid)
    .first<{ post_id: string }>();
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO post_shares (post_id, fid, created_at) VALUES (?, ?, ?)`
      )
      .bind(postId, fid, Date.now())
      .run();
  }
  const summary = await summarizeReactions([postId], fid);
  return summary[postId] ?? { ...EMPTY, shared: true };
}

export async function listComments(postId: string): Promise<PostComment[]> {
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();
  const result = await db
    .prepare(
      `SELECT id, author_name, author_handle, body, created_at
       FROM post_comments WHERE post_id = ? ORDER BY created_at ASC LIMIT 40`
    )
    .bind(postId)
    .all<{
      id: string;
      author_name: string;
      author_handle: string | null;
      body: string;
      created_at: number;
    }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    body: row.body,
    createdAt: row.created_at,
  }));
}

export async function addComment(input: {
  postId: string;
  fid: number;
  authorName: string;
  authorHandle: string | null;
  body: string;
}): Promise<PostComment> {
  const body = cleanPostBody(input.body);
  if (!body) throw new Error("Write a comment up to 280 characters.");
  await ensureSocialBoardSchema();
  const db = await requireSocialDb();
  const comment: PostComment = {
    id: crypto.randomUUID(),
    authorName: input.authorName,
    authorHandle: input.authorHandle,
    body,
    createdAt: Date.now(),
  };
  await db
    .prepare(
      `INSERT INTO post_comments
       (id, post_id, fid, author_name, author_handle, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      comment.id,
      input.postId,
      input.fid,
      comment.authorName,
      comment.authorHandle,
      comment.body,
      comment.createdAt
    )
    .run();
  return comment;
}
