import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";

// Pre-built and ISR pages live in R2, revalidation runs through a Durable Object queue, and the tags that
// revalidateTag and revalidatePath write (blue posts, guild and player opt-outs) live in D1. The regional cache
// keeps an entry at most a minute in each data centre ("short-lived"), so a hit rarely goes to R2, and an opt-out
// still disappears everywhere within that minute ("long-lived" would keep a region's copy until it revalidates).
export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(r2IncrementalCache, { mode: "short-lived" }),
  queue: doQueue,
  tagCache: d1NextTagCache,
  enableCacheInterception: true,
});
