import { NextResponse } from "next/server";
import { unauthorizedResponse, verifyAdminRequest } from "@/lib/admin-auth";
import { ensureSocialBoardSchema } from "@/lib/social-board";
import { ensureCircleContentSchema } from "@/lib/circle-content";
import { listOpenReports, resolveReport } from "@/lib/social-inbox";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyAdminRequest(request)) return unauthorizedResponse();
  try {
    await ensureSocialBoardSchema();
    await ensureCircleContentSchema();
    const reports = await listOpenReports();
    return NextResponse.json({ reports });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load reports.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!verifyAdminRequest(request)) return unauthorizedResponse();
  let payload: { id?: string; action?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Send a decision." }, { status: 400 });
  }
  const id = typeof payload.id === "string" ? payload.id : "";
  const action = payload.action === "remove" || payload.action === "dismiss" ? payload.action : "";
  if (!id || !action) {
    return NextResponse.json({ error: "Choose remove or dismiss." }, { status: 400 });
  }
  try {
    await ensureSocialBoardSchema();
    await ensureCircleContentSchema();
    const ok = await resolveReport(id, action);
    if (!ok) {
      return NextResponse.json({ error: "That report is already closed." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update the report.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
