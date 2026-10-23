import { NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { getTextPost } from "@/lib/social-board";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`social-post-read:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  const { id } = await params;
  try {
    const post = await getTextPost(id);
    if (!post) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }
    return NextResponse.json({ post });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load the post.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
