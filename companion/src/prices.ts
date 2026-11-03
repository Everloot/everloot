import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEverlootTable } from "../../web/src/lib/sv-parse";
import { INTERFACE } from "./bridge/answers";
import { adler32, luaString } from "./bridge/lua";

/**
 * Community market prices into the game: the realms in the player's own SavedVariables are fetched from
 * everloot.app/api/market/prices and written into the EverlootPrices slot addon, which the addon's
 * tooltips read after the next /reload. Design: docs/design/specs/2026-10-16-forever-market-design.md
 */

export const PRICES_ADDON = "EverlootPrices";

/** [itemId, market | null, min, historical, quantity, day, reporters], as the site sends them. */
export type PriceRow = [number, number | null, number, number, number, string, number];
export interface RealmPrices { realm: string; dataAsOf: string | null; items: PriceRow[] }

const MAX_REALMS = 20;
const MAX_ROWS = 2000;

/** The addon looks realms up with GetRealmName():lower(); Lua 5.1 lower-cases ASCII letters only. */
const realmKey = (realm: string) => realm.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());

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

/** One realm from the site. A failed request throws: it is never an empty price list. */
export async function fetchRealmPrices(endpoint: string, realm: string, send: typeof fetch = fetch): Promise<RealmPrices> {
  const res = await send(`${endpoint.replace(/\/$/, "")}/api/market/prices?realm=${encodeURIComponent(realm)}`);
  if (!res.ok) throw new Error(`market prices for ${realm}: HTTP ${res.status}`);
  const body = (await res.json()) as { ok?: unknown; realm?: unknown; dataAsOf?: unknown; items?: unknown };
  if (body.ok !== true || !Array.isArray(body.items)) throw new Error(`market prices for ${realm}: unexpected answer`);
  return {
    realm: typeof body.realm === "string" ? body.realm : realm,
    dataAsOf: typeof body.dataAsOf === "string" ? body.dataAsOf : null,
    // The site caps a realm at 2,000 rows; the file never carries more however the answer looks.
    items: body.items.slice(0, MAX_ROWS).map(priceRow).filter((r): r is PriceRow => r !== null),
  };
}

/** [itemId, "n" (NPC) | "o" (object), sourceId, drops, loot windows, installs]: one public drop rate. */
export type DropRow = [number, "n" | "o", number, number, number, number];
/** The public drop rates in the file: when the site's uploads were current, and when the app fetched them. */
export interface DropSources { dataAsOf: string | null; fetchedAt: string; rows: DropRow[] }

/** Rows grouped by item (ascending), each item's sources best rate first, so the addon reads one run per item. */
export function sortDropRows(rows: DropRow[]): DropRow[] {
  return [...rows].sort((a, b) => a[0] - b[0] || b[3] / b[4] - a[3] / a[4] || b[4] - a[4] || a[2] - b[2]);
}

/**
 * The slot addon: per lower-cased realm, one "id,market,min,historical,quantity,day,reporters;..." string and its
 * Adler-32; with `drops`, one "itemId,kind,sourceId,drops,windows,installs;..." string and its Adler-32 beside them.
 */
export function renderPricesAddon(realms: RealmPrices[], drops?: DropSources): { toc: string; lua: string } {
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
    return `  [${luaString(realmKey(r.realm))}] = { ["dataAsOf"] = ${luaString(r.dataAsOf ?? "")}, ` +
      `["data"] = ${luaString(data)}, ["sum"] = ${adler32(data)} },`;
  });
  // `data` comes first in the drops table, so a reader looking for realm tables ({ ["dataAsOf"] = ...) never takes it for one.
  const dropData = drops ? sortDropRows(drops.rows).map((r) => r.join(",")).join(";") : "";
  const close = drops
    ? `}, ["drops"] = { ["data"] = ${luaString(dropData)}, ["sum"] = ${adler32(dropData)}, ` +
      `["dataAsOf"] = ${luaString(drops.dataAsOf ?? "")}, ["fetchedAt"] = ${luaString(drops.fetchedAt)} } }`
    : "} }";
  const lua = [
    "-- Written by the Everloot companion. Do not edit: the next refresh replaces this file.",
    "EverlootPricesDB = { [\"realms\"] = {",
    ...rows,
    close,
    "",
  ].join("\n");
  return { toc, lua };
}

export function writePricesAddon(addonsDir: string, realms: RealmPrices[], drops?: DropSources): void {
  const dir = join(addonsDir, PRICES_ADDON);
  mkdirSync(dir, { recursive: true });
  const { toc, lua } = renderPricesAddon(realms, drops);
  for (const [name, text] of [[`${PRICES_ADDON}.toc`, toc], [`${PRICES_ADDON}.lua`, lua]] as const) {
    writeFileSync(join(dir, `${name}.tmp`), text);
    renameSync(join(dir, `${name}.tmp`), join(dir, name));
  }
}

/** Fetch every realm the files mention and rewrite the slot addon. Any failure keeps the previous file. */
export async function refreshPrices(options: {
  svFiles: string[]; addonsDir: string; endpoint: string; fetch?: typeof fetch;
}): Promise<{ realms: number; items: number }> {
  const names: string[] = [];
  for (const file of options.svFiles) {
    for (const realm of readRealms(readFileSync(file, "utf8"))) {
      if (!names.some((n) => realmKey(n) === realmKey(realm))) names.push(realm);
    }
  }
  const realms: RealmPrices[] = [];
  for (const realm of names.slice(0, MAX_REALMS)) realms.push(await fetchRealmPrices(options.endpoint, realm, options.fetch));
  writePricesAddon(options.addonsDir, realms);
  return { realms: realms.length, items: realms.reduce((n, r) => n + r.items.length, 0) };
}
