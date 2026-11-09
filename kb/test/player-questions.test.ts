import { expect, test } from "vitest";
import { answerSources, formatAnswerSources } from "../src/answer-sources.js";
import { openDb } from "../src/db.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import { buildFilesIndex } from "../src/files-evidence.js";
import { d1ReleaseDb, type D1Like } from "../src/release-db.js";
import { respell, search, SOME_WORDS } from "../src/search.js";

/**
 * Questions as players type them in the chat, without a model: typos, names run together, and asks the wiki
 * pages alone answer badly. SYNTHETIC rows in the shape of the release; the bodies are made up.
 */
const row = (extId: string, name: string, body: string): EntityInput => ({
  kind: "lore_page", extId, name, body, gameVersion: "lore", sourceUrl: `https://example.test/${extId}`, retrievedAt: "2023-11-13",
});

async function seed() {
  const db = openDb(":memory:");
  await replaceSourceRows(db, "warcraft-wiki-2023", ["lore_page"], [
    row("tb", "Thunder Bluff", "Thunder Bluff is the tauren capital city in Mulgore. Wind riders fly from the bluff."),
    row("zephyr", "The Zephyr", "The Zephyr is a zeppelin that carries players between Orgrimmar and Thunder Bluff. It docks at the western tower."),
    row("fair-trade", "A Fair Trade", "I am Kolark, Bounty Hunter from Thunderbluff. Bring me the heads."),
    row("hogger", "Hogger", "Hogger is an elite gnoll in Elwynn Forest. He roams the hills near Goldshire. Hogger fights with his claws. Model updated."),
    row("hogger-trousers", "Hogger's Trousers", "Leg armor named after the gnoll Hogger."),
    row("mankrik-wife", "Mankrik's Wife", "Olgra is the wife of Mankrik, found in the Barrens."),
    row("api", "API C_MountJournal.GetMountInfo", "Returns where a mount is learned and how to get a mount."),
    row("machinima", "Dude, Where's My Mount?/Dave", "Dave wants to get his mount back in this machinima."),
    row("riding", "Riding", "Riding lets a character use a mount. Get riding from a riding trainer."),
    row("makaru", "Makaru", "Makaru is an orc mining trainer located in the Valley of Honor in Orgrimmar."),
    row("mining", "Mining", "Mining is a gathering profession. Orgrimmar miners learn from the city's trainers and sell ore."),
    row("guard", "Highmountain Warrior (Thunder Bluff)", "A guard of Thunder Bluff, seen at the gates of Orgrimmar."),
    row("guide", "Thunder Bluff to Orgrimmar travel guide", "The way from Thunder Bluff to Orgrimmar, and back."),
    row("linen", "Linen Cloth", "Linen Cloth is a cloth that humanoids around level 5 to 15 drop. Some beasts also drop linen cloth and can be skinned."),
    row("org", "Orgrimmar", "Orgrimmar is the capital city of the Horde, in Durotar."),
    // One page carries the typo; many carry the word.
    row("exe", "Exe", "A forum post: at my level, in the scarlet monestary a staff drops."),
    row("sm", "Scarlet Monastery", "The Scarlet Monastery is a dungeon complex in Tirisfal Glades for players around level 30."),
    ...Array.from({ length: 11 }, (_, i) => row(`monk-${i}`, `Scarlet Monk ${i}`, `A monk of the monastery, number ${i}.`)),
    row("infantry", "Stormwind Infantry (Stormwind City)", "Stormwind Infantries are humans located in Stormwind City."),
    // A rare name one letter from a common word.
    row("sneed", "Sneed", "Sneed is a goblin lumberjack boss."),
    ...Array.from({ length: 11 }, (_, i) => row(`seed-${i}`, `Seed Pouch ${i}`, `A pouch with a seed, number ${i}.`)),
  ]);
  return db;
}

const files = buildFilesIndex({
  map: {
    source: { version: "1.0.0.70634", extractedAt: "2026-10-27T08:00:00.000Z" },
    continents: [{ id: 1, name: "Kalimdor" }],
    zones: [{ uiMapId: 1456, name: "Thunder Bluff", continentId: 1 }, { uiMapId: 1411, name: "Durotar", continentId: 1 }, { uiMapId: 1453, name: "Stormwind City", continentId: 0 }],
    entrances: [
      { mapId: 389, name: "Ragefire Chasm", raid: false, uiMapId: 1411, minLevel: 13, maxLevel: 13 },
      { mapId: 36, name: "Deadmines", raid: false, minLevel: 16, maxLevel: 16 },
      { mapId: 43, name: "Wailing Caverns", raid: false, minLevel: 17, maxLevel: 17 },
      { mapId: 34, name: "Stormwind Stockade", raid: false, minLevel: 23, maxLevel: 23 },
      { mapId: 189, name: "Scarlet Monastery", raid: false, minLevel: 30, maxLevel: 30 },
      { mapId: 409, name: "Molten Core", raid: true, minLevel: 60, maxLevel: 60 },
    ],
    flightNodes: [{ id: 22, name: "Thunder Bluff, Mulgore", uiMapId: 1456 }],
  },
});

const ask = async (question: string) => {
  const result = await answerSources(await seed(), { question, limit: 3 }, null, null, files);
  return { result, text: formatAnswerSources(result, true) };
};

test("a misspelled word and a name run together are read as the words the pages use, and the answer says so", async () => {
  const db = await seed();
  expect(await respell(db, "does thunderbluff have a zeppeling?")).toEqual({
    text: "does thunder bluff have a zeppelin?",
    changes: [{ from: "thunderbluff", to: "thunder bluff" }, { from: "zeppeling", to: "zeppelin" }],
  });
  const { result, text } = await ask("does thunderbluff have a zeppeling?");
  expect(result.evidence[0]!.claim).toBe("The Zephyr: The Zephyr is a zeppelin that carries players between Orgrimmar and Thunder Bluff.");
  expect(text.split("\n")[0]).toBe('Read "thunderbluff" as "thunder bluff" and "zeppeling" as "zeppelin".');
  expect(text).not.toContain(SOME_WORDS);
});

test("words already in the pages are left alone, and nothing to change gives null", async () => {
  const db = await seed();
  expect(await respell(db, "where is hogger")).toBeNull();
  expect(await respell(db, "zzzzqqq")).toBeNull();
  // A word that is itself on the pages is not split, even when its halves are words too.
  expect(await respell(db, "zephyr")).toBeNull();
  // A name a page title carries is never read as the common word beside it ("Sneed" is not "seed").
  expect(await respell(db, "where is sneed")).toBeNull();
  // Words the caller keeps (the game files' names, which the 2023 pages may lack) are never read another way.
  expect(await respell(db, "where is sneedx")).toEqual({ text: "where is sneed", changes: [{ from: "sneedx", to: "sneed" }] });
  expect(await respell(db, "where is sneedx", new Set(["sneedx"]))).toBeNull();
});

test("a flight master named like the place asked about is part of the answer, in English and Spanish", async () => {
  const where = await ask("where is thunder bluff");
  expect(where.result.evidence.map((e) => e.claim)).toContain("Thunder Bluff: a flight master in Thunder Bluff, in the game files.");
  const fly = await ask("cómo vuelo a Thunder Bluff");
  expect(fly.result.evidence.map((e) => e.claim)).toContain("Thunder Bluff: a flight master in Thunder Bluff, in the game files.");
  const level = await ask("de qué nivel es Durotar");
  expect(level.result.evidence[0]!.claim).toBe("Durotar: a zone of Kalimdor, in the game files.");
});

test("an apostrophe left out of a name finds the page, and the reading is shown with it", async () => {
  const { result, text } = await ask("where is mankriks wife");
  expect(result.evidence[0]!.source.title).toBe("Mankrik's Wife");
  expect(text.split("\n")[0]).toBe(`Read "mankriks" as "mankrik's".`);
});

test("where to learn a skill finds its trainer, and a title with every asked word comes before one with some", async () => {
  const learn = await ask("where do i learn mining in orgrimmar");
  expect(learn.result.evidence[0]!.claim).toBe("Makaru: Makaru is an orc mining trainer located in the Valley of Honor in Orgrimmar.");
  const travel = await ask("how do i get from orgrimmar to thunder bluff");
  expect(travel.result.evidence[0]!.source.title).toBe("Thunder Bluff to Orgrimmar travel guide");
});

test("a page the question names opens with its first sentence even when other words were asked", async () => {
  const { result } = await ask("where does linen cloth drop");
  expect(result.evidence[0]!.claim).toBe("Linen Cloth: Linen Cloth is a cloth that humanoids around level 5 to 15 drop.");
});

test("the page named in the question opens with its first sentence, not a fragment from the middle", async () => {
  const [hit] = await search(await seed(), "where is hogger", 3);
  expect(hit!.name).toBe("Hogger");
  expect(hit!.snippet.startsWith("Hogger is an elite gnoll in Elwynn Forest.")).toBe(true);
  const { result } = await ask("where is hogger");
  expect(result.evidence[0]!.claim).toBe("Hogger: Hogger is an elite gnoll in Elwynn Forest.");
});

test("addon API pages and wiki subpages stay out of a player's answer unless the question names them", async () => {
  const { result } = await ask("how do i get my mount");
  const titles = result.evidence.map((e) => e.source.title);
  expect(titles).toContain("Riding");
  expect(titles.some((t) => t.startsWith("API ") || t.includes("/"))).toBe(false);
  const named = await ask("what is API C_MountJournal.GetMountInfo");
  expect(named.result.evidence.map((e) => e.source.title)).toContain("API C_MountJournal.GetMountInfo");
});

test("a flight master is evidence only when the question is about flying; a zone the question is not about comes after the answer", async () => {
  const zeppelin = await ask("where is the zeppelin in thunder bluff");
  expect(zeppelin.result.evidence.map((e) => e.claim)).not.toContain("Thunder Bluff: a flight master in Thunder Bluff, in the game files.");
  expect(zeppelin.result.evidence[0]!.source.title).toBe("The Zephyr");
  const fly = await ask("how do i fly to thunder bluff");
  expect(fly.result.evidence.map((e) => e.claim)).toContain("Thunder Bluff: a flight master in Thunder Bluff, in the game files.");
  // The place itself asked about keeps its fact first.
  const place = await ask("where is thunder bluff");
  expect(place.result.evidence[0]!.claim).toBe("Thunder Bluff: a zone of Kalimdor, in the game files.");
});

test("a dungeon for a level is answered from the levels the game files give, nearest first, raids only when asked", async () => {
  const { result } = await ask("what dungeon should i do at level 20?");
  expect(result.evidence[0]).toMatchObject({
    kind: "files",
    claim: "Dungeons near level 20, by the level each entrance gives in the game files: Wailing Caverns (17), Stormwind Stockade (23), Deadmines (16), Ragefire Chasm (13).",
    url: "https://everloot.app/database/instances",
  });
  // The list is the answer: archive pages that only share the words are not added under it.
  expect(result.evidence.filter((e) => e.kind === "lore")).toEqual([]);
  const raid = await ask("best raid for lvl 60");
  expect(raid.result.evidence[0]!.claim).toBe("Raids near level 60, by the level each entrance gives in the game files: Molten Core (60).");
  const none = await ask("how do i level up fast");
  expect(none.result.evidence.some((e) => e.claim.includes("near level"))).toBe(false);
  // Past the game's range the answer says so, with the range, instead of pages that share the words.
  const past = await ask("dungeons for level 70");
  expect(past.result.evidence.map((e) => e.claim)).toEqual([
    "No dungeon in the game files is near level 70: their entrances give levels from 13 (Ragefire Chasm) to 30 (Scarlet Monastery).",
  ]);
});

test("a missing double letter is found, and a typo one page shares gives way to the spelling many pages use", async () => {
  const org = await ask("where is orgrimar");
  expect(org.result.evidence[0]!.source.title).toBe("Orgrimmar");
  expect(org.text.split("\n")[0]).toBe('Read "orgrimar" as "orgrimmar".');
  const sm = await ask("what level is scarlet monestary");
  expect(sm.result.evidence.map((e) => e.source.title)).not.toContain("Exe");
  expect(sm.result.evidence.map((e) => e.claim)).toContain("Scarlet Monastery: a dungeon, level 30.");
});

/**
 * better-sqlite3 behind D1's surface, refusing what production D1 refuses: a compound SELECT of more than five terms
 * (measured on the live database 2026-11-06; the docs list no number) and more than 100 bound parameters.
 */
function d1Limits(db: Awaited<ReturnType<typeof seed>>): D1Like {
  const check = (sql: string, values: unknown[]) => {
    const terms = (sql.match(/\b(?:UNION|INTERSECT|EXCEPT)\b/giu) ?? []).length + 1;
    if (terms > 5) throw new Error(`D1_ERROR: too many terms in compound SELECT (${terms})`);
    if (values.length > 100) throw new Error(`D1_ERROR: too many SQL variables (${values.length})`);
  };
  return {
    prepare: (sql) => ({
      bind: (...values) => ({
        all: async <T>() => (check(sql, values), { results: db.prepare(sql).all(...values) as T[] }),
        first: async <T>() => (check(sql, values), (db.prepare(sql).get(...values) as T | undefined) ?? null),
      }),
    }),
  };
}

test("the player questions read the same through D1's statement limits", async () => {
  const db = await seed();
  const d1 = d1ReleaseDb(d1Limits(db));
  for (const question of [
    "does thunderbluff have a zeppeling?", "where is orgrimar", "what level is scarlet monestary", "where do i learn mining in orgrimmar",
    "where is mankriks wife", "where is hogger", "where does linen cloth drop", "what dungeon should i do at level 30", "where is sneedx",
  ]) {
    const viaD1 = await answerSources(d1, { question, limit: 3 }, null, null, files);
    const viaFile = await answerSources(db, { question, limit: 3 }, null, null, files);
    expect(viaD1, question).toEqual(viaFile);
  }
  expect(await respell(d1, "does thunderbluff have a zeppeling?")).toMatchObject({ text: "does thunder bluff have a zeppelin?" });
});

test("the city a player calls by its first word is the zone the files name in full", async () => {
  const { result } = await ask("where is stormwind");
  expect(result.evidence[0]!.claim).toBe("Stormwind City: a zone, in the game files.");
});
