import { NextResponse } from "next/server";
import { PUBLIC_RECORD_KINDS as PUBLIC_KINDS } from "@everloot/protocol";
import { admit, attribution, attributionHeaders, badPage, pageOf, pageRequest } from "@/lib/data-guard";
import { published, publicInstallId, publicInstallSecret } from "@/lib/public-install";
import { uploadStore } from "@/lib/upload-store";
import { recordUsage } from "@/lib/usage-metrics";
export const dynamic = "force-dynamic";

/*
 * Records leave the site with a per-install pseudonym in place of the addon's install id (lib/public-install.ts),
 * so anyone can count installs without learning the id. The site's own pages and MCP endpoints read the corpus in process.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const CACHE = { "Cache-Control": "public, max-age=60", "CDN-Cache-Control": "max-age=300" };

/**
 * `?kinds=a,b` returns only those record kinds, so an MCP tool fetches what it reads, not the whole corpus.
 * `?offset=` and `?limit=` page through it; with the data guard on, a page is capped (see lib/data-guard.ts)
 * and `next` links the following page.
 */
export async function GET(req: Request) {
  recordUsage("api.corpus_public");
  const param = new URL(req.url).searchParams.get("kinds");
  const kinds = param === null ? null : [...new Set(param.split(",").map((k) => k.trim()).filter(Boolean))].sort();
  if (kinds && (kinds.length === 0 || kinds.some((k) => !PUBLIC_KINDS.includes(k)))) {
    return NextResponse.json({ ok: false, error: "Unknown record kind." }, { status: 400, headers: NO_STORE });
  }
  const admitted = await admit(req, "corpus");
  if (admitted instanceof Response) return admitted;
  const at = pageRequest(req, admitted.pageMax);
  if (!at) return badPage();
  const secret = publicInstallSecret();
  // Canonical pagination links and the kinds echo must agree across equivalent cache keys.
  const url = new URL(req.url);
  url.search = "";
  if (kinds) url.searchParams.set("kinds", kinds.join(","));
  url.searchParams.set("offset", String(at.offset));
  if (at.limit !== null) url.searchParams.set("limit", String(at.limit));
  url.searchParams.sort();
  const credentialed = req.headers.has("cookie") || req.headers.has("authorization");
  const shared = admitted.tier === "open" && !credentialed;
  const headers = { "Content-Type": "application/json", ...(shared ? CACHE : NO_STORE), ...attributionHeaders() };
  // Cache only after admission, so a hit still spends the caller's quota. The effective limit is
  // in the key; an anonymous page can never read a larger keyed page. Cookies/keys bypass it.
  const cache = credentialed ? undefined : (globalThis as unknown as {
    caches?: { default?: Pick<Cache, "match" | "put"> };
  }).caches?.default;
  const keyUrl = new URL(url);
  keyUrl.searchParams.set("__corpus_cache", `${process.env.EVERLOOT_COMMIT_SHA || "local"}.${secret ? publicInstallId("corpus-cache", secret) : "no-pseudonyms"}`);
  const key = new Request(keyUrl);
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return new Response(hit.body, { headers: { ...headers, "X-Everloot-Corpus-Cache": "HIT" } });
    } catch { /* A cache outage must not make the public corpus unavailable. */ }
  }
  const corpus = await uploadStore.loadCorpus();
  if (corpus.unreachable) return NextResponse.json({ ok: false, error: "Public corpus unavailable." }, { status: 503, headers: NO_STORE });
  const wanted = new Set(kinds ?? PUBLIC_KINDS);
  const { items, page } = pageOf(new Request(url), corpus.records.filter((r) => wanted.has(r.kind)), at);
  const response = NextResponse.json(
    { ok: true, ...corpus, ...(kinds ? { kinds } : {}), records: items.map((r) => published(r, secret)), ...page, attribution: attribution("/database") },
    { headers },
  );
  if (cache) {
    try {
      const copy = response.clone();
      copy.headers.set("Cache-Control", "public, max-age=300");
      await cache.put(key, copy);
    } catch { /* Return the fresh answer when caching is unavailable or the body exceeds its size limit. */ }
  }
  return response;
}
