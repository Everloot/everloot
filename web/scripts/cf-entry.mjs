// The Worker's entry point, copied to .open-next/cf-entry.mjs by scripts/cf-bundle-files.mjs (wrangler.jsonc
// `main`). It serves requests through OpenNext's worker, keeps the pages next.config.js marks for the CDN in the
// Cache API (src/lib/cf-edge-cache.ts, Vercel's CDN cache in its place), and runs the scheduled jobs
// (src/lib/cf-crons.ts), which call the same cron routes Vercel calls. OpenNext's Durable Object classes are re-exported.
import handler from "./worker.js";
import { cronPaths, cronRequest } from "../src/lib/cf-crons.ts";
import { edgeCacheKey, edgeCacheable, edgeTtl, forCache, fromCache } from "../src/lib/cf-edge-cache.ts";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./worker.js";

export default {
  async fetch(request, env, ctx) {
    if (!edgeCacheable(request) || typeof caches === "undefined") return handler.fetch(request, env, ctx);
    const key = edgeCacheKey(request, env.EVERLOOT_COMMIT_SHA);
    const hit = await caches.default.match(key);
    if (hit) return fromCache(hit);
    const res = await handler.fetch(request, env, ctx);
    const ttl = edgeTtl(res);
    if (ttl) ctx.waitUntil(caches.default.put(key, forCache(res.clone(), ttl)));
    return res;
  },

  // A failed job throws, so Cloudflare's cron history shows it (logs are sampled; this is not).
  async scheduled(controller, env, ctx) {
    const secret = env.CRON_SECRET;
    if (!secret) throw new Error("[cron] CRON_SECRET is not set; nothing ran");
    const failures = [];
    await Promise.all(cronPaths(controller.cron).map(async (path) => {
      const res = await handler.fetch(cronRequest(path, secret), env, ctx);
      if (!res.ok) failures.push(`${path} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }));
    if (failures.length) throw new Error(`[cron] ${failures.join("; ")}`);
  },
};
