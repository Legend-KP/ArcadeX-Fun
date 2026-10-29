import { NextResponse } from "next/server";
import { signerErrorResponse } from "@/lib/farcaster/signer/http";
import { confirmSigner } from "@/lib/farcaster/signer/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      generation?: number;
      txHash?: string;
    };
    return NextResponse.json(
      await confirmSigner({
        generation: body.generation ?? 0,
        txHash: body.txHash,
      })
    );
  } catch (error) {
    return signerErrorResponse(error);
  }
}
