import { NextResponse } from "next/server";
import { unauthorizedResponse, verifyAdminRequest } from "@/lib/admin-auth";
import { listAllCircles } from "@/lib/circle-invites";
import { fetchGamesFromServer } from "@/lib/firestore-server";
import { screenText, moderationFailure } from "@/lib/moderation";
import {
  campHref,
  createBroadcast,
  listBroadcasts,
  type CampKind,
} from "@/lib/social-inbox";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyAdminRequest(request)) return unauthorizedResponse();
  try {
    const [broadcasts, circles, games] = await Promise.all([
      listBroadcasts(),
      listAllCircles(),
      fetchGamesFromServer().catch(() => []),
    ]);
    return NextResponse.json({
      broadcasts,
      camps: [
        ...circles.map((circle) => ({
          kind: "circle" as const,
          id: circle.id,
          label: circle.name,
        })),
        ...games.map((game) => ({
          kind: "game" as const,
          id: game.id,
          label: game.name,
        })),
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load notifications.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!verifyAdminRequest(request)) return unauthorizedResponse();
  let payload: { title?: string; body?: string; campKind?: string; campId?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Send a notification." }, { status: 400 });
  }
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  const campKind: CampKind | null =
    payload.campKind === "circle" || payload.campKind === "game" ? payload.campKind : null;
  const campId = typeof payload.campId === "string" ? payload.campId.trim() : "";
  if (title.length < 2 || title.length > 80 || body.length < 2 || body.length > 280) {
    return NextResponse.json(
      { error: "Add a title and a message players will see in the app." },
      { status: 400 }
    );
  }
  if (campKind && !campHref(campKind, campId)) {
    return NextResponse.json({ error: "Pick a camp to open." }, { status: 400 });
  }
  try {
    const broadcast = await createBroadcast({
      title: screenText(title).slice(0, 80),
      body: screenText(body).slice(0, 280),
      campKind,
      campId: campKind ? campId : null,
    });
    return NextResponse.json({ broadcast });
  } catch (err) {
    const blocked = moderationFailure(err);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });
    const message = err instanceof Error ? err.message : "Could not send the notification.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
