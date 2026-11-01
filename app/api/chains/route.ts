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
import {
  matchPublicGetCache,
  publicCatalogCacheKey,
  schedulePublicGetCache,
} from "@/lib/edge-cache";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const isAdmin = Boolean(
    request.headers.get("authorization") || request.headers.get("x-admin-password")
  );
  if (!isAdmin) {
    const cached = await matchPublicGetCache(publicCatalogCacheKey(request));
    if (cached) return cached;
  }

  try {
    const settings = await fetchChainSettingsFromServer();
    const response = NextResponse.json(
      {
        chains: CHAIN_REGISTRY,
        settings,
      },
      isAdmin
        ? { headers: { "Cache-Control": "private, no-store" } }
        : {
            headers: {
              "Cache-Control":
                "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
            },
          }
    );
    if (!isAdmin) {
      schedulePublicGetCache(publicCatalogCacheKey(request), response);
    }
    return response;
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
