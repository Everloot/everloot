import type { Region, RulesetSlug } from "@/data/realms";

/**
 * AH Ledger (ahledger.com) prices, read live from its public API and never stored. Its terms
 * (ahledger.com/developers, read 2026-11-15) let community tools given to players without charge use the API with a
 * free key and a credit link; a site earning from the data through ads needs a licence, so this holds only while
 * Everloot shows no ads. Answers may be kept no longer than their Cache-Control allows, so the proxy route
 * (app/api/ahledger) passes that lifetime on and keeps nothing else. The prices reach pages only, read in the browser
 * or, for the profession pages' crafting margins, at render on the server (ahledger-proxy.ts `readAhledgerPage`). That
 * read is shared by the market's sorts, filters and pages in the Worker's Cache API for as long as AH Ledger's
 * Cache-Control allows, at most 2 minutes, and the page the edge keeps 3 minutes with no stale copy, so a price on
 * screen is never older than AH Ledger's max-age of 5 minutes: never the
 * database, the MCP server, Chat, the API's own data or the open-data exports (ahledger.test.ts).
 */

export const AHLEDGER_API = "https://api.ahledger.com";
export const AHLEDGER_SITE = "https://ahledger.com";

export type AhledgerFaction = "alliance" | "horde";
type AhledgerRuleset = "normal" | "pvp" | "rp" | "rppvp";
type AhledgerRegion = "us" | "eu" | "kr" | "cn";

/** Our ruleset slugs to AH Ledger's. Hardcore and the pre-launch "forever" view have no AH Ledger market. */
const RULESETS: Partial<Record<RulesetSlug, AhledgerRuleset>> = { normal: "normal", pvp: "pvp", rp: "rp", "rp-pvp": "rppvp" };
/** AH Ledger's kr markets also hold the Taiwanese realms. */
const REGIONS: Record<Region, AhledgerRegion> = { us: "us", eu: "eu", kr: "kr", tw: "kr" };

const MARKET = /^forever\.(normal|pvp|rp|rppvp)\.(alliance|horde)\.(us|eu|kr|cn)$/;

/** "forever.rppvp.horde.eu" for an RP-PvP Horde house in Europe, or null where AH Ledger has no market. */
export function ahledgerMarket(ruleset: RulesetSlug | string, faction: AhledgerFaction, region: Region): string | null {
  const r = RULESETS[ruleset as RulesetSlug];
  return r ? `forever.${r}.${faction}.${REGIONS[region]}` : null;
}

export function isAhledgerMarket(id: string): boolean {
  return MARKET.test(id);
}

const RULESET_LABEL: Record<AhledgerRuleset, string> = { normal: "PvE", pvp: "PvP", rp: "RP", rppvp: "RP-PvP" };

/** "RP-PvP Horde", the words the auction pages use for a ruleset, with the faction. */
export function ahledgerMarketLabel(id: string): string {
  const m = MARKET.exec(id);
  if (!m) return id;
  return `${RULESET_LABEL[m[1] as AhledgerRuleset]} ${m[2] === "alliance" ? "Alliance" : "Horde"}`;
}

/** Both factions' markets for a ruleset and region, Alliance first; empty where AH Ledger has none. */
export function ahledgerMarkets(ruleset: RulesetSlug | string, region: Region): string[] {
  return (["alliance", "horde"] as const).map((f) => ahledgerMarket(ruleset, f, region)).filter((m): m is string => m !== null);
}

/** Every market in a region, in the order the auction pages list rulesets. */
export function ahledgerRegionMarkets(region: Region): string[] {
  return (["normal", "pvp", "rp", "rp-pvp"] as const).flatMap((r) => ahledgerMarkets(r, region));
}

/** AH Ledger's own page for the item on that market; it redirects to the page's full address. */
export function ahledgerItemUrl(itemId: number, market: string): string {
  return `${AHLEDGER_SITE}/items/${itemId}/${market}`;
}

/** One item on one market, as the proxy route answers it: copper amounts, null where AH Ledger has none. */
export interface AhledgerPrice {
  itemId: number;
  minBuyout: number | null;
  median: number | null;
  quantity: number | null;
  salesPerDay: number | null;
  observedAt: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The fields Everloot shows from a `/v1/tooltip/{market}` answer; anything else in it is dropped. */
export function tooltipPrices(body: unknown): AhledgerPrice[] {
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((raw) => {
    const it = raw as Record<string, unknown>;
    const itemId = num(it.id);
    if (itemId === null) return [];
    return [{
      itemId,
      minBuyout: num(it.minBuyout),
      median: num(it.median),
      quantity: num(it.quantity),
      salesPerDay: num(it.salesPerDay),
      observedAt: typeof it.observedAt === "string" ? it.observedAt : null,
    }];
  });
}

export const MAX_ITEMS = 100;

/** The lifetimes in AH Ledger's Cache-Control: what a browser may keep, and what a shared cache may (s-maxage). */
export function lifetimes(header: string | null): { browser: number; shared: number } | null {
  const h = (header ?? "").toLowerCase();
  if (!h.includes("public") || /\b(private|no-store|no-cache)\b/.test(h)) return null;
  const age = (name: string) => {
    const m = new RegExp(`(?:^|[\\s,])${name}=(\\d+)`).exec(h);
    return m ? Number(m[1]) : null;
  };
  const browser = age("max-age");
  if (browser === null) return null;
  return { browser, shared: age("s-maxage") ?? browser };
}

/** "2589,2592" to [2589, 2592]: positive whole numbers, no repeats, at most MAX_ITEMS; null otherwise. */
export function itemsParam(raw: string | null): number[] | null {
  if (!raw) return null;
  const parts = raw.split(",");
  if (parts.length > MAX_ITEMS || !parts.every((p) => /^[1-9]\d{0,9}$/.test(p))) return null;
  const ids = [...new Set(parts.map(Number))];
  return ids.length === parts.length ? ids : null;
}

export interface AhledgerCredit { text: string; url: string }

/** Never trust attribution HTML or an off-site credit URL. */
export function ahledgerCredit(body: unknown): AhledgerCredit {
  let url = AHLEDGER_SITE;
  try {
    const candidate = new URL(String(record(record(body).attribution).url));
    if (candidate.protocol === "https:" && candidate.hostname === "ahledger.com" && !candidate.port && !candidate.username && !candidate.password) url = candidate.href;
  } catch { /* Missing or malformed attribution uses the site's home page. */ }
  return { text: "Prices from AHledger", url };
}

/** Browser and edge lifetimes stay separate, including private history answers. */
export function upstreamCacheHeaders(header: string | null): Record<string, string> {
  const h = (header ?? "").toLowerCase();
  const age = /(?:^|[\s,])max-age=(\d+)(?=\s|,|$)/.exec(h)?.[1];
  if (!age || /\b(no-store|no-cache)\b/.test(h)) return { "Cache-Control": "no-store" };
  if (/\bprivate\b/.test(h)) return { "Cache-Control": `private, max-age=${age}` };
  const life = lifetimes(header);
  if (!life) return { "Cache-Control": "no-store" };
  const shared = /(?:^|[\s,])s-maxage=(\d+)(?=\s|,|$)/.exec(h)?.[1];
  return { "Cache-Control": `public, max-age=${life.browser}`, ...(shared ? { "CDN-Cache-Control": `max-age=${shared}` } : {}) };
}

export const AHLEDGER_PROFESSIONS = ["Alchemy", "Blacksmithing", "Cooking", "Enchanting", "Engineering", "First Aid", "Herbalism", "Leatherworking", "Mining", "Skinning", "Tailoring"] as const;
export const isAhledgerProfession = (name: string): boolean => AHLEDGER_PROFESSIONS.some((p) => p === name);

const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" ? v as Record<string, unknown> : {};
const text = (v: unknown): string | null => typeof v === "string" ? v : null;
const id = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
const date = (v: unknown): string | null => typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
const rows = (body: unknown, key: string): unknown[] => {
  const value = record(body)[key];
  if (!Array.isArray(value) || record(body).notice || record(body).error) throw new Error("AH Ledger response could not be read.");
  return value;
};

export interface AhledgerPoint { t: string; min: number | null; median: number | null; p25: number | null; p75: number | null }
export interface AhledgerHistory { median7d: number | null; median30d: number | null; salesPerDay: number | null; windowDays: number | null; series: AhledgerPoint[] }

export function priceHistory(body: unknown): AhledgerHistory {
  const latest = record(record(body).latest), sales = record(record(body).sales);
  const series = rows(body, "series").flatMap((raw) => {
    const p = record(raw), t = date(p.t);
    return t ? [{ t, min: num(p.min), median: num(p.median), p25: num(p.p25), p75: num(p.p75) }] : [];
  }).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  return { median7d: num(latest.median7d), median30d: num(latest.median30d), salesPerDay: num(sales.estimatedPerDay), windowDays: num(sales.windowDays), series };
}

/** Estimated sales a day, to one decimal; "unrecorded" when AH Ledger has too few scans for one. */
export const salesText = (n: number | null) => n === null ? "unrecorded" : n.toLocaleString("en-US", { maximumFractionDigits: 1 });

export interface AhledgerCraft { spellId: number; name: string; skill: number | null; cost: number | null; netValue: number | null; margin: number | null; salesPerDay: number | null; profitPerDay: number | null }
export function craftingMargins(body: unknown): AhledgerCraft[] {
  return rows(body, "recipes").flatMap((raw) => {
    const r = record(raw), recipe = record(r.recipe), spellId = id(recipe.spellId);
    return spellId === null ? [] : [{ spellId, name: text(recipe.name) ?? `Spell ${spellId}`, skill: num(recipe.skillRequired), cost: num(r.cost), netValue: num(r.netValue), margin: num(r.margin), salesPerDay: num(r.resultSalesPerDay), profitPerDay: num(r.profitPerDay) }];
  }).sort((a, b) => (b.profitPerDay ?? -Infinity) - (a.profitPerDay ?? -Infinity));
}

/** When AH Ledger's crafting prices were scanned (`pricesAsOf`), or null when the answer gives no date. */
export const craftingAsOf = (body: unknown): string | null => date(record(body).pricesAsOf);

export interface AhledgerDeal { itemId: number; name: string; minBuyout: number | null; referenceMedian: number | null; basis: string | null; quantity: number | null; saving: number | null }
export function dealPrices(body: unknown): AhledgerDeal[] {
  return rows(body, "deals").flatMap((raw) => {
    const r = record(raw), item = record(r.item), itemId = id(item.id);
    return itemId === null ? [] : [{ itemId, name: text(item.name) ?? `Item ${itemId}`, minBuyout: num(r.minBuyout), referenceMedian: num(r.referenceMedian), basis: ["7d", "30d", "scan"].includes(String(r.basis)) ? String(r.basis) : null, quantity: num(r.quantity), saving: num(r.saving) }];
  }).sort((a, b) => (b.saving ?? -Infinity) - (a.saving ?? -Infinity)).slice(0, 20);
}

export interface AhledgerEconomy { market: string; current: number | null; weekAgo: number | null }
export function economyMarkets(body: unknown): AhledgerEconomy[] {
  return rows(body, "markets").flatMap((raw) => {
    const r = record(raw);
    return typeof r.market === "string" && isAhledgerMarket(r.market) ? [{ market: r.market, current: num(record(r.current).value), weekAgo: num(record(r.weekAgo).value) }] : [];
  });
}
