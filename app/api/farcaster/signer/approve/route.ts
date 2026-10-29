import { NextResponse } from "next/server";
import { signerErrorResponse } from "@/lib/farcaster/signer/http";
import { approveSigner } from "@/lib/farcaster/signer/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      generation?: number;
      signature?: string;
    };
    return NextResponse.json(
      await approveSigner({
        generation: body.generation ?? 0,
        signature: body.signature ?? "",
      })
    );
  } catch (error) {
    return signerErrorResponse(error);
  }
}
