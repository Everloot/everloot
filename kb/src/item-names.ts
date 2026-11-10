/**
 * The item name ledger: every name a source has given for an item id, kept as sources, builds and dumps
 * arrive, and never pruned. A later run adds what it read beside what earlier runs read; nothing is deleted
 * or overwritten, so a name a new build drops, or a wiki page that disagrees, stays on record.
 *
 * Sources, read here:
 * - The game files: `ItemSparse.Display_lang` and `OverallQualityID` of one build's snapshot.
 * - The Warcraft Wiki dump of 2023-11-13 (CC BY-SA 4.0), already in the knowledge base: the item id and
 *   name in each item page's infobox (`#data:itemtip`, `itembox`, `Infobox item`).
 * Players' names (3 installs, kb/src/item-page.ts) are not stored here: the site reads them live and they
 * come first.
 *
 * The ledger holds every item name in the build, released or not, so it stays on the maintainer's machine
 * like the snapshot. What the site shows is written to a separate, smaller file for the private bucket: every
 * item of the build a source names, the game file name first, with the wiki page where the wiki agrees
 * (docs/DATA_POLICY.md, "Item names from the game files and the Warcraft Wiki"). It never goes to the API, the
 * MCP server or the bulk download.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readClientMeta, readClientRows } from "./client-snapshot.js";
import { mayShowName } from "./item-name-rule.js";
import type { TableReader } from "./talents/build-catalog.js";

export const LEDGER_SCHEMA = "everloot.item-name-ledger/1";
export const SHOWN_SCHEMA = "everloot.item-names/1";
export const WIKI_SOURCE_ID = "warcraft-wiki-2023";

export interface FileName { build: string; name: string; quality: number }
export interface WikiName { dump: string; name: string; page: string }
export interface LedgerEntry { files: FileName[]; wiki: WikiName[] }
export interface LedgerRun { at: string; build: string; wikiDump: string | null; added: { files: number; wiki: number } }
export interface Ledger { schema: typeof LEDGER_SCHEMA; runs: LedgerRun[]; items: Record<string, LedgerEntry> }

/** match: game files and wiki agree. mismatch: both name it, differently. files, wiki: one source only. none: no name. */
export type Tier = "match" | "mismatch" | "files" | "wiki" | "none";
export const TIERS: Tier[] = ["match", "mismatch", "files", "wiki", "none"];

/** The file the site reads: the shown names, with what each row needs. */
export interface ShownNames {
  schema: typeof SHOWN_SCHEMA;
  build: { version: string };
  wiki: { name: string; url: string; licence: string };
  count: number;
  /**
   * By item id: the name, its quality (absent for a name only the wiki gives), and the wiki page (after
   * WIKI_PAGE_PREFIX) where the wiki gives this name. No `w`: the name is the game files' alone, unconfirmed.
   */
  names: Record<string, { n: string; q?: number; w?: string }>;
}

/** Two names agree when they differ only in case, spacing or the kind of apostrophe. */
export { normName } from "./name-normalization.js";
import { normName } from "./name-normalization.js";

export const emptyLedger = (): Ledger => ({ schema: LEDGER_SCHEMA, runs: [], items: {} });

/** The tier of one item for a build: its game file name in that build against every wiki name on record. */
export function tierOf(entry: LedgerEntry | undefined, build: string): { tier: Tier; file?: FileName; wiki?: WikiName } {
  const file = entry?.files.filter((f) => f.build === build).at(-1);
  const wiki = entry?.wiki ?? [];
  if (file && wiki.length) {
    const same = wiki.find((w) => normName(w.name) === normName(file.name));
    return same ? { tier: "match", file, wiki: same } : { tier: "mismatch", file, wiki: wiki[0] };
  }
  if (file) return { tier: "files", file };
  if (wiki.length) return { tier: "wiki", wiki: wiki[0] };
  return { tier: "none" };
}

/**
 * Adds one run's readings to the ledger and returns the new ledger; the old one is not changed. A reading
 * already on record (same build and name, or same dump, name and page) is not added twice. Nothing is removed.
 */
export function mergeLedger(
  ledger: Ledger,
  run: { at: string; build: string; files: ReadonlyMap<number, { name: string; quality: number }>; wikiDump: string | null; wiki: ReadonlyMap<number, { name: string; page: string }[]> },
): Ledger {
  const items: Record<string, LedgerEntry> = {};
  for (const [id, e] of Object.entries(ledger.items)) items[id] = { files: [...e.files], wiki: [...e.wiki] };
  const entry = (id: number) => (items[String(id)] ??= { files: [], wiki: [] });
  let files = 0, wiki = 0;
  for (const [id, f] of run.files) {
    const e = entry(id);
    if (e.files.some((x) => x.build === run.build && x.name === f.name && x.quality === f.quality)) continue;
    e.files.push({ build: run.build, name: f.name, quality: f.quality });
    files += 1;
  }
  if (run.wikiDump) {
    for (const [id, pages] of run.wiki) {
      const e = entry(id);
      for (const p of pages) {
        if (e.wiki.some((x) => x.dump === run.wikiDump && x.name === p.name && x.page === p.page)) continue;
        e.wiki.push({ dump: run.wikiDump, name: p.name, page: p.page });
        wiki += 1;
      }
    }
  }
  const sorted = Object.fromEntries(Object.entries(items).sort(([a], [b]) => Number(a) - Number(b)));
  return { schema: LEDGER_SCHEMA, runs: [...ledger.runs, { at: run.at, build: run.build, wikiDump: run.wikiDump, added: { files, wiki } }], items: sorted };
}

/** Reads a ledger file's JSON; refuses anything that is not one, so a wrong file is never written over. */
export function parseLedger(json: unknown): Ledger {
  const l = json as Partial<Ledger> | null;
  if (!l || l.schema !== LEDGER_SCHEMA || !Array.isArray(l.runs) || typeof l.items !== "object" || l.items === null) {
    throw new Error(`not an item name ledger (schema ${LEDGER_SCHEMA})`);
  }
  return l as Ledger;
}

/** How many of `ids` fall in each tier for the build, and the mismatches (id, game file name, wiki names). */
export function coverage(ledger: Ledger, build: string, ids: Iterable<number>) {
  const counts = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  const mismatches: { id: number; files: string; wiki: string[] }[] = [];
  for (const id of ids) {
    const entry = ledger.items[String(id)];
    const { tier, file } = tierOf(entry, build);
    counts[tier] += 1;
    if (tier === "mismatch") mismatches.push({ id, files: file!.name, wiki: [...new Set(entry!.wiki.map((w) => w.name))] });
  }
  return { counts, shownCount: counts.match + counts.mismatch + counts.files + counts.wiki, mismatches };
}

/**
 * The names the site shows for a build, for ids in `ids` (the build's items): the game file name wherever the
 * build has one, with its wiki page when the wiki agrees (a mismatch shows the game files' name, as this build
 * has it); else the wiki's name, with its page. An item neither names is left out and reads "Item N".
 */
export function shownNames(ledger: Ledger, build: string, ids: Iterable<number>, wiki: ShownNames["wiki"]): ShownNames {
  const names: ShownNames["names"] = {};
  const page = (w: WikiName) => w.page.slice(WIKI_PAGE_PREFIX.length);
  for (const id of [...ids].sort((a, b) => a - b)) {
    const t = tierOf(ledger.items[String(id)], build);
    if (t.tier === "match" && mayShowName(id, t.file!.name)) names[String(id)] = { n: t.file!.name, q: t.file!.quality, w: page(t.wiki!) };
    else if ((t.tier === "mismatch" || t.tier === "files") && mayShowName(id, t.file!.name)) names[String(id)] = { n: t.file!.name, q: t.file!.quality };
    else if (t.tier === "wiki" && mayShowName(id, t.wiki!.name)) names[String(id)] = { n: t.wiki!.name, w: page(t.wiki!) };
  }
  return { schema: SHOWN_SCHEMA, build: { version: build }, wiki, count: Object.keys(names).length, names };
}

/** Every named row of ItemSparse in the snapshot: id -> name and quality. */
export function fileNames(get: TableReader): Map<number, { name: string; quality: number }> {
  const sparse = get("ItemSparse");
  if (!sparse) throw new Error("the snapshot has no ItemSparse table; run `client-extract --refresh` first");
  const out = new Map<number, { name: string; quality: number }>();
  for (const row of sparse.values()) {
    const id = typeof row.ID === "number" ? row.ID : 0;
    const name = typeof row.Display_lang === "string" ? row.Display_lang.trim() : "";
    if (id > 0 && name) out.set(id, { name, quality: typeof row.OverallQualityID === "number" ? row.OverallQualityID : 0 });
  }
  return out;
}

/** A wiki page URL the site may link to: an article on warcraft.wiki.gg. */
export const WIKI_PAGE_PREFIX = "https://warcraft.wiki.gg/wiki/";
export const isWikiPage = (url: string) => url.startsWith(WIKI_PAGE_PREFIX) && /^[^\s"<>]+$/.test(url.slice(WIKI_PAGE_PREFIX.length));

/** Item ids an infobox field gives: one id, or a plain list ("1234, 1235"). Anything else gives none. */
export function infoboxItemIds(value: string | undefined): number[] {
  const v = value?.trim() ?? "";
  if (!/^\d+(\s*[,;/]\s*\d+)*$/.test(v)) return [];
  return v.split(/\s*[,;/]\s*/).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
}

/** The wiki's item names by item id, from the item infoboxes in a knowledge base file, with the dump's date. */
export function wikiNames(kbPath: string): { dump: string; wiki: ShownNames["wiki"]; names: Map<number, { name: string; page: string }[]> } {
  const db = new Database(kbPath, { readonly: true, fileMustExist: true });
  try {
    const source = db.prepare("SELECT name, licence, homepage FROM sources WHERE id = ?").get(WIKI_SOURCE_ID) as { name: string; licence: string; homepage: string } | undefined;
    if (!source) throw new Error(`the knowledge base has no ${WIKI_SOURCE_ID} source`);
    if (source.licence !== "CC-BY-SA-4.0") throw new Error(`${WIKI_SOURCE_ID} is ${source.licence}, not CC-BY-SA-4.0; its names cannot be shown`);
    const dates = db.prepare("SELECT DISTINCT retrieved_at AS d FROM entities WHERE source_id = ?").all(WIKI_SOURCE_ID) as { d: string }[];
    if (dates.length !== 1) throw new Error(`expected one dump date for ${WIKI_SOURCE_ID}, found ${dates.length}`);
    const names = new Map<number, { name: string; page: string }[]>();
    const rows = db.prepare("SELECT name, data, source_url AS url FROM entities WHERE source_id = ? AND kind = 'lore_page' AND data LIKE '%\"itemid\"%'").iterate(WIKI_SOURCE_ID) as Iterable<{ name: string; data: string; url: string }>;
    for (const r of rows) {
      let data: { type?: string; infobox?: { fields?: Record<string, string> } };
      try {
        data = JSON.parse(r.data);
      } catch {
        continue;
      }
      const fields = data.infobox?.fields;
      const name = (fields?.name ?? r.name).trim();
      if (data.type !== "item" || !name || !isWikiPage(r.url)) continue;
      for (const id of infoboxItemIds(fields?.itemid)) names.set(id, [...(names.get(id) ?? []), { name, page: r.url }]);
    }
    return { dump: dates[0]!.d, wiki: { name: source.name, url: source.homepage, licence: source.licence }, names };
  } finally {
    db.close();
  }
}

/** Where a run writes the shown names: beside the asset folders, in a folder of its own that only the private bucket gets. */
export const shownNamesDir = (outDir: string, meta: { product: string; buildId: number; buildConfig: string }) =>
  join(outDir, `${meta.product}-${meta.buildId}-${meta.buildConfig.slice(0, 8)}-names`);

/**
 * One run: reads the snapshot's item names and the knowledge base's wiki names, adds them to the ledger
 * (created when absent), and writes the shown names for the snapshot's build. Returns the coverage over the
 * build's items (every row of its Item table, the ids the category pages list).
 */
export function runItemNames(opts: { snapshotPath: string; kbPath: string; ledgerPath: string; outDir: string; at?: string }) {
  const meta = readClientMeta(opts.snapshotPath);
  const tables = new Map<string, Map<number, Record<string, unknown>>>();
  const get: TableReader = (t) => {
    if (!tables.has(t)) tables.set(t, readClientRows(opts.snapshotPath, t));
    const rows = tables.get(t)!;
    return rows.size ? rows : undefined;
  };
  const ids = [...(get("Item")?.keys() ?? [])];
  if (!ids.length) throw new Error("the snapshot has no Item table; run `client-extract --refresh` first");
  const wiki = wikiNames(opts.kbPath);
  const before = existsSync(opts.ledgerPath) ? parseLedger(JSON.parse(readFileSync(opts.ledgerPath, "utf8"))) : emptyLedger();
  const ledger = mergeLedger(before, { at: opts.at ?? new Date().toISOString(), build: meta.version, files: fileNames(get), wikiDump: wiki.dump, wiki: wiki.names });
  mkdirSync(dirname(opts.ledgerPath), { recursive: true });
  // Written beside the old file and then moved over it, so a failed write never leaves half a ledger.
  writeFileSync(`${opts.ledgerPath}.tmp`, `${JSON.stringify(ledger)}\n`);
  renameSync(`${opts.ledgerPath}.tmp`, opts.ledgerPath);
  const shown = shownNames(ledger, meta.version, ids, wiki.wiki);
  const dir = shownNamesDir(opts.outDir, meta);
  mkdirSync(dir, { recursive: true });
  const shownPath = join(dir, "item-names.json");
  writeFileSync(shownPath, `${JSON.stringify(shown)}\n`);
  return { build: meta.version, ledger, shown, shownPath, items: ids.length, ...coverage(ledger, meta.version, ids) };
}
