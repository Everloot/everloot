// @ts-check
// CommonJS, not TypeScript: next.config.js requires this table when the config loads, before anything is compiled.

/**
 * How long the shared CDN may keep a public page, by route group. next.config.js turns each row's `sources` into its
 * `CDN-Cache-Control` rules (Next overwrites Cache-Control on dynamic pages, so the CDN-specific header is used), and a
 * page listed under `pages` holds `export const revalidate = <maxAge>` instead (Next needs that number written in the
 * page itself). next-config.test.ts holds both to this table, and fails on a row nothing uses.
 *
 * Every source here must render the same HTML for every visitor: no cookies, no session.
 *
 * @typedef {object} CacheRow
 * @property {number} maxAge Seconds the CDN serves its copy without asking.
 * @property {number} [staleWhileRevalidate] Seconds after that it may still serve the old copy while it fetches a new one.
 * @property {true} [noStore] No shared cache may keep the page at all.
 * @property {string} reason Why this group gets this lifetime.
 * @property {string[]} sources The next.config.js header sources that carry this policy.
 * @property {string[]} [pages] Pages under app/ that hold this group's maxAge as their `revalidate`.
 */

/** @type {Record<string, CacheRow>} */
const CACHE_POLICY = {
  private: {
    maxAge: 0,
    noStore: true,
    reason: "Blizzard's auction data may not outlive 30 days and a failed read must not be served, so nothing shared keeps the page.",
    // Also under the served version's prefix (next.config.js servedSources).
    sources: ["/blizzard-auctions/:path*"],
  },
  search: {
    maxAge: 300,
    staleWhileRevalidate: 3600,
    reason: "Reads no cookies, but newly agreed names should show within minutes.",
    sources: ["/search"],
  },
  changes: {
    maxAge: 300,
    staleWhileRevalidate: 3600,
    reason: "Reads no cookies, but new blue posts should show within minutes.",
    sources: ["/changes"],
  },
  auctions: {
    maxAge: 300,
    reason: "Market browse and item pages read no session and cost about 5 s of CPU each; five minutes, the same as their revalidate.",
    // `/tools/auctions/:realm/:itemId` also covers `/tools/auctions/item/:itemId`.
    sources: ["/tools/auctions", "/tools/auctions/:realm", "/tools/auctions/:realm/:itemId"],
    pages: ["tools/auctions/item/[itemId]", "tools/auctions/[realm]/[itemId]"],
  },
  professions: {
    maxAge: 180,
    // The pages carry AH Ledger crafting prices, which may be kept no longer than AH Ledger's max-age=300: the shared
    // read (at most 120 s) plus this page's 180 s stays within it, so no stale-while-revalidate either.
    reason: "Each page renders every recipe with the corpus's gathering areas (2 to 5 s); short, so a page drawn while storage was unreachable does not stay long, and no older than AH Ledger's prices may be.",
    sources: ["/tools/professions/:path*"],
  },
  briefTools: {
    maxAge: 300,
    staleWhileRevalidate: 3600,
    reason: "Bags, disenchanting and farming routes price from the market rollup or the corpus (2 to 4 s live), like the auction pages; collections stays out, it shows one install.",
    sources: ["/tools/bags", "/tools/disenchanting", "/tools/farming-routes"],
  },
  lists: {
    maxAge: 300,
    staleWhileRevalidate: 3600,
    reason: "The database index, lists and census render from the whole corpus; five minutes, so a page drawn while storage was unreachable heals soon.",
    sources: [
      "/database",
      // A type's `:path*` source matches its list too; its detail pages take the entity row below, which comes later.
      ...["npcs", "quests", "objects", "vendors", "spells", "achievements", "titles", "factions", "quest-chains", "drops", "zones", "instances", "coverage"]
        .map((type) => `/database/${type}/:path*`),
      "/census",
      // /rankings is not here: its hub shows Blizzard's boards, so the tree is ad-free (data/ad-free-paths.json) and never shared.
    ],
    // Its one read is the public bulk bucket's manifest, which the page's fetch already keeps five minutes.
    pages: ["database/download"],
  },
  // Last: for the same header the later rule wins, and the detail sources sit inside the lists' `:path*` sources.
  entity: {
    maxAge: 3600,
    staleWhileRevalidate: 86400,
    reason: "Complete public item, map and detail pages may be an hour old (approved trade-off); the Worker still caps degraded HTML at 60 seconds.",
    sources: [
      "/database/items",
      "/database/items/:path*",
      "/map",
      "/map/:path*",
      ...["npcs", "quests", "objects", "vendors", "spells", "achievements", "titles", "factions", "quest-chains", "zones", "instances", "coverage"]
        .map((type) => `/database/${type}/:detail`),
    ],
  },
};

/** @param {CacheRow} row The `CDN-Cache-Control` value a row sends. */
function cdnCacheControl(row) {
  if (row.noStore) return "private, no-store";
  return row.staleWhileRevalidate === undefined
    ? `max-age=${row.maxAge}`
    : `max-age=${row.maxAge}, stale-while-revalidate=${row.staleWhileRevalidate}`;
}

module.exports = { CACHE_POLICY, cdnCacheControl };
