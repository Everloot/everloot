import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEverlootTable } from "../../web/src/lib/sv-parse";
import { INTERFACE } from "./bridge/answers";
import { adler32, luaString } from "./bridge/lua";

/**
 * Community market prices into the game: the realms in the player's own SavedVariables are fetched from
 * everloot.app/api/market/prices, one request per auction house, and written into the EverlootPrices slot addon,
 * which the addon's tooltips read after the next /reload. Each auction house of a realm is its own market, so the
 * file keys every block by realm and house ("forever|horde"); it never holds a realm-only price.
 * Design: docs/design/specs/2026-10-16-forever-market-design.md
 */

export const PRICES_ADDON = "EverlootPrices";

/** [itemId, market | null, min, historical, quantity, day, reporters], as the site sends them. */
export type PriceRow = [number, number | null, number, number, number, string, number];
/** The auction houses a realm's prices come from; each is its own market (kb/src/market.ts). */
export type House = "Alliance" | "Horde" | "Neutral";
/** Both faction houses are fetched for every realm, so each of the player's characters finds its own house's prices. */
export const FACTION_HOUSES: readonly House[] = ["Alliance", "Horde"];
export interface RealmPrices { realm: string; house: House; dataAsOf: string | null; items: PriceRow[] }

const MAX_REALMS = 20;
const MAX_ROWS = 2000;

/** The addon looks realms up with GetRealmName():lower(); Lua 5.1 lower-cases ASCII letters only. */
const realmKey = (realm: string) => realm.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
/** One house of one realm in the file: "forever|horde", as kb/src/market.ts keys it and the addon looks it up. */
export const priceKey = (realm: string, house: House) => `${realmKey(realm)}|${house.toLowerCase()}`;

/** Record kinds whose realm is auction data the player chose to scan or upload; no other kind names a realm to the site. */
const AUCTION_KINDS = ["auction_snapshot", "auction_scan", "price_seen"];

/** Realm names from the player's own auction scans: `lastScans`, then auction records. Guild, gold and other realms are never sent. */
export function readRealms(savedVariables: string): string[] {
  return realmsIn(parseEverlootTable(savedVariables));
}

/** As readRealms, from a table already parsed. */
export function realmsIn(db: Record<string, unknown>): string[] {
  const names: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const name = value.trim();
    if (name.length >= 2 && name.length <= 60 && !names.some((n) => realmKey(n) === realmKey(name))) names.push(name);
  };
  if (db.lastScans && typeof db.lastScans === "object") Object.keys(db.lastScans).forEach(add);
  const records = db.records && typeof db.records === "object" ? (db.records as Record<string, unknown>) : {};
  for (const kind of AUCTION_KINDS) {
    const rows = records[kind];
    if (Array.isArray(rows)) for (const row of rows) add((row as { realm?: unknown })?.realm);
  }
  return names.slice(0, MAX_REALMS);
}

/** Realms (lower-cased) where the player's own auction records name the neutral house: those also get its prices. */
export function neutralRealmsIn(db: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const records = db.records && typeof db.records === "object" ? (db.records as Record<string, unknown>) : {};
  for (const kind of AUCTION_KINDS) {
    const rows = records[kind];
    if (!Array.isArray(rows)) continue;
    for (const row of rows as { realm?: unknown; house?: unknown }[]) {
      if (row?.house === "Neutral" && typeof row.realm === "string") out.add(realmKey(row.realm));
    }
  }
  return out;
}

/** The houses fetched for a realm: both faction houses, and the neutral one when the player's scans named it. */
export function housesFor(realm: string, neutral: ReadonlySet<string>): House[] {
  return neutral.has(realmKey(realm)) ? [...FACTION_HOUSES, "Neutral"] : [...FACTION_HOUSES];
}

const copper = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

function priceRow(raw: unknown): PriceRow | null {
  if (!Array.isArray(raw) || raw.length !== 7) return null;
  const [itemId, market, min, historical, quantity, day, reporters] = raw as unknown[];
  if (!Number.isSafeInteger(itemId) || (itemId as number) < 1) return null;
  if (market !== null && !copper(market)) return null;
  if (![min, historical, quantity, reporters].every(copper)) return null;
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return raw as PriceRow;
}

/**
 * One house of one realm from the site. A failed request throws: it is never an empty price list. An answer that
 * does not name the house asked for is refused, so a realm-wide answer can never be written as a house's prices.
 */
export async function fetchRealmPrices(endpoint: string, realm: string, house: House, send: typeof fetch = fetch): Promise<RealmPrices> {
  const where = `${realm} (${house})`;
  const res = await send(`${endpoint.replace(/\/$/, "")}/api/market/prices?realm=${encodeURIComponent(realm)}&house=${house.toLowerCase()}`);
  if (!res.ok) throw new Error(`market prices for ${where}: HTTP ${res.status}`);
  const body = (await res.json()) as { ok?: unknown; realm?: unknown; house?: unknown; dataAsOf?: unknown; items?: unknown };
  if (body.ok !== true || !Array.isArray(body.items) || body.house !== house) throw new Error(`market prices for ${where}: unexpected answer`);
  return {
    realm: typeof body.realm === "string" ? body.realm : realm,
    house,
    dataAsOf: typeof body.dataAsOf === "string" ? body.dataAsOf : null,
    // The site caps a realm at 2,000 rows; the file never carries more however the answer looks.
    items: body.items.slice(0, MAX_ROWS).map(priceRow).filter((r): r is PriceRow => r !== null),
  };
}

/** [itemId, "n" (NPC) | "o" (object), sourceId, drops, loot windows, installs]: one public drop rate. */
export type DropRow = [number, "n" | "o", number, number, number, number];
/**
 * The public drop rates in the file: when the site's uploads were current, and when the app fetched them. `names`
 * holds the sources' names the site knows, keyed "n<npcId>" or "o<objectId>".
 */
export interface DropSources { dataAsOf: string | null; fetchedAt: string; rows: DropRow[]; names?: Record<string, string> }

/** A source's name as one line of the names block: control characters become spaces, at most 100 characters. */
function nameLine(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 100);
}

/** "n116=Defias Bandit\no1731=Copper Vein": a name for each key in `keys` that has one, in key order. */
function namesBlock(keys: Set<string>, names: Record<string, string> | undefined): string {
  return Object.entries(names ?? {})
    .filter(([key]) => keys.has(key))
    .map(([key, name]) => [key, nameLine(name)] as const)
    .filter(([, name]) => name)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, name]) => `${key}=${name}`)
    .join("\n");
}

/** The names block of the drops table: a name for each source in the rows that has one. */
export function dropNames(drops: DropSources): string {
  return namesBlock(new Set(drops.rows.map((r) => `${r[1]}${r[2]}`)), drops.names);
}

/** [itemId, vendor NPC ids, reagent-of count]: the public sources of one item, from the site's rollups. */
export type SourceRow = [number, number[], number];
/**
 * The public item sources in the file, beside the drops: the NPCs that sell an item and the number of recipes it is
 * a basic reagent of, each public by the site's three-installs rule. `names` holds the vendors' names, keyed "n<npcId>".
 */
export interface ItemSources { dataAsOf: string | null; fetchedAt: string; rows: SourceRow[]; names?: Record<string, string> }

/** One row per item, items ascending, each row's vendors ascending and once; a second row for an item is dropped. */
export function sortSourceRows(rows: SourceRow[]): SourceRow[] {
  const seen = new Set<number>();
  return [...rows].sort((a, b) => a[0] - b[0])
    .filter((r) => (seen.has(r[0]) ? false : (seen.add(r[0]), true)))
    .map((r) => [r[0], [...new Set(r[1])].sort((a, b) => a - b), r[2]] as SourceRow);
}

/** The names block of the sources table: a name for each vendor in the rows the file keeps that has one. */
export function sourceNames(sources: ItemSources): string {
  return namesBlock(new Set(sortSourceRows(sources.rows).flatMap((r) => r[1].map((id) => `n${id}`))), sources.names);
}

/** Rows grouped by item (ascending), each item's sources best rate first, so the addon reads one run per item. */
export function sortDropRows(rows: DropRow[]): DropRow[] {
  return [...rows].sort((a, b) => a[0] - b[0] || b[3] / b[4] - a[3] / a[4] || b[4] - a[4] || a[2] - b[2]);
}

/** A checksummed block of the file. `data` comes first, so a reader looking for realm tables never takes it for one. */
function block(key: string, data: string, dates: { dataAsOf: string | null; fetchedAt: string }, names: string): string {
  // Names come last, outside the checksummed data, so addons that predate them read the rows as before.
  return `["${key}"] = { ["data"] = ${luaString(data)}, ["sum"] = ${adler32(data)}, ` +
    `["dataAsOf"] = ${luaString(dates.dataAsOf ?? "")}, ["fetchedAt"] = ${luaString(dates.fetchedAt)}` +
    `${names ? `, ["names"] = ${luaString(names)}` : ""} }`;
}

/**
 * The slot addon: per house of each realm, keyed "realm|house" in lower case, one
 * "id,market,min,historical,quantity,day,reporters;..." string and its Adler-32. An addon from before houses finds no
 * realm-only key and shows no community price rather than another house's. With `drops`, one
 * "itemId,kind,sourceId,drops,windows,installs;..." string and its Adler-32 beside them;
 * with `sources`, one "itemId,npcId/npcId,reagentOf;..." string and its Adler-32 after the drops. Each block is
 * optional: an addon reading a file without one shows what it showed before the block existed.
 */
export function renderPricesAddon(realms: RealmPrices[], drops?: DropSources, sources?: ItemSources): { toc: string; lua: string } {
  const toc = [
    `## Interface: ${INTERFACE}`,
    "## Title: Everloot Prices",
    "## Notes: Written by the Everloot companion. Community auction prices, shown in tooltips after /reload.",
    "## Author: Everloot",
    "",
    `${PRICES_ADDON}.lua`,
    "",
  ].join("\n");
  const rows = realms.map((r) => {
    const data = r.items.map((i) => [i[0], i[1] ?? "", i[2], i[3], i[4], i[5], i[6]].join(",")).join(";");
    return `  [${luaString(priceKey(r.realm, r.house))}] = { ["dataAsOf"] = ${luaString(r.dataAsOf ?? "")}, ` +
      `["data"] = ${luaString(data)}, ["sum"] = ${adler32(data)} },`;
  });
  const blocks: string[] = [];
  if (drops) blocks.push(block("drops", sortDropRows(drops.rows).map((r) => r.join(",")).join(";"), drops, dropNames(drops)));
  if (sources) {
    const data = sortSourceRows(sources.rows).map((r) => `${r[0]},${r[1].join("/")},${r[2]}`).join(";");
    blocks.push(block("sources", data, sources, sourceNames(sources)));
  }
  const close = blocks.length ? `}, ${blocks.join(", ")} }` : "} }";
  const lua = [
    "-- Written by the Everloot companion. Do not edit: the next refresh replaces this file.",
    "EverlootPricesDB = { [\"realms\"] = {",
    ...rows,
    close,
    "",
  ].join("\n");
  return { toc, lua };
}

export function writePricesAddon(addonsDir: string, realms: RealmPrices[], drops?: DropSources, sources?: ItemSources): void {
  const dir = join(addonsDir, PRICES_ADDON);
  mkdirSync(dir, { recursive: true });
  const { toc, lua } = renderPricesAddon(realms, drops, sources);
  for (const [name, text] of [[`${PRICES_ADDON}.toc`, toc], [`${PRICES_ADDON}.lua`, lua]] as const) {
    writeFileSync(join(dir, `${name}.tmp`), text);
    renameSync(join(dir, `${name}.tmp`), join(dir, name));
  }
}

/** Fetch every house of every realm the files mention and rewrite the slot addon. Any failure keeps the previous file. */
export async function refreshPrices(options: {
  svFiles: string[]; addonsDir: string; endpoint: string; fetch?: typeof fetch;
}): Promise<{ realms: number; items: number }> {
  const names: string[] = [];
  const neutral = new Set<string>();
  for (const file of options.svFiles) {
    const db = parseEverlootTable(readFileSync(file, "utf8"));
    for (const realm of realmsIn(db)) {
      if (!names.some((n) => realmKey(n) === realmKey(realm))) names.push(realm);
    }
    for (const key of neutralRealmsIn(db)) neutral.add(key);
  }
  const chosen = names.slice(0, MAX_REALMS);
  const houses: RealmPrices[] = [];
  for (const realm of chosen) {
    for (const house of housesFor(realm, neutral)) houses.push(await fetchRealmPrices(options.endpoint, realm, house, options.fetch));
  }
  writePricesAddon(options.addonsDir, houses);
  return { realms: chosen.length, items: houses.reduce((n, r) => n + r.items.length, 0) };
}
