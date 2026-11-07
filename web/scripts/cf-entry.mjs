// The Worker's entry point, copied to .open-next/cf-entry.mjs by scripts/cf-bundle-files.mjs (wrangler.jsonc
// `main`). It serves requests through OpenNext's worker, keeps the pages next.config.js marks for the CDN in the
// Cache API (src/lib/cf-edge-cache.ts), and runs the scheduled jobs
// (src/lib/cf-crons.ts), which call the cron routes. OpenNext's Durable Object classes are re-exported.
import handler from "./worker.js";
// The edge cache's content versions for this build, written next to this file by scripts/cf-bundle-files.mjs from the
// build's own inputs and output. They ship inside the bundle, so they cannot describe another build.
import cacheVersions from "./cache-versions.json";
import { cronPaths, cronRequest } from "../src/lib/cf-crons.ts";
import { cachedResponse } from "../src/lib/cf-edge-cache.ts";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./worker.js";

export default {
  async fetch(request, env, ctx) {
    if (typeof caches === "undefined") return handler.fetch(request, env, ctx);
    // The route's content versions, not the commit: another page's deploy keeps this cache. src/lib/cf-edge-cache.ts
    // also refuses a request that carries a cookie, the account's and session's paths, and a missing version.
    // The copy is read to the end before it is stored, after the response has gone: a page that marks itself
    // degraded is kept a minute, not its full lifetime.
    return cachedResponse(request, cacheVersions, (r) => handler.fetch(r, env, ctx), caches.default, ctx);
  },

  // Each job runs as its own request through the Worker's self-binding, so each gets its own CPU budget, memory and
  // subrequest count rather than sharing the trigger's. A failed job throws, so Cloudflare's cron history shows it
  // (logs are sampled; this is not).
  async scheduled(controller, env, ctx) {
    const secret = env.CRON_SECRET;
    if (!secret) throw new Error("[cron] CRON_SECRET is not set; nothing ran");
    const failures = [];
    await Promise.all(cronPaths(controller.cron).map(async (path) => {
      const res = await env.WORKER_SELF_REFERENCE.fetch(cronRequest(path, secret));
      // Read to the end even on success: a body left unread is cut off when the trigger ends, and the job's own
      // invocation is then logged as "canceled" although it finished.
      const body = await res.text();
      if (!res.ok) failures.push(`${path} answered ${res.status}: ${body.slice(0, 300)}`);
    }));
    if (failures.length) throw new Error(`[cron] ${failures.join("; ")}`);
  },
};
