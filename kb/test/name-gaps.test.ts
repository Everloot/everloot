import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { hotfixTable } from "../src/client-hotfixes.js";
import { emptyLedger, mergeLedger, WIKI_PAGE_PREFIX } from "../src/item-names.js";
import { baselineNames, fileNameGaps, formatNameGaps, itemGaps, kindCoverage, NAME_GAPS_SCHEMA, playerNames, questGaps, runNameGaps, type NameGaps } from "../src/name-gaps.js";
import { openDb } from "../src/db.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";

const B1 = "1.60.1.70450";
const COUNTED: NameGaps["counted"] = { snapshot: "2026-10-21", wikiDump: "2023-11-13", baseline: { commit: "104f35678ca39ab1fb78b655f815cc7016f5e0c8", retrievedAt: "2026-10-21" }, uploads: { asOf: "2026-10-22T06:00:00Z" } };
const page = (title: string) => `${WIKI_PAGE_PREFIX}${title}`;

test("every item gets one reason: the source of its name, or the addon when no source names it", () => {
  const ledger = mergeLedger(emptyLedger(), {
    at: "2026-10-21T00:00:00Z", build: B1,
    files: new Map([[25, "Worn Shortsword"], [41, "Fel Ash Sample"], [732, "Okra"], [30_000, "Later Sword"]].map(([id, name]) => [id as number, { name: name as string, quality: 1 }])),
    wikiDump: "2023-11-13",
    wiki: new Map([[25, "Worn Shortsword"], [647, "Destiny"], [732, "Ripe Okra"], [30_000, "Later Sword"]].map(([id, name]) => [id as number, [{ name: name as string, page: page(String(name)) }]])),
  });
  const k = itemGaps(ledger, B1, [25, 41, 647, 732, 30_000, 17]);
  expect(k.total).toBe(6);
  expect(Object.fromEntries(k.buckets.map((b) => [b.reason, [b.route, b.sample]]))).toEqual({
    "files and wiki agree": ["shown", [25, 30_000]],
    "game files only": ["shown", [41]],
    "wiki only": ["shown", [647]],
    "files and wiki differ (the files' name shows)": ["shown", [732]],
    "no name in the files or the wiki": ["players", [17]],
  });
  // Listed by route: what shows first, then what waits on the addon.
  expect(k.buckets.at(-1)!.route).toBe("players");
});

test("a quest without a wiki title waits on the addon; one whose wiki pages disagree still shows", () => {
  const titles = new Map([
    [2, [{ name: "Sharptalon's Claw", page: page("Sharptalon's_Claw") }]],
    [1, [{ name: "The Escape", page: page("The_Escape") }, { name: "Into the Fray", page: page("Into_the_Fray") }]],
    [65593, [{ name: "Later Quest", page: page("Later_Quest") }]],
  ]);
  const k = questGaps(B1, [1, 2, 28, 65593], titles);
  expect(k.buckets).toEqual([
    { reason: "wiki title", route: "shown", count: 2, sample: [2, 65593] },
    { reason: "wiki pages differ (the first one's title shows)", route: "shown", count: 1, sample: [1] },
    { reason: "no wiki title (the game files hold none)", route: "players", count: 1, sample: [28] },
  ]);
});

test("a set or spell is named when its row has a name", () => {
  const rows = new Map<number, Record<string, unknown>>([[1, { Name_lang: "The Gladiator" }], [1570, { Name_lang: "[DNT] Test Set" }], [2, { Name_lang: "" }]]);
  expect(fileNameGaps("item_set", "Item sets", rows).buckets).toEqual([
    { reason: "named in the game files", route: "shown", count: 2, sample: [1, 1570] },
    { reason: "no name in the game files", route: "none", count: 1, sample: [2] },
  ]);
});

test("the report prints ids and counts per route, never a name", () => {
  const rows = new Map<number, Record<string, unknown>>([[1, { Name_lang: "The Gladiator" }], [2, { Name_lang: "" }]]);
  const md = formatNameGaps({ schema: NAME_GAPS_SCHEMA, build: B1, kinds: [fileNameGaps("item_set", "Item sets", rows)], coverage: [], counted: COUNTED });
  expect(md).toContain("| Item sets | 2 | 1 | 0 | 1 |");
  expect(md).toContain("| no name in the game files | none | 1 | 2 |");
  expect(md).not.toContain("Gladiator");
});

test("coverage counts each source over the ids the game files and the baseline list, and a source nobody read is [?], never 0", () => {
  // Game files list 1-4; the baseline lists 3-6 (5 and 6 the game files do not have): 6 ids in either.
  const k = kindCoverage("item", "Items", {
    files: [1, 2, 3, 4], baseline: [3, 4, 5, 6],
    named: { files: [1, 2, 3, 99], wiki: [2, 4], baseline: [3, 4, 5, 6], players: [6, 1, 77] },
  });
  expect(k.listed).toEqual({ files: 4, baseline: 4, either: 6 });
  // 99 and 77 are in neither list, so no source counts them.
  expect(k.named).toEqual({ files: 3, wiki: 2, baseline: 4, players: 2, any: 6 });
  const noBaseline = kindCoverage("item", "Items", { files: [1, 2, 3], baseline: null, named: { files: [1], wiki: [], baseline: null, players: null } });
  expect(noBaseline.listed).toEqual({ files: 3, baseline: null, either: 3 });
  expect(noBaseline.named).toEqual({ files: 1, wiki: 0, baseline: null, players: null, any: 1 });
});

test("the report prints each source's count with its denominator, the dates and the method, and no name or id", () => {
  const md = formatNameGaps({
    schema: NAME_GAPS_SCHEMA, build: B1, kinds: [], counted: COUNTED,
    coverage: [
      kindCoverage("item", "Items", { files: [1, 2, 3, 4], baseline: [3, 4, 5, 6], named: { files: [1, 2, 3], wiki: [2, 4], baseline: [3, 4, 5, 6], players: [6] } }),
      kindCoverage("item_set", "Item sets", { files: [1, 2], baseline: [], named: { files: [1], wiki: [], baseline: [], players: [] } }),
    ],
  });
  expect(md).toContain("| Items | 4 | 4 | 6 | 3 (50.0%) | 2 (33.3%) | 4 (66.7%) | 1 (16.7%) | 6 (100.0%) | 0 (0.0%) |");
  expect(md).toContain("| Item sets | 2 | 0 | 2 | 1 (50.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 1 (50.0%) | 1 (50.0%) |");
  expect(md).toContain(`build ${B1}`);
  expect(md).toContain("2023-11-13");
  expect(md).toContain("104f3567");
  expect(md).toContain("uploads as of 2026-10-22");
  const unread = formatNameGaps({
    schema: NAME_GAPS_SCHEMA, build: B1, kinds: [], coverage: [kindCoverage("quest", "Quests", { files: [1], baseline: null, named: { files: [], wiki: [1], baseline: null, players: null } })],
    counted: { snapshot: "2026-10-21", wikiDump: "2023-11-13", baseline: null, uploads: null },
  });
  expect(unread).toContain("| Quests | 1 | [?] | 1 | 0 (0.0%) | 1 (100.0%) | [?] | [?] | 1 (100.0%) | 0 (0.0%) |");
  expect(unread).toContain("not read");
  // 1 of 10,000 is not "0.0%": a nonzero count never reads as zero.
  const tiny = formatNameGaps({
    schema: NAME_GAPS_SCHEMA, build: B1, kinds: [], counted: COUNTED,
    coverage: [kindCoverage("spell", "Spells", { files: Array.from({ length: 10_000 }, (_, i) => i + 1), baseline: [], named: { files: Array.from({ length: 9_999 }, (_, i) => i + 1), wiki: [], baseline: [], players: [] } })],
  });
  expect(tiny).toContain("| Spells | 10000 | 0 | 10000 | 9999 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 9999 (100.0%) | 1 (<0.1%) |");
});

test("the baseline's item and quest names are read from its rows, and players' names are the ones 3 installs agree on", async () => {
  const db = openDb(":memory:");
  const row = (kind: EntityInput["kind"], id: number, name: string): EntityInput => ({
    kind, extId: String(id), name, gameVersion: "classic", sourceUrl: `https://github.com/shagu/pfQuest/blob/${"a".repeat(40)}/db/x.lua`, retrievedAt: "2026-10-20", data: { entity: kind },
  });
  await replaceSourceRows(db, "pfquest-classic", ["npc", "item", "quest"], [row("item", 25, "Worn Shortsword"), row("quest", 7, "Rat Problem"), row("npc", 9, "Elder")]);
  const b = baselineNames(db);
  expect([...b.items.keys()], "items").toEqual([25]);
  expect([...b.quests.keys()], "quests").toEqual([7]);
  expect(b.commit).toBe("a".repeat(40));
  expect(b.retrievedAt).toBe("2026-10-20");
  expect(baselineNames(openDb(":memory:")).items.size).toBe(0);

  const seen = (installId: string, itemId: number, name: string) => ({ kind: "item_seen", installId, itemId, name });
  const asked = (installId: string, questId: number, title: string) => ({ kind: "quest", installId, questId, title, level: 5 });
  const p = playerNames([
    seen("a", 25, "Worn Shortsword"), seen("b", 25, "Worn Shortsword"), seen("c", 25, "Worn Shortsword"), seen("a", 26, "Two Installs"), seen("b", 26, "Two Installs"),
    asked("a", 7, "Rat Problem"), asked("b", 7, "Rat Problem"), asked("c", 7, "Rat Problem"), asked("a", 8, "One Install"),
  ]);
  expect([...p.items.keys()], "items two installs report").toEqual([25]);
  expect([...p.quests.keys()], "quests one install reports").toEqual([7]);
});

test("a run counts an item the hotfix cache names as named by the game files, as the shown names do", () => {
  const dir = mkdtempSync(join(tmpdir(), "kb-name-gaps-"));
  const snapshotPath = join(dir, "client.sqlite");
  const snap = new Database(snapshotPath);
  snap.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE client_rows (tbl TEXT NOT NULL, id INTEGER NOT NULL, raw TEXT NOT NULL, PRIMARY KEY (tbl, id));");
  for (const [k, v] of Object.entries({ product: "wowf", buildId: "71139", version: B1, buildConfig: "7a16decda3672d84db0d34d0784fda98", extractedAt: "2026-11-25T00:00:00Z", library: "x" })) snap.prepare("INSERT INTO meta VALUES (?, ?)").run(k, v);
  const row = (tbl: string, id: number, raw: object) => snap.prepare("INSERT INTO client_rows VALUES (?, ?, ?)").run(tbl, id, JSON.stringify({ ID: id, ...raw }));
  // Made-up rows: 10 is named by the file, 20 only by the hotfix cache, 30 by neither.
  for (const id of [10, 20, 30]) row("Item", id, { ClassID: 2 });
  row("ItemSparse", 10, { Display_lang: "Plain Sword", OverallQualityID: 1 });
  row(hotfixTable("ItemSparse"), 20, { Display_lang: "Server Dagger", OverallQualityID: 2 });
  row("QuestV2", 1, {});
  row("ItemSet", 1, { Name_lang: "Some Set" });
  row("SpellName", 1, { Name_lang: "Some Spell" });
  snap.close();
  const kbPath = join(dir, "kb.sqlite");
  const kb = new Database(kbPath);
  kb.exec("CREATE TABLE sources (id TEXT PRIMARY KEY, name TEXT, licence TEXT, publishable INTEGER, homepage TEXT); CREATE TABLE entities (id INTEGER PRIMARY KEY, kind TEXT, ext_id TEXT, name TEXT, body TEXT, data TEXT, game_version TEXT, source_id TEXT, source_url TEXT, licence TEXT, retrieved_at TEXT);");
  kb.prepare("INSERT INTO sources VALUES ('warcraft-wiki-2023', 'Warcraft Wiki', 'CC-BY-SA-4.0', 1, 'https://warcraft.wiki.gg')").run();
  kb.prepare("INSERT INTO entities (kind, name, data, source_id, source_url, licence, retrieved_at) VALUES ('lore_page', 'Thrall', '{}', 'warcraft-wiki-2023', ?, 'CC-BY-SA-4.0', '2023-11-13')").run(page("Thrall"));
  kb.close();
  const report = runNameGaps({ snapshotPath, kbPath });
  expect(report.coverage.find((c) => c.kind === "item")!.named.files).toBe(2);
  const items = report.kinds.find((k) => k.kind === "item")!;
  expect(items.buckets.filter((b) => b.route === "shown").reduce((n, b) => n + b.count, 0)).toBe(2);
});
