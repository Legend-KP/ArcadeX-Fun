import { NextResponse } from "next/server";
import { signerErrorResponse } from "@/lib/farcaster/signer/http";
import {
  confirmSignerRevoke,
  prepareSignerRevoke,
  submitSignerRevoke,
} from "@/lib/farcaster/signer/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      step?: string;
      generation?: number;
      signature?: string;
      nonce?: string;
      deadline?: string;
      txHash?: string;
    };
    const generation = body.generation ?? 0;
    if (body.step === "submit") {
      return NextResponse.json(
        await submitSignerRevoke({
          generation,
          signature: body.signature ?? "",
          nonce: body.nonce ?? "",
          deadline: body.deadline ?? "",
        })
      );
    }
    if (body.step === "confirm") {
      return NextResponse.json(
        await confirmSignerRevoke({ generation, txHash: body.txHash })
      );
    }
    return NextResponse.json(await prepareSignerRevoke(generation));
  } catch (error) {
    return signerErrorResponse(error);
  }
}
