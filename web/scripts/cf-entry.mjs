// The Worker's entry point, copied to .open-next/cf-entry.mjs by scripts/cf-bundle-files.mjs (`main` in
// wrangler.jsonc and wrangler.cron.jsonc). It serves requests through OpenNext's worker, keeps the pages
// next.config.js marks for the CDN in the Cache API (src/lib/cf-edge-cache.ts), and runs the scheduled jobs
// (src/lib/cf-crons.ts), which call the cron routes. OpenNext's Durable Object classes are re-exported.
import handler from "./worker.js";
// The edge cache's content versions for this build, written next to this file by scripts/cf-bundle-files.mjs from the
// build's own inputs and output. They ship inside the bundle, so they cannot describe another build.
import cacheVersions from "./cache-versions.json";
import { runCrons } from "../src/lib/cf-crons.ts";
import { cachedResponse } from "../src/lib/cf-edge-cache.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { installServerTiming, withServerTiming } from "../src/lib/server-timing.ts";

// The armory character and guild pages get a Server-Timing header: each storage read's name and duration, and how many
// requests this isolate has served.
installServerTiming(new AsyncLocalStorage());

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./worker.js";

export default {
  async fetch(request, env, ctx) {
    if (typeof caches === "undefined") return withServerTiming(request, () => handler.fetch(request, env, ctx));
    // The route's content versions, not the commit: another page's deploy keeps this cache. src/lib/cf-edge-cache.ts
    // also refuses a request that carries a cookie, the account's and session's paths, and a missing version.
    // The copy is read to the end before it is stored, after the response has gone: a page that marks itself
    // degraded is kept a minute, not its full lifetime.
    return cachedResponse(request, cacheVersions, (r) => withServerTiming(r, () => handler.fetch(r, env, ctx)), caches.default, ctx);
  },

  // Each job runs as its own request through the Worker's self-binding (src/lib/cf-crons.ts). EVERLOOT_CRON_WORKER
  // says which jobs this Worker runs: the cron Worker runs them, and the site keeps only SITE_JOBS once it is "1".
  async scheduled(controller, env) {
    await runCrons(controller.cron, env);
  },
};
