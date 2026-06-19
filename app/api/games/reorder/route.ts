import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import { reorderGamesOnServer } from "@/lib/firestore-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyAdminRequest(request)) return unauthorizedResponse();

  try {
    const body = (await request.json()) as { ids?: string[] };
    const ids = body.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "ids must be a non-empty array." },
        { status: 400 }
      );
    }

    if (!ids.every((id) => typeof id === "string" && id.trim())) {
      return NextResponse.json(
        { error: "Each id must be a non-empty string." },
        { status: 400 }
      );
    }

    await reorderGamesOnServer(ids);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Failed to reorder games.");
  }
}
