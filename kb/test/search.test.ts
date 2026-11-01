import { expect, test } from "vitest";
import { fillNameNorm, openDb } from "../src/db.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import { allTerms, getByName, getEntity, search, searchSomeWords } from "../src/search.js";

const row = (extId: string, name: string, body = "", extra: Partial<EntityInput> = {}): EntityInput => ({
  kind: "lore_page",
  extId,
  name,
  body,
  gameVersion: "lore",
  sourceUrl: `https://example.test/${extId}`,
  retrievedAt: "2023-11-13",
  ...extra,
});

async function seed() {
  const db = openDb(":memory:");
  await replaceSourceRows(db, "curated", ["lore_page", "item"], [
    row("1", "Thunderfury", "Warchief Thrall once held Thunderfury aloft."),
    row("2", "Blessed Blade of the Windseeker", "Thunderfury Thunderfury Thunderfury. Forged from Thunderfury winds."),
    row("3", "Thunderfury, Blessed Blade", "A sword. Thunderfury.", { kind: "item", gameVersion: "retail" }),
  ]);
  return db;
}

test("an exact-name match ranks first even when another page repeats the words", async () => {
  const hits = await search(await seed(), "Thunderfury");
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].name).toBe("Thunderfury");
});

test("question words do not block the match", async () => {
  const hits = await search(await seed(), "where is Thunderfury");
  expect(hits.map((h) => h.name)).toContain("Thunderfury");
});

test("a question still puts the exact name first, not a page that repeats it", async () => {
  // Found live: "Who is Thrall?" answered with "Dormant Thrall" because the boost compared the raw question.
  const hits = await search(await seed(), "Who is Thunderfury?");
  expect(hits[0].name).toBe("Thunderfury");
  const plural = await search(await seed(), "tell me about the Blessed Blade of the Windseeker");
  expect(plural[0].name).toBe("Blessed Blade of the Windseeker");
});

test("a name of exactly the asked words beats one that only matches after dropping stopwords", async () => {
  // The real release answered "Who is Thrall?" with the quest page "Find Thrall!" ("find" is a stopword).
  const db = openDb(":memory:");
  await replaceSourceRows(db, "curated", ["lore_page"], [
    row("1", "Find Thunderfury!", "Thunderfury Thunderfury Thunderfury, a quest."),
    row("2", "Thunderfury", "A sword of legend, long and storied, held by many over the ages."),
  ]);
  expect((await search(db, "Who is Thunderfury?", 1))[0].name).toBe("Thunderfury");
});

test("at the same rank, Everloot's curated entry comes before a copied wiki page", async () => {
  const db = openDb(":memory:");
  // The wiki copy goes in first, so it has the lower id and wins every tie the SQL order breaks.
  await replaceSourceRows(db, "warcraft-wiki-2023", ["lore_page"], [row("10", "Forever launch date", "Forever launch date, Forever launch date, as the wiki had it.")]);
  await replaceSourceRows(db, "curated", ["lore_page"], [row("forever-launch-date", "Forever launch date", "Launches November 4.")]);
  const hits = await search(db, "Forever launch date");
  expect(hits.map((h) => h.sourceId)).toEqual(["curated", "warcraft-wiki-2023"]);
  // An exact name still beats a curated entry that only shares words.
  await replaceSourceRows(db, "curated", ["lore_page"], [row("forever-notes", "Notes on the Forever launch date", "Forever launch date.")]);
  expect((await search(db, "Forever launch date"))[0].sourceId).toBe("warcraft-wiki-2023");
});

test("hits carry gameVersion and retrievedAt", async () => {
  const hits = await search(await seed(), "Thunderfury");
  expect(hits[0]).toMatchObject({ gameVersion: "lore", retrievedAt: "2023-11-13" });
  const item = hits.find((h) => h.kind === "item");
  expect(item).toMatchObject({ gameVersion: "retail" });
});

test("kind and version filters narrow the results", async () => {
  const db = await seed();
  expect((await search(db, "Thunderfury", 10, { kinds: ["item"] })).map((h) => h.kind)).toEqual(["item"]);
  expect((await search(db, "Thunderfury", 10, { versions: ["retail"] })).map((h) => h.gameVersion)).toEqual(["retail"]);
  expect(await search(db, "Thunderfury", 10, { kinds: ["npc"] })).toHaveLength(0);
});

test("getEntity returns one row by id, unknown id gives undefined", async () => {
  const db = await seed();
  const [first] = await search(db, "Thunderfury");
  expect(await getEntity(db, first.id)).toMatchObject({ id: first.id, name: first.name });
  expect(await getEntity(db, -1)).toBeUndefined();
});

test("getByName matches the full name case-insensitively", async () => {
  const db = await seed();
  expect((await getByName(db, "thunderfury")).map((r) => r.name)).toEqual(["Thunderfury"]);
  expect(await getByName(db, "Thunderfury", "item")).toHaveLength(0);
  expect(await getByName(db, "No Such Page")).toHaveLength(0);
});

test("paging is a stable prefix: page cuts at different limits never repeat or skip a hit", async () => {
  const db = openDb(":memory:");
  const rows: EntityInput[] = [];
  for (let i = 1; i <= 70; i++) rows.push(row(String(100 + i), `Grommash Grommash Grommash Hold ${i}`, `Grommash fought here ${"again ".repeat(i % 7)}`));
  rows.push(row("9", "Grommash!", ""));
  await replaceSourceRows(db, "curated", ["lore_page"], rows);
  const all = (await search(db, "the grommash", 80)).map((h) => h.id);
  expect(new Set(all).size).toBe(all.length);
  expect((await search(db, "the grommash", 20)).map((h) => h.id)).toEqual(all.slice(0, 20));
  expect((await search(db, "the grommash", 60)).map((h) => h.id)).toEqual(all.slice(0, 60));
  expect(all[0]).toBe((await search(db, "the grommash", 1))[0].id);
});

test("a punctuated exact name still ranks first when bm25 buries it past the window", async () => {
  const db = openDb(":memory:");
  const rows: EntityInput[] = [];
  for (let i = 1; i <= 60; i++) {
    rows.push(row(String(100 + i), `Kel Thuzad chronicle ${i}`, `${"kel thuzad ".repeat(20)}volume ${i}`));
  }
  rows.push(row("1", "Kel'Thuzad", "A lich of legend.", { data: { type: "npc" } }));
  await replaceSourceRows(db, "curated", ["lore_page"], rows);
  expect((await search(db, "kel thuzad", 10))[0].name).toBe("Kel'Thuzad");
  expect((await search(db, "kel thuzad", 1))[0].name).toBe("Kel'Thuzad");
  expect((await search(db, "kel thuzad", 10, { kinds: ["item"] })).some((h) => h.name === "Kel'Thuzad")).toBe(false);
  expect((await search(db, "kel thuzad", 10, { versions: ["retail"] })).some((h) => h.name === "Kel'Thuzad")).toBe(false);
  // The type filter applies to the exact-name lookup too.
  expect((await search(db, "kel thuzad", 10, { types: ["npc"] }))[0].name).toBe("Kel'Thuzad");
  expect((await search(db, "kel thuzad", 10, { types: ["item"] })).some((h) => h.name === "Kel'Thuzad")).toBe(false);
});

test("a curly-apostrophe exact name still ranks first when bm25 buries it", async () => {
  const db = openDb(":memory:");
  const rows: EntityInput[] = [];
  for (let i = 1; i <= 60; i++) {
    rows.push(row(String(100 + i), `Kel Thuzad chronicle ${i}`, `${"kel thuzad ".repeat(20)}volume ${i}`));
  }
  rows.push(row("1", "Kel’Thuzad", "A lich of legend."));
  await replaceSourceRows(db, "curated", ["lore_page"], rows);
  expect((await search(db, "kel thuzad", 10))[0].name).toBe("Kel’Thuzad");
  expect((await search(db, "kel thuzad", 1))[0].name).toBe("Kel’Thuzad");
  expect((await search(db, "kel thuzad", 10, { kinds: ["item"] })).some((h) => h.name === "Kel’Thuzad")).toBe(false);
});

test("the normalized lookup is skipped when the pool already holds the exact name", async () => {
  const countPrepares = (db: ReturnType<typeof openDb>): (() => number) => {
    let n = 0;
    const orig = db.prepare.bind(db);
    (db as unknown as { prepare: unknown }).prepare = (...args: [string, ...unknown[]]) => {
      n += 1;
      return (orig as (...a: unknown[]) => unknown)(...args);
    };
    return () => n;
  };

  const direct = await seed();
  const directCount = countPrepares(direct);
  expect((await search(direct, "Thunderfury"))[0].name).toBe("Thunderfury");
  expect(directCount()).toBe(1);

  const buried = openDb(":memory:");
  const rows: EntityInput[] = [];
  for (let i = 1; i <= 60; i++) {
    rows.push(row(String(100 + i), `Kel Thuzad chronicle ${i}`, `${"kel thuzad ".repeat(20)}volume ${i}`));
  }
  rows.push(row("1", "Kel'Thuzad", "A lich of legend."));
  await replaceSourceRows(buried, "curated", ["lore_page"], rows);
  const buriedCount = countPrepares(buried);
  expect((await search(buried, "kel thuzad", 10))[0].name).toBe("Kel'Thuzad");
  expect(buriedCount()).toBe(3); // pool, the one-time name_norm column check, the normalized lookup
  expect((await search(buried, "kel thuzad", 10))[0].name).toBe("Kel'Thuzad");
  expect(buriedCount()).toBe(5);
});

/** A database where `name` is buried past the re-rank window by 60 bm25-heavier pages. */
async function buriedUnder(name: string, words: string, extra: Partial<EntityInput> = {}) {
  const db = openDb(":memory:");
  const rows: EntityInput[] = [];
  for (let i = 1; i <= 60; i++) rows.push(row(String(100 + i), `${words} chronicle ${i}`, `${`${words} `.repeat(20)}volume ${i}`));
  rows.push(row("1", name, "The page being asked about.", extra));
  await replaceSourceRows(db, "curated", ["lore_page", "item"], rows);
  return db;
}

/** Records every SQL string the search prepares. */
function recordSql(db: ReturnType<typeof openDb>): string[] {
  const seen: string[] = [];
  const orig = db.prepare.bind(db);
  (db as unknown as { prepare: unknown }).prepare = (sql: string) => {
    seen.push(sql);
    return orig(sql);
  };
  return seen;
}

test("name_norm holds allTerms(name), including the letters and punctuation SQLite lower()/replace() miss", async () => {
  const names = ["Kel'Thuzad", "ÆRENDIL «Bright»", "Ünàl·Ström", "Zul'jin ~ the=Hexer", "ÁRBOL—Ñandú", "Thunderfury, Blessed Blade"];
  const db = openDb(":memory:");
  await replaceSourceRows(db, "curated", ["lore_page"], names.map((n, i) => row(String(i), n)));
  const stored = db.prepare("SELECT name, name_norm AS norm FROM entities ORDER BY id").all() as { name: string; norm: string }[];
  expect(stored.map((r) => r.norm)).toEqual(names.map(allTerms));
  expect(allTerms("ÆRENDIL «Bright»")).toBe("ærendil bright");
  expect(allTerms("Ünàl·Ström")).toBe("ünàl ström");
  expect(allTerms("Zul'jin ~ the=Hexer")).toBe("zul jin the hexer");
  // SQLite's lower() leaves non-ASCII capitals alone, so the old SQL expression could never match these.
  expect(db.prepare("SELECT lower('ÆRENDIL') AS v").get()).toEqual({ v: "Ærendil" });
});

test("rows written without name_norm are filled when the database is opened", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO entities (kind, ext_id, name, game_version, source_id, source_url, licence, retrieved_at)" +
      " VALUES ('lore_page', '1', 'ÆRENDIL «Bright»', 'lore', 'curated', 'https://example.test/1', 'CC-BY-SA-4.0', '2023-11-13')",
  ).run();
  expect(db.prepare("SELECT name_norm AS norm FROM entities").get()).toEqual({ norm: null });
  expect(fillNameNorm(db, false)).toBe(1);
  expect(db.prepare("SELECT name_norm AS norm FROM entities").get()).toEqual({ norm: "ærendil bright" });
  db.prepare("UPDATE entities SET name = 'Ærendil the Dim'").run();
  expect(fillNameNorm(db, false)).toBe(0); // only missing values without checkAll
  expect(fillNameNorm(db, true)).toBe(1);
  expect(db.prepare("SELECT name_norm AS norm FROM entities").get()).toEqual({ norm: "ærendil the dim" });
});

test("a buried non-ASCII exact name ranks first through name_norm", async () => {
  const db = await buriedUnder("ÆRENDIL «Bright»", "ærendil bright");
  expect((await search(db, "ærendil bright", 1))[0].name).toBe("ÆRENDIL «Bright»");
  expect((await search(db, "Ærendil Bright", 10))[0].name).toBe("ÆRENDIL «Bright»");
  expect((await search(db, "ærendil bright", 10, { kinds: ["item"] })).some((h) => h.name === "ÆRENDIL «Bright»")).toBe(false);
});

test("the exact lookup reads the name_norm index, narrowed by kind", async () => {
  const db = await buriedUnder("Kel'Thuzad", "kel thuzad");
  const seen = recordSql(db);
  expect((await search(db, "kel thuzad", 10, { kinds: ["lore_page"] }))[0].name).toBe("Kel'Thuzad");
  const exactSql = seen.find((s) => s.includes("name_norm IN"));
  expect(exactSql).toBeDefined();
  expect(exactSql).not.toContain("replace(");
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${exactSql}`).all("kel thuzad", "kel thuzad", "lore_page", "Testing-only content") as { detail: string }[];
  expect(plan.map((p) => p.detail).join("\n")).toMatch(/USING INDEX entities_name_norm \(name_norm=\? AND kind=\?\)/);
});

test("an old release without name_norm falls back to the SQL expression", async () => {
  const db = await buriedUnder("Kel'Thuzad", "kel thuzad");
  db.exec("DROP INDEX entities_name_norm; ALTER TABLE entities DROP COLUMN name_norm");
  const seen = recordSql(db);
  expect((await search(db, "kel thuzad", 10))[0].name).toBe("Kel'Thuzad");
  expect((await search(db, "kel thuzad", 1))[0].name).toBe("Kel'Thuzad");
  expect((await search(db, "kel thuzad", 10, { kinds: ["item"] })).some((h) => h.name === "Kel'Thuzad")).toBe(false);
  const exactSql = seen.filter((s) => s.includes("IN (?, ?)"));
  expect(exactSql.length).toBeGreaterThan(0);
  expect(exactSql.every((s) => s.includes("replace(") && !s.includes("name_norm"))).toBe(true);
});

test("a buried punctuated name with stopwords is rescued when asked with all its words", async () => {
  const db = await buriedUnder("Rise of the Lich-King", "rise lich king");
  expect((await search(db, "rise of the lich king", 1))[0].name).toBe("Rise of the Lich-King");
  expect((await search(db, "Rise of the Lich King?", 10))[0].name).toBe("Rise of the Lich-King");
});

test("when no page has every word, pages with more of the asked words come first", async () => {
  const db = openDb(":memory:");
  await replaceSourceRows(db, "curated", ["lore_page"], [
    row("1", "Horde", "Horde Horde Horde Horde Horde, the faction."),
    row("2", "Warlock trainers", "Horde warlock trainers teach each racial warlock."),
    row("3", "Gnome", "A small race."),
    // Found on the real release: "Saving the Best for Last (Horde)" led because "best" counted as a topic word.
    row("4", "Best Warlock Horde", "Best best warlock horde."),
  ]);
  expect(await search(db, "best racial warlock for horde")).toEqual([]);
  const names = (await searchSomeWords(db, "best racial warlock for horde")).map((h) => h.name);
  expect(names[0]).toBe("Warlock trainers");
  expect(names).toContain("Horde");
  expect(names).not.toContain("Gnome");
  expect(await searchSomeWords(db, "best racial warlock for horde", 1)).toHaveLength(1);
  expect(await searchSomeWords(db, "warlock horde", 10, { kinds: ["item"] })).toEqual([]);
  expect((await searchSomeWords(db, "best gnome")).map((h) => h.name)).toEqual(["Gnome"]);
  expect(await searchSomeWords(db, "best top")).toEqual([]);
});

test("a question typed without its apostrophe still finds the page", async () => {
  for (const q of ["whats Thunderfury", "wheres Thunderfury", "whos Thunderfury"]) expect((await search(await seed(), q))[0].name).toBe("Thunderfury");
});

test("a one-word query has no fallback: any word is every word", async () => {
  const db = await seed();
  expect(await searchSomeWords(db, "Thunderfury")).toEqual([]);
  expect(await searchSomeWords(db, "where is xyznothinghere")).toEqual([]);
});

test("the wiki's testing-only pages are left out of search, the rest still appear", async () => {
  const db = openDb(":memory:");
  const testing = { data: { categories: ["Testing-only content"], type: "quest" } };
  await replaceSourceRows(db, "warcraft-wiki-2023", ["lore_page"], [
    row("516836", "Omar's Test Quest", "Get Omar some cloth: Linen Cloth.", testing),
    row("470301", "Linen Cloth", "Linen Cloth is a cloth dropped by humanoids.", { data: { categories: ["Cloth"], type: "item" } }),
    row("37455", "Bolt of Linen Cloth", "Made from Linen Cloth."),
  ]);
  const names = (hits: { name: string }[]) => hits.map((h) => h.name);
  expect(names(await search(db, "Linen Cloth"))).toEqual(["Linen Cloth", "Bolt of Linen Cloth"]);
  expect(names(await search(db, "Linen Cloth", 10, { kinds: ["lore_page"] }))).not.toContain("Omar's Test Quest");
  // Asked for by name, through every search path: the exact-name pull and the some-words fallback.
  expect(await search(db, "Omar's Test Quest")).toEqual([]);
  expect(await search(db, "omar s test quest")).toEqual([]);
  expect(names(await searchSomeWords(db, "Omar cloth")).sort()).toEqual(["Bolt of Linen Cloth", "Linen Cloth"]);
  // The page stays in the archive: its own page and an exact lookup still find it.
  expect(names(await getByName(db, "Omar's Test Quest"))).toEqual(["Omar's Test Quest"]);
});
