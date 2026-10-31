import { NextResponse } from "next/server";
import { signerErrorResponse } from "@/lib/farcaster/signer/http";
import {
  createSignerDeeplink,
  pollSignerDeeplink,
} from "@/lib/farcaster/signer/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { generation?: number };
    return NextResponse.json(await createSignerDeeplink(body.generation ?? 0));
  } catch (error) {
    return signerErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    const generation = Number(url.searchParams.get("generation"));
    return NextResponse.json(await pollSignerDeeplink(token, generation));
  } catch (error) {
    return signerErrorResponse(error);
  }
}
