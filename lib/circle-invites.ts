import { fetchSocialProfileByFid, requireSocialDb } from "@/lib/farcaster/social-db";

const DAY_MS = 24 * 60 * 60 * 1000;

export const INVITE_EXPIRY_CHOICES = ["1", "7", "30", "never"] as const;
export const INVITE_MAX_USES = [1, 10, 25] as const;

export type InviteExpiryChoice = (typeof INVITE_EXPIRY_CHOICES)[number];
export type InviteMaxUses = (typeof INVITE_MAX_USES)[number];

export type CircleVisibility = "public" | "private";

export type CircleSummary = {
  id: string;
  name: string;
  description: string;
  visibility: CircleVisibility;
  memberCount: number;
  creatorFid: number;
};

type CircleRow = {
  id: string;
  creator_fid: number;
  creator_player_id: string;
  name: string;
  description: string;
  visibility: string;
  member_count: number;
  created_at: number;
  updated_at: number;
};

type LinkRow = {
  id: string;
  circle_id: string;
  token_hash: string;
  creator_fid: number;
  expires_at: number | null;
  max_uses: number;
  uses: number;
  created_at: number;
  revoked_at: number | null;
};

let schemaReady: Promise<void> | null = null;

export function ensureCircleSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = await requireSocialDb();
      const statements = [
        `CREATE TABLE IF NOT EXISTS circles (
          id TEXT PRIMARY KEY NOT NULL,
          creator_fid INTEGER NOT NULL,
          creator_player_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          visibility TEXT NOT NULL,
          member_count INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS circle_members (
          circle_id TEXT NOT NULL,
          fid INTEGER NOT NULL,
          player_id TEXT NOT NULL,
          role TEXT NOT NULL,
          joined_at INTEGER NOT NULL,
          PRIMARY KEY (circle_id, fid)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_circle_members_fid
         ON circle_members (fid, circle_id)`,
        `CREATE TABLE IF NOT EXISTS circle_invites (
          id TEXT PRIMARY KEY NOT NULL,
          circle_id TEXT NOT NULL,
          inviter_fid INTEGER NOT NULL,
          target_fid INTEGER NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER
        )`,
        `CREATE INDEX IF NOT EXISTS idx_circle_invites_target
         ON circle_invites (target_fid, status)`,
        `CREATE TABLE IF NOT EXISTS circle_invite_links (
          id TEXT PRIMARY KEY NOT NULL,
          circle_id TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          creator_fid INTEGER NOT NULL,
          expires_at INTEGER,
          max_uses INTEGER NOT NULL,
          uses INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          revoked_at INTEGER
        )`,
        `CREATE INDEX IF NOT EXISTS idx_circle_invite_links_circle
         ON circle_invite_links (circle_id, created_at DESC)`,
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

export function isInviteExpiryChoice(value: string): value is InviteExpiryChoice {
  return (INVITE_EXPIRY_CHOICES as readonly string[]).includes(value);
}

export function isInviteMaxUses(value: number): value is InviteMaxUses {
  return (INVITE_MAX_USES as readonly number[]).includes(value);
}

export function expiresAtFor(choice: InviteExpiryChoice, now = Date.now()): number | null {
  if (choice === "never") return null;
  const days = choice === "1" ? 1 : choice === "30" ? 30 : 7;
  return now + days * DAY_MS;
}

function newId(): string {
  return crypto.randomUUID();
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function newInviteToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function isInviteToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(value);
}

export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function circleFrom(row: CircleRow): CircleSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility === "private" ? "private" : "public",
    memberCount: row.member_count,
    creatorFid: row.creator_fid,
  };
}

async function runChanges(
  statement: { run(): Promise<unknown> }
): Promise<number> {
  const result = (await statement.run()) as { meta?: { changes?: number } };
  return result.meta?.changes ?? 0;
}

function linkIsOpen(link: LinkRow, now: number): boolean {
  if (link.revoked_at != null) return false;
  if (link.expires_at != null && link.expires_at <= now) return false;
  if (link.uses >= link.max_uses) return false;
  return true;
}

export async function createCircle(input: {
  fid: number;
  playerId: string;
  name: string;
  description: string;
  visibility: CircleVisibility;
}): Promise<CircleSummary> {
  await ensureCircleSchema();
  const db = await requireSocialDb();
  const now = Date.now();
  const id = newId();
  await db
    .prepare(
      `INSERT INTO circles (
        id, creator_fid, creator_player_id, name, description, visibility,
        member_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .bind(
      id,
      input.fid,
      input.playerId,
      input.name,
      input.description,
      input.visibility,
      now,
      now
    )
    .run();
  await db
    .prepare(
      `INSERT INTO circle_members (circle_id, fid, player_id, role, joined_at)
       VALUES (?, ?, ?, 'creator', ?)`
    )
    .bind(id, input.fid, input.playerId, now)
    .run();
  return {
    id,
    name: input.name,
    description: input.description,
    visibility: input.visibility,
    memberCount: 1,
    creatorFid: input.fid,
  };
}

export async function listCirclesForFid(fid: number): Promise<CircleSummary[]> {
  await ensureCircleSchema();
  const db = await requireSocialDb();
  const result = await db
    .prepare(
      `SELECT c.*
       FROM circle_members m
       JOIN circles c ON c.id = m.circle_id
       WHERE m.fid = ?
       ORDER BY c.updated_at DESC
       LIMIT 50`
    )
    .bind(fid)
    .all<CircleRow>();
  return (result.results ?? []).map(circleFrom);
}

export async function getCircleForViewer(
  circleId: string,
  fid: number | null
): Promise<{ circle: CircleSummary; isMember: boolean; isCreator: boolean } | null> {
  await ensureCircleSchema();
  const db = await requireSocialDb();
  const row = await db
    .prepare("SELECT * FROM circles WHERE id = ?")
    .bind(circleId)
    .first<CircleRow>();
  if (!row) return null;
  let isMember = false;
  if (fid != null) {
    const member = await db
      .prepare("SELECT fid FROM circle_members WHERE circle_id = ? AND fid = ?")
      .bind(circleId, fid)
      .first<{ fid: number }>();
    isMember = Boolean(member);
  }
  const circle = circleFrom(row);
  return { circle, isMember, isCreator: fid != null && fid === circle.creatorFid };
}

export type InviteLinkView = {
  id: string;
  expiresAt: number | null;
  maxUses: number;
  uses: number;
  createdAt: number;
  revokedAt: number | null;
  open: boolean;
};

function linkView(row: LinkRow, now: number): InviteLinkView {
  return {
    id: row.id,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    uses: row.uses,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    open: linkIsOpen(row, now),
  };
}

export async function createInviteLink(input: {
  circleId: string;
  fid: number;
  expiry: InviteExpiryChoice;
  maxUses: InviteMaxUses;
}): Promise<{ link: InviteLinkView; token: string }> {
  await ensureCircleSchema();
  const db = await requireSocialDb();
  const circle = await db
    .prepare("SELECT creator_fid FROM circles WHERE id = ?")
    .bind(input.circleId)
    .first<{ creator_fid: number }>();
  if (!circle || circle.creator_fid !== input.fid) {
    throw new Error("Only the circle creator can make an invite link.");
  }
  const now = Date.now();
  const token = newInviteToken();
  const id = newId();
  const expiresAt = expiresAtFor(input.expiry, now);
  await db
    .prepare(
      `INSERT INTO circle_invite_links (
        id, circle_id, token_hash, creator_fid, expires_at, max_uses, uses, created_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL)`
    )
    .bind(id, input.circleId, await hashInviteToken(token), input.fid, expiresAt, input.maxUses, now)
    .run();
  return {
    token,
    link: {
      id,
      expiresAt,
      maxUses: input.maxUses,
      uses: 0,
      createdAt: now,
      revokedAt: null,
      open: true,
    },
  };
}

export async function listInviteLinks(
  circleId: string,
  fid: number
): Promise<InviteLinkView[] | null> {
  await ensureCircleSchema();
  const db = await requireSocialDb();
  const circle = await db
    .prepare("SELECT creator_fid FROM circles WHERE id = ?")
    .bind(circleId)
    .first<{ creator_fid: number }>();
  if (!circle || circle.creator_fid !== fid) return null;
  const now = Date.now();
  const result = await db
    .prepare(
      `SELECT * FROM circle_invite_links
       WHERE circle_id = ?
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .bind(circleId)
    .all<LinkRow>();
  return (result.results ?? []).map((row) => linkView(row, now));
}

export async function revokeInviteLink(
  circleId: string,
  linkId: string,
  fid: number
): Promise<boolean> {
  await ensureCircleSchema();
  const db = await requireSocialDb();
  const changes = await runChanges(
    db
      .prepare(
        `UPDATE circle_invite_links
         SET revoked_at = ?
         WHERE id = ? AND circle_id = ? AND creator_fid = ? AND revoked_at IS NULL`
      )
      .bind(Date.now(), linkId, circleId, fid)
  );
  return changes === 1;
}

export type InvitePreview =
  | { valid: false }
  | {
      valid: true;
      circle: CircleSummary;
      inviterName: string | null;
      member: boolean;
    };

export async function previewInvite(
  token: string,
  fid: number | null
): Promise<InvitePreview> {
  if (!isInviteToken(token)) return { valid: false };
  await ensureCircleSchema();
  const db = await requireSocialDb();
  const now = Date.now();
  const link = await db
    .prepare("SELECT * FROM circle_invite_links WHERE token_hash = ?")
    .bind(await hashInviteToken(token))
    .first<LinkRow>();
  if (!link || !linkIsOpen(link, now)) return { valid: false };
  const row = await db
    .prepare("SELECT * FROM circles WHERE id = ?")
    .bind(link.circle_id)
    .first<CircleRow>();
  if (!row) return { valid: false };
  let member = false;
  if (fid != null) {
    const existing = await db
      .prepare("SELECT fid FROM circle_members WHERE circle_id = ? AND fid = ?")
      .bind(row.id, fid)
      .first<{ fid: number }>();
    member = Boolean(existing);
  }
  const inviter = await fetchSocialProfileByFid(link.creator_fid).catch(() => null);
  return {
    valid: true,
    circle: circleFrom(row),
    inviterName: inviter?.displayName || inviter?.username || inviter?.fname || null,
    member,
  };
}

export async function acceptInvite(input: {
  token: string;
  fid: number;
  playerId: string;
}): Promise<{ ok: true; circleId: string; alreadyMember: boolean } | { ok: false }> {
  if (!isInviteToken(input.token)) return { ok: false };
  await ensureCircleSchema();
  const db = await requireSocialDb();
  const now = Date.now();
  const link = await db
    .prepare("SELECT * FROM circle_invite_links WHERE token_hash = ?")
    .bind(await hashInviteToken(input.token))
    .first<LinkRow>();
  if (!link || !linkIsOpen(link, now)) return { ok: false };

  const existing = await db
    .prepare("SELECT fid FROM circle_members WHERE circle_id = ? AND fid = ?")
    .bind(link.circle_id, input.fid)
    .first<{ fid: number }>();
  if (existing) return { ok: true, circleId: link.circle_id, alreadyMember: true };

  const claimed = await runChanges(
    db
      .prepare(
        `UPDATE circle_invite_links
         SET uses = uses + 1
         WHERE id = ?
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
           AND uses < max_uses`
      )
      .bind(link.id, now)
  );
  if (claimed !== 1) return { ok: false };

  try {
    await db
      .prepare(
        `INSERT INTO circle_members (circle_id, fid, player_id, role, joined_at)
         VALUES (?, ?, ?, 'member', ?)`
      )
      .bind(link.circle_id, input.fid, input.playerId, now)
      .run();
  } catch {
    await db
      .prepare(
        `UPDATE circle_invite_links
         SET uses = uses - 1
         WHERE id = ? AND uses > 0`
      )
      .bind(link.id)
      .run();
    const joined = await db
      .prepare("SELECT fid FROM circle_members WHERE circle_id = ? AND fid = ?")
      .bind(link.circle_id, input.fid)
      .first<{ fid: number }>();
    if (joined) return { ok: true, circleId: link.circle_id, alreadyMember: true };
    return { ok: false };
  }

  await db
    .prepare(
      `UPDATE circles
       SET member_count = member_count + 1, updated_at = ?
       WHERE id = ?`
    )
    .bind(now, link.circle_id)
    .run();

  return { ok: true, circleId: link.circle_id, alreadyMember: false };
}
