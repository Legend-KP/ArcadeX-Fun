import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { listPendingJoinRequests, resolveJoinRequest } from "@/lib/circle-invites";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`circle-requests-read:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }
  const { id } = await context.params;
  try {
    const requests = await listPendingJoinRequests(id, session.fid);
    if (!requests) return NextResponse.json({ error: "Circle not found." }, { status: 404 });
    return NextResponse.json({ requests });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load requests.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`circle-requests-write:${session.fid}:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }
  const { id } = await context.params;
  let payload: { requestId?: string; action?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Send a decision." }, { status: 400 });
  }
  const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
  const action = payload.action === "approve" ? "approve" : payload.action === "decline" ? "decline" : "";
  if (!requestId || !action) {
    return NextResponse.json({ error: "Choose approve or decline." }, { status: 400 });
  }
  try {
    const result = await resolveJoinRequest({
      circleId: id,
      requestId,
      fid: session.fid,
      action,
    });
    if (result === "forbidden") {
      return NextResponse.json({ error: "Only the creator can decide." }, { status: 403 });
    }
    if (result === "missing") {
      return NextResponse.json({ error: "That request is no longer waiting." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, status: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update the request.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
