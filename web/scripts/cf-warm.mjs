/**
 * After a deploy: waits until the site serves the commit just deployed, then asks for every page in its sitemap,
 * a few at a time. Each deploy changes the edge cache key (src/lib/cf-edge-cache.ts), so this puts the new version's
 * pages in the cache of the data centre the runner reaches, and it is a smoke check of the deploy: any page that
 * does not answer 200 fails the run. Other data centres still fill on their first visit.
 * Run: node scripts/cf-warm.mjs <origin> <commit sha>
 */
import { pathToFileURL } from "node:url";

/** The page addresses a sitemap lists, in order, without repeats. */
export function sitemapUrls(xml) {
  return [...new Set([...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replaceAll("&amp;", "&")))];
}

/** The lines to print and whether the run passed: every page must answer 200. */
export function summarize(results) {
  const bad = results.filter((r) => r.status !== 200);
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const p95 = ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))] : 0;
  return {
    ok: bad.length === 0,
    lines: [
      `${results.length} pages, ${results.length - bad.length} answered 200, p95 ${Math.round(p95)} ms`,
      ...bad.map((r) => `  ${r.status || r.error} ${r.url}`),
    ],
  };
}

async function get(url) {
  const t = performance.now();
  try {
    const res = await fetch(url, { headers: { "user-agent": "everloot-deploy-warm" }, signal: AbortSignal.timeout(30_000) });
    const body = await res.text();
    return { url, status: res.status, body, ms: performance.now() - t };
  } catch (e) {
    return { url, status: 0, error: String(e?.name ?? e), ms: performance.now() - t };
  }
}

/** Polls the home page until its footer names the commit; a deploy takes a few seconds to reach every data centre. */
async function waitForCommit(origin, sha, tries = 24) {
  for (let i = 0; i < tries; i++) {
    const res = await get(`${origin}/?deploy-check=${Date.now()}`);
    if (res.body?.includes(sha)) return true;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return false;
}

async function main([origin, sha]) {
  if (!origin || !sha) throw new Error("usage: node scripts/cf-warm.mjs <origin> <commit sha>");
  if (!(await waitForCommit(origin, sha))) throw new Error(`${origin} does not serve ${sha} after two minutes`);
  const sitemap = await get(`${origin}/sitemap.xml`);
  if (sitemap.status !== 200) throw new Error(`the sitemap answered ${sitemap.status || sitemap.error}`);
  const urls = sitemapUrls(sitemap.body);
  const results = [];
  for (let i = 0; i < urls.length; i += 4) results.push(...(await Promise.all(urls.slice(i, i + 4).map(get))));
  const { ok, lines } = summarize(results);
  console.log(lines.join("\n"));
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
