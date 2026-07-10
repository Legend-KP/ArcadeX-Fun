import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import { CHAIN_REGISTRY } from "@/lib/chain-registry";
import {
  fetchChainSettingsFromServer,
  updateChainSettingsOnServer,
} from "@/lib/chain-settings-server";
import type { ChainFeatures, ChainKey } from "@/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await fetchChainSettingsFromServer();
    return NextResponse.json({
      chains: CHAIN_REGISTRY,
      settings,
    });
  } catch (err) {
    return apiErrorResponse(err, "Failed to load chain settings.");
  }
}

export async function PATCH(request: Request) {
  if (!verifyAdminRequest(request)) return unauthorizedResponse();

  try {
    const body = (await request.json()) as {
      key?: ChainKey;
      walletConnect?: boolean;
      shopPayments?: boolean;
    };

    if (!body.key) {
      return NextResponse.json(
        { error: "Chain key is required." },
        { status: 400 }
      );
    }

    const isKnownChain = CHAIN_REGISTRY.some((chain) => chain.key === body.key);
    if (!isKnownChain) {
      return NextResponse.json(
        { error: "Unknown chain key." },
        { status: 400 }
      );
    }

    const patch: Partial<ChainFeatures> = {};
    if (body.walletConnect !== undefined) {
      patch.walletConnect = body.walletConnect;
    }
    if (body.shopPayments !== undefined) {
      patch.shopPayments = body.shopPayments;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No settings to update." },
        { status: 400 }
      );
    }

    const settings = await updateChainSettingsOnServer({
      [body.key]: patch,
    });

    return NextResponse.json({
      chains: CHAIN_REGISTRY,
      settings,
    });
  } catch (err) {
    return apiErrorResponse(err, "Failed to update chain settings.");
  }
}
