import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Do not bind OpenNext incremental cache to KV.
 * Pages are force-dynamic; populateCache would KV bulk-put on every deploy
 * and trip the free-plan daily write cap (error 10048). Public catalog and
 * leaderboards use Cache API (lib/edge-cache.ts) instead.
 */
export default defineCloudflareConfig({});
