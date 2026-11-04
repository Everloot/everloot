/**
 * After a deploy: waits until the site serves the commit just deployed, then asks for every page in its sitemap,
 * a few at a time. Each deploy changes the edge cache key (src/lib/cf-edge-cache.ts), so this puts the new version's
 * pages in the cache of the data centre the runner reaches, and it is a smoke check of the deploy: any page that
 * does not answer 200 fails the run. A 429 is the edge asking the runner to slow down, not a broken page, and a
 * network error on one request is the runner's connection, not the page: those pages are asked for again, fewer at a
 * time, after the wait the answer names (a minute when it names none), up to five times before they count as
 * failures. Other data centres still fill on their first visit.
 * Run: node scripts/cf-warm.mjs <origin> <commit sha>
 */
import { pathToFileURL } from "node:url";

/** The page addresses a sitemap lists, in order, without repeats. */
export function sitemapUrls(xml) {
  return [...new Set([...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replaceAll("&amp;", "&")))];
}

/**
 * The pages a pass left rate-limited or unanswered (a network error, status 0), and how long to wait before asking
 * again: the longest Retry-After, else a minute.
 */
export function rateLimited(results) {
  const limited = results.filter((r) => r.status === 429 || r.status === 0);
  const waits = limited.map((r) => Number(r.retryAfter)).filter((n) => Number.isFinite(n) && n > 0);
  return { urls: limited.map((r) => r.url), waitMs: waits.length ? Math.max(...waits) * 1000 : 60_000 };
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
    return { url, status: res.status, body, ms: performance.now() - t, retryAfter: res.headers.get("retry-after") };
  } catch (e) {
    return { url, status: 0, error: String(e?.name ?? e), ms: performance.now() - t };
  }
}

/** Every page, `at` at a time, in sitemap order. */
async function fetchAll(urls, at) {
  const results = [];
  for (let i = 0; i < urls.length; i += at) results.push(...(await Promise.all(urls.slice(i, i + at).map(get))));
  return results;
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
  let results = await fetchAll(urls, 4);
  for (let round = 0; round < 5; round++) {
    const { urls: again, waitMs } = rateLimited(results);
    if (again.length === 0) break;
    console.log(`${again.length} pages answered 429 or not at all; asking again in ${Math.round(waitMs / 1000)} s`);
    await new Promise((r) => setTimeout(r, waitMs));
    const retried = new Map((await fetchAll(again, 2)).map((r) => [r.url, r]));
    results = results.map((r) => retried.get(r.url) ?? r);
  }
  const { ok, lines } = summarize(results);
  console.log(lines.join("\n"));
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
