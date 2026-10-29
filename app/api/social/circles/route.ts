import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { createCircle, listCirclesForFid } from "@/lib/circle-invites";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`circles-read:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  try {
    const circles = await listCirclesForFid(session.fid);
    return NextResponse.json({ circles });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load circles.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!(await checkRateLimit(`circles-create:${session.fid}:${ip}`, 10, 60 * 60_000))) {
    return rateLimitResponse();
  }

  let payload: { name?: string; description?: string; visibility?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Send a circle." }, { status: 400 });
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const description =
    typeof payload.description === "string" ? payload.description.trim() : "";
  const visibility = payload.visibility === "private" ? "private" : payload.visibility === "public" ? "public" : "";

  if (name.length < 2 || name.length > 40) {
    return NextResponse.json({ error: "Name the circle in 2 to 40 characters." }, { status: 400 });
  }
  if (description.length < 1 || description.length > 280) {
    return NextResponse.json(
      { error: "Add a description, up to 280 characters." },
      { status: 400 }
    );
  }
  if (!visibility) {
    return NextResponse.json({ error: "Choose public or private." }, { status: 400 });
  }

  try {
    const circle = await createCircle({
      fid: session.fid,
      playerId: session.playerId,
      name,
      description,
      visibility,
    });
    return NextResponse.json({ circle });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create the circle.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
