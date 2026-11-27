import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  coverage, emptyLedger, infoboxItemIds, mergeLedger, normName, parseLedger, runItemNames, shownNames, tierOf,
  WIKI_PAGE_PREFIX, type Ledger,
} from "../src/item-names.js";
import { mayShowName } from "../src/item-name-rule.js";
import { hotfixTable } from "../src/client-hotfixes.js";

const B1 = "1.60.1.70450", B2 = "1.60.1.70999";
const page = (title: string) => `${WIKI_PAGE_PREFIX}${title}`;
const wiki = { name: "Warcraft Wiki (Internet Archive dump, 2023-11-13)", url: "https://warcraft.wiki.gg", licence: "CC-BY-SA-4.0" };

function ledgerOf(files: [number, string][], wikiNames: [number, string][], build = B1): Ledger {
  return mergeLedger(emptyLedger(), {
    at: "2026-10-19T00:00:00Z", build,
    files: new Map(files.map(([id, name]) => [id, { name, quality: 2 }])),
    wikiDump: "2023-11-13",
    wiki: new Map(wikiNames.map(([id, name]) => [id, [{ name, page: page(name.replaceAll(" ", "_")) }]])),
  });
}

test("names agree across case, spacing and apostrophes, and nothing else", () => {
  expect(normName("Captain  Sanders’ Shirt")).toBe(normName("captain sanders' shirt"));
  expect(normName("Okra")).not.toBe(normName("Ripe Okra"));
});

test("each item gets one tier: match, mismatch, files, wiki or none", () => {
  const l = ledgerOf([[1, "Linen Cloth"], [2, "Okra"], [3, "Fel Ash Sample"]], [[1, "linen cloth"], [2, "Ripe Okra"], [4, "Thunderfury"]]);
  expect(tierOf(l.items["1"], B1)).toMatchObject({ tier: "match", file: { name: "Linen Cloth" }, wiki: { name: "linen cloth" } });
  expect(tierOf(l.items["2"], B1).tier).toBe("mismatch");
  expect(tierOf(l.items["3"], B1).tier).toBe("files");
  expect(tierOf(l.items["4"], B1).tier).toBe("wiki");
  expect(tierOf(l.items["5"], B1).tier).toBe("none");
  // A file name from another build does not count for this one.
  expect(tierOf(l.items["1"], B2).tier).toBe("wiki");
  const c = coverage(l, B1, [1, 2, 3, 4, 5]);
  expect(c.counts).toEqual({ match: 1, mismatch: 1, files: 1, wiki: 1, none: 1 });
  expect(c.mismatches).toEqual([{ id: 2, files: "Okra", wiki: ["Ripe Okra"] }]);
});

test("the shown file names every item a source names: the game file name first, the wiki page where the wiki agrees", () => {
  const l = ledgerOf([[1, "Linen Cloth"], [2, "Okra"], [3, "Fel Ash Sample"]], [[1, "Linen Cloth"], [2, "Ripe Okra"], [4, "Thunderfury"]]);
  const shown = shownNames(l, B1, [1, 2, 3, 4, 5], wiki);
  expect(shown).toMatchObject({ schema: "everloot.item-names/1", build: { version: B1 }, count: 4, wiki });
  expect(shown.names).toEqual({
    1: { n: "Linen Cloth", q: 2, w: "Linen_Cloth" },
    // The two disagree: this build's own name shows, with no wiki page.
    2: { n: "Okra", q: 2 },
    3: { n: "Fel Ash Sample", q: 2 },
    // Only the wiki names it: its name and page, and no quality.
    4: { n: "Thunderfury", w: "Thunderfury" },
  });
  // Only the build's own items: an id the build does not list is left out.
  expect(shownNames(l, B1, [5], wiki).count).toBe(0);
});

test("every id and every name shows: no id cap and no placeholder filter", () => {
  const names: [number, string][] = [[1, "Linen Cloth"], [25_000, "Book of Deathstones: Mask of Death"], [191666, "Skeletal Steed"], [2, "Deprecated Calico Shoulderpads"], [4, "[PH] Naxxramas Sword"]];
  const l = ledgerOf(names, names);
  expect(Object.keys(shownNames(l, B1, names.map(([id]) => id), wiki).names).map(Number)).toEqual([1, 2, 4, 25_000, 191666]);
  expect(coverage(l, B1, names.map(([id]) => id)).shownCount).toBe(names.length);
  expect(mayShowName(25_000, "Linen Cloth")).toBe(true);
  expect(mayShowName(0, "Linen Cloth")).toBe(false);
  expect(mayShowName(1, "  ")).toBe(false);
});

test("the ledger only grows: a new build adds beside the old one, a repeat adds nothing, nothing is removed", () => {
  const first = ledgerOf([[1, "Linen Cloth"], [2, "Okra"]], [[1, "Linen Cloth"]]);
  const again = mergeLedger(first, { at: "2026-10-20T00:00:00Z", build: B1, files: new Map([[1, { name: "Linen Cloth", quality: 2 }]]), wikiDump: "2023-11-13", wiki: new Map([[1, [{ name: "Linen Cloth", page: page("Linen_Cloth") }]]]) });
  expect(again.items).toEqual(first.items);
  expect(again.runs.at(-1)!.added).toEqual({ files: 0, wiki: 0 });
  // The next build renames item 1 and drops item 2: both old readings stay.
  const next = mergeLedger(again, { at: "2026-11-01T00:00:00Z", build: B2, files: new Map([[1, { name: "Bolt of Linen", quality: 1 }]]), wikiDump: null, wiki: new Map() });
  expect(next.items["1"]!.files).toEqual([{ build: B1, name: "Linen Cloth", quality: 2 }, { build: B2, name: "Bolt of Linen", quality: 1 }]);
  expect(next.items["2"]!.files).toEqual([{ build: B1, name: "Okra", quality: 2 }]);
  expect(tierOf(next.items["1"], B2).tier).toBe("mismatch");
  expect(next.runs).toHaveLength(3);
  // The input ledger is not changed.
  expect(first.items["1"]!.files).toHaveLength(1);
});

test("a ledger file is read only when it is one", () => {
  expect(() => parseLedger({ schema: "everloot.item-names/1", names: {} })).toThrow(/not an item name ledger/);
  expect(parseLedger(JSON.parse(JSON.stringify(emptyLedger())))).toEqual(emptyLedger());
});

test("an infobox item id is one number or a plain list of them", () => {
  expect(infoboxItemIds("2589")).toEqual([2589]);
  expect(infoboxItemIds("2589, 2590")).toEqual([2589, 2590]);
  expect(infoboxItemIds("2589 (Classic)")).toEqual([]);
  expect(infoboxItemIds(undefined)).toEqual([]);
});

function fixtures() {
  const dir = mkdtempSync(join(tmpdir(), "everloot-item-names-"));
  const snapshotPath = join(dir, "snapshot.sqlite");
  const snap = new Database(snapshotPath);
  snap.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE client_rows (tbl TEXT NOT NULL, id INTEGER NOT NULL, raw TEXT NOT NULL, PRIMARY KEY (tbl, id));");
  const meta = { product: "wow_classic_beta", buildId: "70450", version: B1, buildConfig: "84bea4233331e390fda8724c6f91ffa5", extractedAt: "2026-10-18T00:00:00Z", library: "x" };
  for (const [k, v] of Object.entries(meta)) snap.prepare("INSERT INTO meta VALUES (?, ?)").run(k, v);
  const row = snap.prepare("INSERT INTO client_rows VALUES (?, ?, ?)");
  for (const [id, name] of [[2589, "Linen Cloth"], [732, "Okra"], [270000, "Fel Ash Sample"]] as const) {
    row.run("ItemSparse", id, JSON.stringify({ ID: id, Display_lang: name, OverallQualityID: 1, ExpansionID: 0 }));
  }
  for (const id of [2589, 732, 270000, 9999]) row.run("Item", id, JSON.stringify({ ID: id, ClassID: 7, SubclassID: 5 }));
  snap.close();
  const kbPath = join(dir, "kb.sqlite");
  const kb = new Database(kbPath);
  kb.exec("CREATE TABLE sources (id TEXT PRIMARY KEY, name TEXT, licence TEXT, publishable INTEGER, homepage TEXT); CREATE TABLE entities (id INTEGER PRIMARY KEY, kind TEXT, ext_id TEXT, name TEXT, body TEXT, data TEXT, game_version TEXT, source_id TEXT, source_url TEXT, licence TEXT, retrieved_at TEXT);");
  kb.prepare("INSERT INTO sources VALUES ('warcraft-wiki-2023', ?, 'CC-BY-SA-4.0', 1, 'https://warcraft.wiki.gg')").run(wiki.name);
  const entity = kb.prepare("INSERT INTO entities (kind, name, data, source_id, source_url, licence, retrieved_at) VALUES ('lore_page', ?, ?, 'warcraft-wiki-2023', ?, 'CC-BY-SA-4.0', '2023-11-13')");
  const item = (name: string, itemid: string) => JSON.stringify({ type: "item", infobox: { template: "#data:itemtip", fields: { name, itemid } } });
  entity.run("Linen Cloth", item("Linen Cloth", "2589"), page("Linen_Cloth"));
  entity.run("Ripe Okra", item("Ripe Okra", "732"), page("Ripe_Okra"));
  entity.run("Thunderfury", item("Thunderfury, Blessed Blade of the Windseeker", "19019"), page("Thunderfury"));
  // Not an item page, and a page off the wiki: neither gives a name.
  entity.run("Thrall", JSON.stringify({ type: "npc", infobox: { template: "npcbox", fields: { name: "Thrall", itemid: "9999" } } }), page("Thrall"));
  entity.run("Elsewhere", item("Okra", "732"), "https://example.test/wiki/Okra");
  kb.close();
  return { dir, snapshotPath, kbPath };
}

test("a run adds both sources to the ledger and writes the shown names beside the asset folders", () => {
  const { dir, snapshotPath, kbPath } = fixtures();
  const ledgerPath = join(dir, "ledger", "ledger.json");
  const run = runItemNames({ snapshotPath, kbPath, ledgerPath, outDir: join(dir, "assets"), at: "2026-10-19T00:00:00Z" });
  expect(run.items).toBe(4);
  expect(run.counts).toEqual({ match: 1, mismatch: 1, files: 1, wiki: 0, none: 1 });
  expect(run.shownPath).toBe(join(dir, "assets", "wow_classic_beta-70450-84bea423-names", "item-names.json"));
  const shown = JSON.parse(readFileSync(run.shownPath, "utf8"));
  expect(shown.names).toEqual({ 732: { n: "Okra", q: 1 }, 2589: { n: "Linen Cloth", q: 1, w: "Linen_Cloth" }, 270000: { n: "Fel Ash Sample", q: 1 } });
  const ledger = parseLedger(JSON.parse(readFileSync(ledgerPath, "utf8")));
  // The ledger keeps every reading: the wiki's other name, and a wiki name for an id this build lacks.
  expect(ledger.items["732"]!.wiki.map((w) => w.name)).toEqual(["Ripe Okra"]);
  expect(ledger.items["270000"]!.files[0]!.name).toBe("Fel Ash Sample");
  expect(ledger.items["19019"]!.wiki[0]!.name).toBe("Thunderfury, Blessed Blade of the Windseeker");
  expect(existsSync(`${ledgerPath}.tmp`)).toBe(false);
  const twice = runItemNames({ snapshotPath, kbPath, ledgerPath, outDir: join(dir, "assets"), at: "2026-10-20T00:00:00Z" });
  expect(twice.ledger.items).toEqual(ledger.items);
  expect(twice.ledger.runs).toHaveLength(2);
});

test("an item the file's ItemSparse lacks is named from the client's hotfix row, and the ledger says the name came from there", () => {
  const { dir, snapshotPath, kbPath } = fixtures();
  const snap = new Database(snapshotPath);
  // 9999 is in Item only; the hotfix cache holds its row. 2589's hotfix row does not replace the file's own.
  snap.prepare("INSERT INTO client_rows VALUES (?, ?, ?)").run(hotfixTable("ItemSparse"), 9999, JSON.stringify({ ID: 9999, Display_lang: "Vorpal Dagger", OverallQualityID: 2 }));
  snap.prepare("INSERT INTO client_rows VALUES (?, ?, ?)").run(hotfixTable("ItemSparse"), 2589, JSON.stringify({ ID: 2589, Display_lang: "Other Cloth", OverallQualityID: 3 }));
  snap.close();
  const ledgerPath = join(dir, "ledger", "ledger.json");
  const run = runItemNames({ snapshotPath, kbPath, ledgerPath, outDir: join(dir, "assets"), at: "2026-11-27T00:00:00Z" });
  expect(run.counts).toEqual({ match: 1, mismatch: 1, files: 2, wiki: 0, none: 0 });
  const shown = JSON.parse(readFileSync(run.shownPath, "utf8"));
  expect(shown.names["9999"]).toEqual({ n: "Vorpal Dagger", q: 2 });
  expect(shown.names["2589"]).toEqual({ n: "Linen Cloth", q: 1, w: "Linen_Cloth" });
  expect(run.ledger.items["9999"]!.files).toEqual([{ build: B1, name: "Vorpal Dagger", quality: 2, hotfix: true }]);
  expect(run.ledger.items["2589"]!.files).toEqual([{ build: B1, name: "Linen Cloth", quality: 1 }]);
});
