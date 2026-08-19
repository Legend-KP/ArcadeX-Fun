import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";

/**
 * Shared incremental cache for Next data / ISR. ArcadeX pages are
 * force-dynamic; the 50k-DAU win is Cache API on public GET APIs.
 * Queue/tag cache omitted — no time-based or on-demand revalidation.
 */
export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(kvIncrementalCache, {
    mode: "short-lived",
  }),
});
