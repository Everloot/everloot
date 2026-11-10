import Database from "better-sqlite3";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runGameNames, shownFileNames, shownQuestNames, SPELL_NAMES_SCHEMA } from "../src/game-names.js";
import { mayShowQuestTitle, mayShowSetName, mayShowSpellName } from "../src/game-name-rule.js";
import { WIKI_PAGE_PREFIX } from "../src/item-names.js";

const B1 = "1.60.1.70450";
const page = (title: string) => `${WIKI_PAGE_PREFIX}${title}`;
const wiki = { name: "Warcraft Wiki (Internet Archive dump, 2023-11-13)", url: "https://warcraft.wiki.gg", licence: "CC-BY-SA-4.0" };

test("a quest title shows where the build lists the id and the wiki gives a title; where pages disagree, the first page's", () => {
  const titles = new Map([
    [176, [{ name: "Wanted: Hogger", page: page("Wanted:_Hogger") }]],
    // Two pages, the same title apart from case and spacing: one title, the first page's.
    [33, [{ name: "Wolves Across the Border", page: page("Wolves_Across_the_Border") }, { name: "wolves across  the border", page: page("Wolves_Across_the_Border_(Classic)") }]],
    [185, [{ name: "Tiger Mastery", page: page("Tiger_Mastery_(Classic)") }, { name: "Tiger Hunting", page: page("Tiger_Hunting") }]],
    [10_000, [{ name: "Later Quest", page: page("Later_Quest") }]],
    [26329, [{ name: "One More Thing", page: page("One_More_Thing") }]],
  ]);
  const { file, counts, mismatches } = shownQuestNames(B1, [176, 33, 185, 7, 10_000], titles, wiki);
  expect(file).toMatchObject({ schema: "everloot.quest-names/1", build: { version: B1 }, wiki, count: 4 });
  expect(file.names).toEqual({
    33: { n: "Wolves Across the Border", w: "Wolves_Across_the_Border" }, 176: { n: "Wanted: Hogger", w: "Wanted:_Hogger" },
    185: { n: "Tiger Mastery", w: "Tiger_Mastery_(Classic)" }, 10000: { n: "Later Quest", w: "Later_Quest" },
  });
  expect(counts).toEqual({ quests: 5, match: 3, mismatch: 1, files: 1, held: 0 });
  expect(mismatches).toEqual([{ id: 185, wiki: ["Tiger Mastery", "Tiger Hunting"] }]);
  // A wiki title for an id the build does not list (26329) is never shown.
  expect(file.names["26329"]).toBeUndefined();
});

test("set and spell names come from the game files for every id that has one", () => {
  const rows = new Map<number, Record<string, unknown>>([
    [1, { ID: 1, Name_lang: "The Gladiator" }], [41, { ID: 41, Name_lang: " Dal'Rend's Arms " }], [1570, { ID: 1570, Name_lang: "Twilight Invoker's Vestments" }],
    [2, { ID: 2, Name_lang: "" }], [3, { ID: 3, Name_lang: "Deprecated Set" }],
  ]);
  const { file, counts } = shownFileNames("everloot.item-set-names/1", B1, rows, [1, 41, 41, 1570, 2, 3, 99], mayShowSetName);
  expect(file).toEqual({ schema: "everloot.item-set-names/1", build: { version: B1 }, count: 4, names: { 1: "The Gladiator", 3: "Deprecated Set", 41: "Dal'Rend's Arms", 1570: "Twilight Invoker's Vestments" } });
  expect(counts).toEqual({ ids: 6, named: 4 });
});

test("the rule: any id, any name that is not empty", () => {
  for (const may of [mayShowQuestTitle, mayShowSetName, mayShowSpellName]) {
    expect(may(30_000, "[DNT] Hydrate Seed Pod")).toBe(true);
    expect(may(0, "Linen Bandage")).toBe(false);
    expect(may(1, " ")).toBe(false);
  }
  // A wiki title a Forever source contradicts waits for players.
  expect(mayShowQuestTitle(8415, "Chillwind Camp")).toBe(false);
  expect(mayShowQuestTitle(8414, "Dispelling Evil")).toBe(true);
});

function fixtures() {
  const dir = mkdtempSync(join(tmpdir(), "everloot-game-names-"));
  const snapshotPath = join(dir, "snapshot.sqlite");
  const snap = new Database(snapshotPath);
  snap.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE client_rows (tbl TEXT NOT NULL, id INTEGER NOT NULL, raw TEXT NOT NULL, PRIMARY KEY (tbl, id));");
  const meta = { product: "wow_classic_beta", buildId: "70450", version: B1, buildConfig: "84bea4233331e390fda8724c6f91ffa5", extractedAt: "2026-10-18T00:00:00Z", library: "x" };
  for (const [k, v] of Object.entries(meta)) snap.prepare("INSERT INTO meta VALUES (?, ?)").run(k, v);
  const row = snap.prepare("INSERT INTO client_rows VALUES (?, ?, ?)");
  for (const id of [176, 7]) row.run("QuestV2", id, JSON.stringify({ ID: id, UniqueBitFlag: 0 }));
  row.run("ItemSet", 1, JSON.stringify({ ID: 1, Name_lang: "The Gladiator", ItemID: [11729] }));
  for (const [id, name] of [[3275, "Linen Bandage"], [1316597, "Stock Crate"]] as const) row.run("SpellName", id, JSON.stringify({ ID: id, Name_lang: name }));
  snap.close();
  const kbPath = join(dir, "kb.sqlite");
  const kb = new Database(kbPath);
  kb.exec("CREATE TABLE sources (id TEXT PRIMARY KEY, name TEXT, licence TEXT, publishable INTEGER, homepage TEXT); CREATE TABLE entities (id INTEGER PRIMARY KEY, kind TEXT, ext_id TEXT, name TEXT, body TEXT, data TEXT, game_version TEXT, source_id TEXT, source_url TEXT, licence TEXT, retrieved_at TEXT);");
  kb.prepare("INSERT INTO sources VALUES ('warcraft-wiki-2023', ?, 'CC-BY-SA-4.0', 1, 'https://warcraft.wiki.gg')").run(wiki.name);
  const entity = kb.prepare("INSERT INTO entities (kind, name, data, source_id, source_url, licence, retrieved_at) VALUES ('lore_page', ?, ?, 'warcraft-wiki-2023', ?, 'CC-BY-SA-4.0', '2023-11-13')");
  const quest = (fields: Record<string, string>) => JSON.stringify({ type: "quest", infobox: { template: "questbox", fields } });
  entity.run("Wanted: Hogger", quest({ name: "Wanted: Hogger", id: "176" }), page("Wanted:_Hogger"));
  // No `name` field: the page title is the title, kept as it is.
  entity.run("Kobold Camp Cleanup (Classic)", quest({ id: "7" }), page("Kobold_Camp_Cleanup_(Classic)"));
  // Not a quest page, and a page off the wiki: neither gives a title.
  entity.run("Hogger", JSON.stringify({ type: "npc", infobox: { template: "questbox", fields: { name: "Hogger", id: "7" } } }), page("Hogger"));
  entity.run("Elsewhere", quest({ name: "Elsewhere", id: "7" }), "https://example.test/wiki/Elsewhere");
  kb.close();
  return { dir, snapshotPath, kbPath };
}

test("a run writes the three files beside item-names.json, for the snapshot's build", () => {
  const { dir, snapshotPath, kbPath } = fixtures();
  const run = runGameNames({ snapshotPath, kbPath, outDir: join(dir, "assets") });
  const folder = join(dir, "assets", "wow_classic_beta-70450-84bea423-names");
  expect(run.quests.path).toBe(join(folder, "quest-names.json"));
  expect(JSON.parse(readFileSync(run.quests.path, "utf8")).names).toEqual({ 7: { n: "Kobold Camp Cleanup (Classic)", w: "Kobold_Camp_Cleanup_(Classic)" }, 176: { n: "Wanted: Hogger", w: "Wanted:_Hogger" } });
  expect(JSON.parse(readFileSync(join(folder, "item-set-names.json"), "utf8")).names).toEqual({ 1: "The Gladiator" });
  const spells = JSON.parse(readFileSync(join(folder, "spell-names.json"), "utf8"));
  expect(spells).toEqual({ schema: SPELL_NAMES_SCHEMA, build: { version: B1 }, count: 2, names: { 3275: "Linen Bandage", 1316597: "Stock Crate" } });
  expect(run.spells.counts).toEqual({ ids: 2, named: 2 });
});

test("wiki NPC and fallback spell catalogs preserve source pages and omit conflicting names", () => {
  const { dir, snapshotPath, kbPath } = fixtures();
  const db = new Database(kbPath);
  const add = (kind: string, id: string, name: string) => db.prepare("INSERT INTO entities (kind, name, data, source_id, source_url, licence, retrieved_at) VALUES ('lore_page', ?, ?, 'warcraft-wiki-2023', ?, 'CC-BY-SA-4.0', '2023-11-13')").run(name, JSON.stringify({ type: kind, infobox: { template: kind === "npc" ? "npcbox" : "infobox spell", fields: { id, name } } }), page(name));
  add("npc", "448", "Hogger");
  add("npc", "999", "First"); add("npc", "999", "Other");
  add("spell", "10", "Blizzard");
  db.close();
  const run = runGameNames({ snapshotPath, kbPath, outDir: join(dir, "assets") });
  expect(JSON.parse(readFileSync(run.wikiEntities[0]!.path, "utf8")).names).toEqual({ 448: { n: "Hogger", w: "Hogger" } });
  expect(JSON.parse(readFileSync(run.wikiEntities[1]!.path, "utf8")).names).toEqual({ 10: { n: "Blizzard", w: "Blizzard" } });
});
