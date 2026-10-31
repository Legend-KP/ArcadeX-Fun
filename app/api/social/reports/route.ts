import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { moderationFailure, screenText } from "@/lib/moderation";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { fileReport } from "@/lib/social-inbox";

export const dynamic = "force-dynamic";

const KINDS = new Set(["post", "circle_post", "comment"]);

export async function POST(request: Request) {
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`report:${session.fid}:${ip}`, 12, 60 * 60_000))) {
    return rateLimitResponse();
  }
  let payload: { targetKind?: string; targetId?: string; reason?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Send a report." }, { status: 400 });
  }
  const targetKind = payload.targetKind ?? "";
  const targetId = typeof payload.targetId === "string" ? payload.targetId.trim() : "";
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (!KINDS.has(targetKind) || !targetId || targetId.length > 80 || reason.length < 3 || reason.length > 280) {
    return NextResponse.json({ error: "Describe what to report." }, { status: 400 });
  }
  try {
    await fileReport({
      reporterFid: session.fid,
      targetKind: targetKind as "post" | "circle_post" | "comment",
      targetId,
      reason: screenText(reason).slice(0, 280),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const blocked = moderationFailure(err);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });
    const message = err instanceof Error ? err.message : "Could not file the report.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
