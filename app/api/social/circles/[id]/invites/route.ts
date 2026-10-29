import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import {
  createInviteLink,
  isInviteExpiryChoice,
  isInviteMaxUses,
  listInviteLinks,
} from "@/lib/circle-invites";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`circle-invites-read:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const { id } = await context.params;
  try {
    const links = await listInviteLinks(id, session.fid);
    if (!links) {
      return NextResponse.json({ error: "Circle not found." }, { status: 404 });
    }
    return NextResponse.json({ links });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load invite links.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!(await checkRateLimit(`circle-invites-create:${session.fid}:${ip}`, 8, 60 * 60_000))) {
    return rateLimitResponse();
  }

  let payload: { expiry?: string; maxUses?: number };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    payload = {};
  }

  const expiry = typeof payload.expiry === "string" ? payload.expiry : "7";
  const maxUses = typeof payload.maxUses === "number" ? payload.maxUses : 10;
  if (!isInviteExpiryChoice(expiry) || !isInviteMaxUses(maxUses)) {
    return NextResponse.json(
      { error: "Choose an expiry and a use limit." },
      { status: 400 }
    );
  }

  const { id } = await context.params;
  try {
    const created = await createInviteLink({
      circleId: id,
      fid: session.fid,
      expiry,
      maxUses,
    });
    const url = new URL(`/invite/${created.token}`, request.url);
    return NextResponse.json({
      link: created.link,
      url: url.pathname,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create an invite link.";
    const status = message.includes("creator") ? 403 : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
