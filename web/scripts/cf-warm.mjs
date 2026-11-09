/**
 * After a deploy: waits until the site serves the commit just deployed, then asks for a bounded sample of the
 * pages in its sitemap, a few at a time. Each page's cache key carries its content versions
 * (src/lib/cf-edge-cache.ts), so this fills the cache of the data centre the runner reaches; it is a smoke check,
 * not a crawl: at most MAX_PAGES unique pages and MAX_MS milliseconds in total (the commit wait, the sitemap and
 * retries share the budget), however large the sitemap is. A 429 is the edge
 * asking the runner to slow down, not a broken page, and a network error on one request is the runner's connection,
 * not the page: those pages are asked for again, fewer at a time, after the wait the answer names (a minute when it
 * names none), twice before they count as failures. Other data centres still fill on their first visit.
 * The lore pages open the knowledge release on the request path, which a cold isolate hashes whole, so they are
 * asked for first, one at a time, before the sample; a 500 there is the cold render outrunning the Worker's CPU
 * budget under load and is asked once more after a short wait before it counts.
 * Run: node scripts/cf-warm.mjs <origin> <commit sha>
 */
import { pathToFileURL } from "node:url";

/** The most pages one deploy warms, however large the sitemap. */
export const MAX_PAGES = 80;
/** The most time one deploy spends warming, in milliseconds. */
export const MAX_MS = 120_000;
const CONCURRENCY = 4;
/** How long to wait before asking a release page that answered 500 once more. */
const RELEASE_RETRY_MS = 5_000;

/** The page addresses a sitemap lists, in order, without repeats. */
export function sitemapUrls(xml) {
  return [...new Set([...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replaceAll("&amp;", "&")))];
}

/**
 * The pages that open the knowledge release on the request path (src/lib/release.ts): /lore and every page under
 * it. They are warmed first and alone, so the release opens once, on an idle isolate.
 */
export function releasePages(urls) {
  return urls.filter((u) => /^\/lore(\/|$)/.test(new URL(u).pathname));
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

/**
 * The lines to print and whether the run passed: every page asked must answer 200. Pages left for another deploy
 * by the page or time limit are named apart and do not fail the run.
 */
export function summarize(results, skipped = []) {
  const bad = results.filter((r) => r.status !== 200);
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const p95 = ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))] : 0;
  const of = skipped.length ? `${results.length} of ${results.length + skipped.length}` : `${results.length}`;
  return {
    ok: bad.length === 0,
    lines: [
      `${of} pages, ${results.length - bad.length} answered 200, p95 ${Math.round(p95)} ms`,
      ...(skipped.length ? [`  ${skipped.length} not checked (warm limit)`] : []),
      ...bad.map((r) => `  ${r.status || r.error} ${r.url}`),
    ],
  };
}

/**
 * The zone's security rules challenge clients that are not browsers on /database/* and rate-limit it per address.
 * A rule ahead of them skips both for requests whose x-everloot-check header equals the EVERLOOT_EDGE_CHECK secret,
 * so the warm pass reaches every page. Without the secret the header is left out.
 * @param {Record<string, string | undefined>} [env]
 */
export function requestHeaders(env = process.env) {
  // Trimmed: a secret stored with a trailing newline would make every fetch throw ("invalid header value").
  const check = env.EVERLOOT_EDGE_CHECK?.trim();
  return { "user-agent": "everloot-deploy-warm", ...(check ? { "x-everloot-check": check } : {}) };
}

async function get(url, timeoutMs = 30_000) {
  const t = performance.now();
  try {
    const res = await fetch(url, { headers: requestHeaders(), signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, timeoutMs))) });
    const body = await res.text();
    return { url, status: res.status, body, ms: performance.now() - t, retryAfter: res.headers.get("retry-after") };
  } catch (e) {
    return { url, status: 0, error: String(e?.name ?? e), ms: performance.now() - t };
  }
}

/**
 * Warms at most `maxPages` of `urls` within `maxMs`, `concurrency` at a time, and names the rest as skipped.
 * `get` and `now` are injected so the limits are tested without a network or a clock.
 */
export async function warm(urls, { get: fetchOne = get, now = () => performance.now(), maxPages = MAX_PAGES, maxMs = MAX_MS, concurrency = CONCURRENCY } = {}) {
  const started = now();
  const picked = urls.slice(0, maxPages);
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < picked.length) {
      const remaining = maxMs - (now() - started);
      if (remaining <= 0) return;
      const url = picked[next++];
      results.push(await fetchOne(url, Math.min(30_000, remaining)));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, picked.length) }, worker));
  const asked = new Set(results.map((r) => r.url));
  return { results, skipped: urls.filter((u, i) => i >= picked.length || !asked.has(u)) };
}

/**
 * The whole post-deploy pass: wait for the commit, read the sitemap, warm a sample and retry what was rate
 * limited. It spends at most `maxMs` in total (the commit wait, the sitemap and the retries share one deadline)
 * and asks at most `maxPages` unique pages, however many retries a page takes. `get`, `now` and `sleep` are
 * injected so the limits are tested without a network or a clock. A page may be requested up to three times
 * (the pass and two retries), which is not a new page. The release pages go first, serially, and a 500 on that
 * pass is asked once more after RELEASE_RETRY_MS before it counts; the sample follows with the rest of the page budget.
 * @param {{ origin?: string, sha?: string, get?: (url: string, timeoutMs?: number) => Promise<{ url: string, status: number, body?: string, ms?: number, retryAfter?: string | null, error?: string }>, now?: () => number, sleep?: (ms: number) => Promise<unknown>, log?: (line: string) => void, maxMs?: number, maxPages?: number, concurrency?: number }} [options]
 */
export async function warmDeploy({
  origin, sha,
  get: fetchOne = get,
  now = () => performance.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log,
  maxMs = MAX_MS,
  maxPages = MAX_PAGES,
  concurrency = CONCURRENCY,
} = {}) {
  if (!origin || !sha) throw new Error("usage: node scripts/cf-warm.mjs <origin> <commit sha>");
  const started = now();
  const remaining = () => Math.max(0, maxMs - (now() - started));
  const ask = (url, cap = 30_000) => fetchOne(url, Math.min(cap, remaining()));

  // Polls the home page until its footer names the commit; a deploy takes a few seconds to reach every data centre.
  let served = false;
  for (let i = 0; i < 24 && remaining() > 0; i++) {
    const res = await ask(`${origin}/?deploy-check=${Math.round(now())}`);
    if (res.body?.includes(sha)) { served = true; break; }
    const wait = Math.min(5_000, remaining());
    if (wait <= 0) break;
    await sleep(wait);
  }
  if (!served) throw new Error(`${origin} does not serve ${sha} within ${Math.round(maxMs / 1000)} s`);

  const sitemap = await ask(`${origin}/sitemap.xml`);
  if (sitemap.status !== 200) throw new Error(`the sitemap answered ${sitemap.status || sitemap.error}`);
  const urls = sitemapUrls(sitemap.body);
  if (remaining() <= 0) return { ...summarize([], urls), results: [], skipped: urls, pagesAsked: 0 };

  const lore = releasePages(urls);
  const first = await warm(lore, { get: fetchOne, now, maxMs: remaining(), maxPages, concurrency: 1 });
  const killed = first.results.filter((r) => r.status === 500).map((r) => r.url);
  if (killed.length > 0 && RELEASE_RETRY_MS < remaining()) {
    log(`${killed.length} release pages answered 500 on the cold pass; asking again in ${Math.round(RELEASE_RETRY_MS / 1000)} s`);
    await sleep(RELEASE_RETRY_MS);
    const retried = await warm(killed, { get: fetchOne, now, maxMs: remaining(), maxPages: killed.length, concurrency: 1 });
    const byUrl = new Map(retried.results.map((r) => [r.url, r]));
    first.results = first.results.map((r) => byUrl.get(r.url) ?? r);
  }
  const rest = urls.filter((u) => !lore.includes(u));
  const sample = await warm(rest, { get: fetchOne, now, maxMs: remaining(), maxPages: Math.max(0, maxPages - first.results.length), concurrency });
  let results = [...first.results, ...sample.results];
  const skipped = [...first.skipped, ...sample.skipped];
  // Twice, not five times: a rate-limited page that survives two waits is not made better by a longer crawl.
  for (let round = 0; round < 2; round++) {
    const { urls: again, waitMs } = rateLimited(results);
    if (again.length === 0 || waitMs >= remaining()) break;
    log(`${again.length} pages answered 429 or not at all; asking again in ${Math.round(waitMs / 1000)} s`);
    await sleep(waitMs);
    if (remaining() <= 0) break;
    const retried = await warm(again, { get: fetchOne, now, maxMs: remaining(), maxPages: again.length, concurrency });
    const byUrl = new Map(retried.results.map((r) => [r.url, r]));
    results = results.map((r) => byUrl.get(r.url) ?? r);
  }
  return { ...summarize(results, skipped), results, skipped, pagesAsked: new Set(results.map((r) => r.url)).size };
}

async function main([origin, sha]) {
  const { ok, lines } = await warmDeploy({ origin, sha });
  console.log(lines.join("\n"));
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
