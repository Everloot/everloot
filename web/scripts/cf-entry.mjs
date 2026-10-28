// The Worker's entry point, copied to .open-next/cf-entry.mjs by scripts/cf-bundle-files.mjs (wrangler.jsonc
// `main`). It serves requests through OpenNext's worker and adds the scheduled jobs (src/lib/cf-crons.ts), which
// call the same cron routes Vercel calls. The Durable Object classes OpenNext's cache uses are re-exported.
import handler from "./worker.js";
import { cronPaths, cronRequest } from "../src/lib/cf-crons.ts";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./worker.js";

export default {
  fetch: (request, env, ctx) => handler.fetch(request, env, ctx),

  async scheduled(controller, env, ctx) {
    const secret = env.CRON_SECRET;
    if (!secret) return;
    for (const path of cronPaths(controller.cron)) {
      ctx.waitUntil(handler.fetch(cronRequest(path, secret), env, ctx).then(async (res) => {
        if (!res.ok) console.error(`[cron] ${path} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }));
    }
  },
};
