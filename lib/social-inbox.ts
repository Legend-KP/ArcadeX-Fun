import { requireSocialDb } from "@/lib/farcaster/social-db";

export type CampKind = "circle" | "game";

export type InboxItem = {
  id: string;
  scope: "direct" | "broadcast";
  kind: string;
  title: string;
  body: string;
  href: string | null;
  campKind: CampKind | null;
  campId: string | null;
  createdAt: number;
  readAt: number | null;
};

type DirectRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  camp_kind: string | null;
  camp_id: string | null;
  created_at: number;
  read_at: number | null;
};

let schemaReady: Promise<void> | null = null;

export function ensureInboxSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = await requireSocialDb();
      const statements = [
        `CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY NOT NULL,
          fid INTEGER NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          href TEXT,
          camp_kind TEXT,
          camp_id TEXT,
          created_at INTEGER NOT NULL,
          read_at INTEGER
        )`,
        `CREATE INDEX IF NOT EXISTS idx_notifications_fid
         ON notifications (fid, created_at DESC)`,
        `CREATE TABLE IF NOT EXISTS notification_broadcasts (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          href TEXT,
          camp_kind TEXT,
          camp_id TEXT,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS notification_reads (
          broadcast_id TEXT NOT NULL,
          fid INTEGER NOT NULL,
          read_at INTEGER NOT NULL,
          PRIMARY KEY (broadcast_id, fid)
        )`,
        `CREATE TABLE IF NOT EXISTS presence (
          fid INTEGER PRIMARY KEY NOT NULL,
          last_seen INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS content_reports (
          id TEXT PRIMARY KEY NOT NULL,
          reporter_fid INTEGER NOT NULL,
          target_kind TEXT NOT NULL,
          target_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER
        )`,
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

function asCamp(value: string | null): CampKind | null {
  return value === "circle" || value === "game" ? value : null;
}

export function campHref(kind: string | null, id: string | null): string | null {
  if (!kind || !id) return null;
  if (kind === "circle" && /^[A-Za-z0-9-]{8,80}$/.test(id)) {
    return `/circle/${id}`;
  }
  if (kind === "game" && id.length > 0 && id.length <= 128 && !/[.#$[\]/]/.test(id)) {
    return `/game/${encodeURIComponent(id)}`;
  }
  return null;
}

export async function notifyUser(input: {
  fid: number;
  kind: string;
  title: string;
  body: string;
  href?: string | null;
  campKind?: CampKind | null;
  campId?: string | null;
}): Promise<void> {
  try {
    await ensureInboxSchema();
    const db = await requireSocialDb();
    await db
      .prepare(
        `INSERT INTO notifications (
          id, fid, kind, title, body, href, camp_kind, camp_id, created_at, read_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .bind(
        crypto.randomUUID(),
        input.fid,
        input.kind,
        input.title.slice(0, 120),
        input.body.slice(0, 280),
        input.href ?? null,
        input.campKind ?? null,
        input.campId ?? null,
        Date.now()
      )
      .run();
  } catch {
    // A missed inbox row must not fail the action that created it.
  }
}

export async function listInbox(fid: number): Promise<{
  items: InboxItem[];
  unread: number;
}> {
  await ensureInboxSchema();
  const db = await requireSocialDb();
  const [direct, broadcasts] = await Promise.all([
    db
      .prepare(
        `SELECT id, kind, title, body, href, camp_kind, camp_id, created_at, read_at
         FROM notifications
         WHERE fid = ?
         ORDER BY created_at DESC
         LIMIT 40`
      )
      .bind(fid)
      .all<DirectRow>(),
    db
      .prepare(
        `SELECT b.id, b.title, b.body, b.href, b.camp_kind, b.camp_id, b.created_at,
                r.read_at
         FROM notification_broadcasts b
         LEFT JOIN notification_reads r
           ON r.broadcast_id = b.id AND r.fid = ?
         ORDER BY b.created_at DESC
         LIMIT 20`
      )
      .bind(fid)
      .all<DirectRow>(),
  ]);

  const items: InboxItem[] = [
    ...(direct.results ?? []).map((row) => ({
      id: row.id,
      scope: "direct" as const,
      kind: row.kind,
      title: row.title,
      body: row.body,
      href: row.href,
      campKind: asCamp(row.camp_kind),
      campId: row.camp_id,
      createdAt: row.created_at,
      readAt: row.read_at,
    })),
    ...(broadcasts.results ?? []).map((row) => ({
      id: row.id,
      scope: "broadcast" as const,
      kind: "admin",
      title: row.title,
      body: row.body,
      href: row.href,
      campKind: asCamp(row.camp_kind),
      campId: row.camp_id,
      createdAt: row.created_at,
      readAt: row.read_at,
    })),
  ].sort((a, b) => b.createdAt - a.createdAt);

  return {
    items,
    unread: items.filter((item) => item.readAt == null).length,
  };
}

export async function markInboxRead(
  fid: number,
  id: string,
  scope: "direct" | "broadcast"
): Promise<void> {
  await ensureInboxSchema();
  const db = await requireSocialDb();
  const now = Date.now();
  if (scope === "broadcast") {
    await db
      .prepare(
        `INSERT INTO notification_reads (broadcast_id, fid, read_at)
         VALUES (?, ?, ?)
         ON CONFLICT(broadcast_id, fid) DO NOTHING`
      )
      .bind(id, fid, now)
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE notifications
       SET read_at = ?
       WHERE id = ? AND fid = ? AND read_at IS NULL`
    )
    .bind(now, id, fid)
    .run();
}

export type BroadcastInput = {
  title: string;
  body: string;
  campKind: CampKind | null;
  campId: string | null;
};

export async function createBroadcast(input: BroadcastInput): Promise<{
  id: string;
  href: string | null;
  createdAt: number;
}> {
  await ensureInboxSchema();
  const db = await requireSocialDb();
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const href = campHref(input.campKind, input.campId);
  await db
    .prepare(
      `INSERT INTO notification_broadcasts (
        id, title, body, href, camp_kind, camp_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.title,
      input.body,
      href,
      input.campKind,
      input.campId,
      createdAt
    )
    .run();
  return { id, href, createdAt };
}

export async function listBroadcasts(): Promise<
  Array<BroadcastInput & { id: string; href: string | null; createdAt: number }>
> {
  await ensureInboxSchema();
  const db = await requireSocialDb();
  const result = await db
    .prepare(
      `SELECT id, title, body, href, camp_kind, camp_id, created_at
       FROM notification_broadcasts
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .bind()
    .all<{
      id: string;
      title: string;
      body: string;
      href: string | null;
      camp_kind: string | null;
      camp_id: string | null;
      created_at: number;
    }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    href: row.href,
    campKind: asCamp(row.camp_kind),
    campId: row.camp_id,
    createdAt: row.created_at,
  }));
}

export async function touchPresence(fid: number): Promise<void> {
  await ensureInboxSchema();
  const db = await requireSocialDb();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO presence (fid, last_seen) VALUES (?, ?)
       ON CONFLICT(fid) DO UPDATE SET last_seen = excluded.last_seen`
    )
    .bind(fid, now)
    .run();
}

export const ONLINE_MS = 90_000;

export async function onlineFids(fids: number[], now = Date.now()): Promise<Set<number>> {
  await ensureInboxSchema();
  if (fids.length === 0) return new Set();
  const db = await requireSocialDb();
  const marks = fids.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT fid FROM presence
       WHERE fid IN (${marks}) AND last_seen >= ?`
    )
    .bind(...fids, now - ONLINE_MS)
    .all<{ fid: number }>();
  return new Set((result.results ?? []).map((row) => row.fid));
}

export async function fileReport(input: {
  reporterFid: number;
  targetKind: "post" | "circle_post" | "comment";
  targetId: string;
  reason: string;
}): Promise<void> {
  await ensureInboxSchema();
  const db = await requireSocialDb();
  const existing = await db
    .prepare(
      `SELECT id FROM content_reports
       WHERE reporter_fid = ? AND target_kind = ? AND target_id = ? AND status = 'open'`
    )
    .bind(input.reporterFid, input.targetKind, input.targetId)
    .first<{ id: string }>();
  if (existing) return;
  await db
    .prepare(
      `INSERT INTO content_reports (
        id, reporter_fid, target_kind, target_id, reason, status, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, 'open', ?, NULL)`
    )
    .bind(
      crypto.randomUUID(),
      input.reporterFid,
      input.targetKind,
      input.targetId,
      input.reason,
      Date.now()
    )
    .run();
}

export type ContentReport = {
  id: string;
  reporterFid: number;
  targetKind: string;
  targetId: string;
  reason: string;
  status: string;
  createdAt: number;
};

export async function listOpenReports(): Promise<ContentReport[]> {
  await ensureInboxSchema();
  const db = await requireSocialDb();
  const result = await db
    .prepare(
      `SELECT id, reporter_fid, target_kind, target_id, reason, status, created_at
       FROM content_reports
       WHERE status = 'open'
       ORDER BY created_at DESC
       LIMIT 40`
    )
    .bind()
    .all<{
      id: string;
      reporter_fid: number;
      target_kind: string;
      target_id: string;
      reason: string;
      status: string;
      created_at: number;
    }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    reporterFid: row.reporter_fid,
    targetKind: row.target_kind,
    targetId: row.target_id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function resolveReport(
  id: string,
  action: "remove" | "dismiss"
): Promise<boolean> {
  await ensureInboxSchema();
  const db = await requireSocialDb();
  const report = await db
    .prepare(
      `SELECT id, target_kind, target_id, status
       FROM content_reports WHERE id = ?`
    )
    .bind(id)
    .first<{
      id: string;
      target_kind: string;
      target_id: string;
      status: string;
    }>();
  if (!report || report.status !== "open") return false;
  const now = Date.now();
  if (action === "remove") {
    if (report.target_kind === "post") {
      await db
        .prepare(`UPDATE posts SET removed_at = ? WHERE id = ? AND removed_at IS NULL`)
        .bind(now, report.target_id)
        .run();
    } else if (report.target_kind === "circle_post") {
      await db
        .prepare(
          `UPDATE circle_posts SET removed_at = ? WHERE id = ? AND removed_at IS NULL`
        )
        .bind(now, report.target_id)
        .run();
    } else if (report.target_kind === "comment") {
      await db
        .prepare(
          `UPDATE post_comments SET removed_at = ? WHERE id = ? AND removed_at IS NULL`
        )
        .bind(now, report.target_id)
        .run();
    }
  }
  await db
    .prepare(
      `UPDATE content_reports
       SET status = ?, resolved_at = ?
       WHERE id = ? AND status = 'open'`
    )
    .bind(action === "remove" ? "removed" : "dismissed", now, id)
    .run();
  return true;
}
