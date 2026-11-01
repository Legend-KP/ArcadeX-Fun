import { NextResponse } from "next/server";
import {
  getDailyCampaignId,
  getDailyPlayMode,
} from "@/lib/daily-play-mode";
import {
  matchPublicGetCache,
  publicCatalogCacheKey,
  schedulePublicGetCache,
} from "@/lib/edge-cache";

export const dynamic = "force-dynamic";

/** Runtime daily-play config — works with Cloudflare vars without rebuild. */
export async function GET(request: Request) {
  const cached = await matchPublicGetCache(publicCatalogCacheKey(request));
  if (cached) return cached;

  const mode = getDailyPlayMode();
  const response = NextResponse.json(
    {
      mode,
      campaignId: getDailyCampaignId(),
      shuffle: mode === "shuffle",
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    }
  );
  schedulePublicGetCache(publicCatalogCacheKey(request), response);
  return response;
}
