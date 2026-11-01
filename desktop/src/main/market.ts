import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchRealmPrices, readRealms, writePricesAddon, type DropRow, type DropSources, type RealmPrices } from "../../../companion/src/prices";
import { validRealm } from "../../../packages/protocol/src/realm";
import type { RealmSummary } from "../shared/types";
import { charactersFromFiles } from "./characters";

/** The companion's cap on realms in one prices file. */
export const MAX_REALMS = 20;

const realmKey = (realm: string) => realm.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());

/** The realms the site has public values for, from `GET /api/market/prices` without a realm. */
export async function listRealms(endpoint: string, send: typeof fetch = fetch): Promise<{ realms: string[]; dataAsOf: string | null }> {
  const res = await send(`${endpoint}/api/market/prices`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`market realms: ${res.status}`);
  const body = (await res.json()) as { ok?: boolean; realms?: unknown; dataAsOf?: unknown };
  if (!body.ok || !Array.isArray(body.realms)) throw new Error("market realms: unexpected answer");
  return { realms: body.realms.filter((r): r is string => typeof r === "string"), dataAsOf: typeof body.dataAsOf === "string" ? body.dataAsOf : null };
}

/**
 * The realms to fetch: the player's own scans first, then the followed ones, no duplicates
 * (case-insensitive), at most MAX_REALMS. Followed realms are what TSM calls realm picks; here
 * they only choose which of Everloot's own public values to carry into the game.
 */
export function mergeRealms(own: string[], followed: string[]): { realm: string; source: "scan" | "followed" }[] {
  const out: { realm: string; source: "scan" | "followed" }[] = [];
  const add = (realm: string, source: "scan" | "followed") => {
    const name = realm.trim();
    if (name.length < 2 || out.some((o) => realmKey(o.realm) === realmKey(name))) return;
    out.push({ realm: name, source });
  };
  for (const r of own) add(r, "scan");
  for (const r of followed) add(r, "followed");
  return out.slice(0, MAX_REALMS);
}

/**
 * Realms of the player's own characters, from the rows the addon writes on each login (GetRealmName()).
 * Read on this computer only, to suggest them on the Market page; nothing is fetched for them unless the
 * player follows them. Only names the site accepts: once followed, one it refuses would fail the whole refresh.
 */
export function characterRealms(svFiles: string[]): string[] {
  const names: string[] = [];
  for (const { realm } of charactersFromFiles(svFiles).characters) {
    if (validRealm(realm) && !names.some((n) => realmKey(n) === realmKey(realm))) names.push(realm.trim());
  }
  return names;
}

/** Character realms to suggest: not scanned, not followed, and not answered (followed or dismissed) before. */
export function suggestedRealms(characters: string[], own: string[], followed: string[], dismissed: string[]): string[] {
  const taken = new Set([...own, ...followed, ...dismissed].map(realmKey));
  return characters.filter((r) => !taken.has(realmKey(r)));
}

/** Realms named in the player's own auction scans across every account file. */
export function ownRealms(svFiles: string[]): string[] {
  const names: string[] = [];
  for (const file of svFiles) {
    let text: string;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    for (const realm of readRealms(text)) if (!names.some((n) => realmKey(n) === realmKey(realm))) names.push(realm);
  }
  return names;
}

/** One item's row from the prices file, as the tooltip reads it. `market` is null when unrecorded. */
export interface PriceRow { realm: string; dataAsOf: string | null; itemId: number; market: number | null; min: number; historical: number; quantity: number; day: string; reporters: number }
export interface PricesFile { realms: { realm: string; dataAsOf: string | null; items: number }[]; rows: Map<string, string> }

/**
 * Reads the EverlootPrices file this app wrote into the game, so the Market page shows what the game
 * shows: each realm's item count and date, and one item's row on request. Read-only; null when absent.
 * The realm key is the lower-case name the file uses.
 */
export function readPricesFile(addonsDir: string): PricesFile | null {
  let text: string;
  try { text = readFileSync(join(addonsDir, "EverlootPrices", "EverlootPrices.lua"), "utf8"); } catch { return null; }
  const realms: PricesFile["realms"] = [];
  const rows = new Map<string, string>();
  for (const m of text.matchAll(/\[\s*"((?:[^"\\]|\\.)*)"\s*\]\s*=\s*\{\s*\["dataAsOf"\]\s*=\s*"([^"]*)",\s*\["data"\]\s*=\s*"([^"]*)"/g)) {
    const [, realm, dataAsOf, data] = m;
    rows.set(realm, `;${data};`);
    realms.push({ realm, dataAsOf: dataAsOf || null, items: data ? data.split(";").length : 0 });
  }
  return { realms, rows };
}

/** One item on every realm in the file, in file order. */
export function priceRows(file: PricesFile, itemId: number): PriceRow[] {
  const out: PriceRow[] = [];
  for (const r of file.realms) {
    const data = file.rows.get(r.realm)!;
    const at = data.indexOf(`;${itemId},`);
    if (at < 0) continue;
    const m = /^(\d+),(\d*),(\d+),(\d+),(\d+),([\d-]+),(\d+);/.exec(data.slice(at + 1));
    if (!m) continue;
    out.push({ realm: r.realm, dataAsOf: r.dataAsOf, itemId, market: m[2] ? Number(m[2]) : null, min: Number(m[3]), historical: Number(m[4]), quantity: Number(m[5]), day: m[6], reporters: Number(m[7]) });
  }
  return out;
}

/** The item id in what the player typed or pasted: a bare id, an item link copied from game chat, or an everloot.app item address. */
export function itemIdFrom(text: string): number | null {
  const t = text.trim();
  const m = /^(\d{1,7})$/.exec(t) ?? /item[:=](\d{1,7})/.exec(t) ?? /\/items\/(\d{1,7})/.exec(t);
  return m ? Number(m[1]) : null;
}

/** The most drop rows the file carries (about 110 KB); past it, the sources with the most loot windows stay. */
export const MAX_DROP_ROWS = 5000;
/** Pages of /api/rollups/drops read in one refresh: with the data guard on, a page is 500 rates for a caller without a key. */
export const MAX_DROP_PAGES = 10;
/** Drop rates move slowly: they are fetched at most once a day, and the hourly price refresh carries them over. */
export const DROPS_EVERY_MS = 24 * 3600_000;

const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

/**
 * The public drop rates from `GET /api/rollups/drops`, following `next` on the same site. Only rates three installs
 * looted (the site sends no others; a row under 3 is dropped here too) with one NPC or object source and at least
 * one loot window. Measured zeros name no item and are not carried. A failed or unreachable answer throws.
 */
export async function fetchDropSources(endpoint: string, send: typeof fetch = fetch, now = new Date()): Promise<DropSources> {
  const site = new URL(endpoint).origin;
  let url: string | null = `${site}/api/rollups/drops`;
  const rows: DropRow[] = [];
  let dataAsOf: string | null = null;
  for (let page = 0; url && page < MAX_DROP_PAGES; page++) {
    const res = await send(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`drop rates: ${res.status}`);
    const body = (await res.json()) as { unreachable?: unknown; rates?: unknown; dataAsOf?: unknown; next?: unknown };
    if (body.unreachable !== false || !Array.isArray(body.rates)) throw new Error("drop rates: unexpected or unreachable answer");
    if (typeof body.dataAsOf === "string" && ISO.test(body.dataAsOf)) dataAsOf = body.dataAsOf;
    for (const raw of body.rates as Record<string, unknown>[]) {
      const npc = raw?.sourceNpcId, object = raw?.sourceObjectId;
      const kind = count(npc) && npc > 0 && object === undefined ? "n" : count(object) && object > 0 && npc === undefined ? "o" : null;
      const source = (kind === "n" ? npc : object) as number;
      if (!kind || !count(raw.itemId) || raw.itemId < 1 || !count(raw.drops) || !count(raw.kills) || !count(raw.reporters)) continue;
      if (raw.kills < 1 || raw.drops > raw.kills || raw.reporters < 3) continue;
      rows.push([raw.itemId, kind, source, raw.drops, raw.kills, raw.reporters]);
    }
    const next: unknown = body.next;
    url = typeof next === "string" && next.startsWith(`${site}/api/rollups/drops?`) ? next : null;
  }
  rows.sort((a, b) => b[4] - a[4]);
  return { dataAsOf, fetchedAt: now.toISOString(), rows: rows.slice(0, MAX_DROP_ROWS) };
}

/** The drops block of the file this app last wrote, to carry over between daily fetches; null when absent. */
export function readDropsBlock(addonsDir: string): DropSources | null {
  let text: string;
  try { text = readFileSync(join(addonsDir, "EverlootPrices", "EverlootPrices.lua"), "utf8"); } catch { return null; }
  const m = /\["drops"\] = \{ \["data"\] = "([\w,;]*)", \["sum"\] = \d+, \["dataAsOf"\] = "([^"\\]*)", \["fetchedAt"\] = "([^"\\]*)" \}/.exec(text);
  if (!m) return null;
  const rows = m[1] ? m[1].split(";").map((r) => {
    const [item, kind, source, drops, kills, reporters] = r.split(",");
    return [Number(item), kind as "n" | "o", Number(source), Number(drops), Number(kills), Number(reporters)] as DropRow;
  }) : [];
  return { dataAsOf: m[2] || null, fetchedAt: m[3], rows };
}

/**
 * Fetches every chosen realm and rewrites the EverlootPrices slot addon. Any price failure keeps the previous file.
 * Drop rates are refetched once a day; between fetches, or when the drop fetch fails, the last good block is kept.
 */
export async function refreshMarket(options: {
  svFiles: string[]; followed: string[]; addonsDir: string; endpoint: string; send?: typeof fetch; now?: Date;
}): Promise<{ realms: RealmSummary[]; items: number; drops: number }> {
  const now = options.now ?? new Date();
  const chosen = mergeRealms(ownRealms(options.svFiles), options.followed);
  // Independent GETs to the same site; together they take one round trip, not one per realm (at most 20).
  const fetched: RealmPrices[] = await Promise.all(chosen.map(({ realm }) => fetchRealmPrices(options.endpoint, realm, options.send)));
  const summaries: RealmSummary[] = fetched.map((prices, i) => ({ realm: prices.realm, items: prices.items.length, dataAsOf: prices.dataAsOf, source: chosen[i].source }));
  let drops = readDropsBlock(options.addonsDir);
  const age = drops ? now.getTime() - Date.parse(drops.fetchedAt) : Infinity;
  if (!(age >= 0 && age < DROPS_EVERY_MS)) {
    try { drops = await fetchDropSources(options.endpoint, options.send, now); } catch { /* keep the last good block, or none */ }
  }
  writePricesAddon(options.addonsDir, fetched, drops ?? undefined);
  return { realms: summaries, items: summaries.reduce((n, r) => n + r.items, 0), drops: drops?.rows.length ?? 0 };
}
