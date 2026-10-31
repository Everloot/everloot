import { expect, test } from "vitest";
import { answerSources, answerSourcesFactsFromRecords, formatAnswerSources, furtherReading, type AnswerSourcesFacts } from "../src/answer-sources.js";
import { openDb } from "../src/db.js";
import { SOME_WORDS } from "../src/search.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import { parseRecords } from "@everloot/protocol";

const row = (extId: string, name: string, body: string, extra: Partial<EntityInput> = {}): EntityInput => ({
  kind: "lore_page", extId, name, body, gameVersion: "lore", sourceUrl: `https://example.test/${extId}`, retrievedAt: "2023-11-13", ...extra,
});

async function seed() {
  const db = openDb(":memory:");
  await replaceSourceRows(db, "warcraft-wiki-2023", ["lore_page"], [
    row("thrall", "Thrall", "Thrall is the former Warchief of the Horde. He wielded the Doomhammer."),
    row("peacebloom", "Peacebloom", "Peacebloom is a herb found in starting zones."),
  ]);
  await replaceSourceRows(db, "curated", ["lore_page"], [
    row("forever-thrall", "Thrall in Forever", "In WoW: Forever, Thrall stands in Orgrimmar.", { gameVersion: "forever" }),
  ]);
  return db;
}

const base = { capturedAt: "2026-10-09T00:00:00Z" };
function facts(): AnswerSourcesFacts {
  const records: unknown[] = [];
  for (const [i, install] of ["install-a", "install-b", "install-c"].entries()) {
    records.push({ ...base, installId: install, eventId: `name-${i}`, kind: "item_seen", itemId: 1234, name: "Peacebloom", quality: "common" });
    records.push({ ...base, installId: install, eventId: `seen-${i}`, kind: "npc_sighting", npcId: 456, name: "Forest Spider", mapId: 141, x: 40 + i, y: 61, level: 5, reaction: "hostile", positionKind: "npc" });
    for (let k = 0; k < 4; k++) {
      records.push({ ...base, installId: install, eventId: `loot-${i}-${k}`, kind: "loot", sourceNpcId: 456, sourceEvidence: "loot-api", items: k === 0 ? [{ itemId: 1234, count: 1 }] : [] });
    }
  }
  const parsed = parseRecords(records);
  expect(parsed.receipt.rejected).toEqual([]);
  return answerSourcesFactsFromRecords(parsed.records);
}

test("observed facts come first with install counts, then lore; every piece has a source URL and a licence", async () => {
  const result = await answerSources(await seed(), { question: "Where does Peacebloom drop, and who is Thrall?", limit: 8 }, facts(), "2026-10-18T10:00:00Z");
  const kinds = result.evidence.map((e) => e.kind);
  expect(kinds.indexOf("observed")).toBe(0);
  expect(kinds).toContain("curated");
  expect(kinds).toContain("lore");
  expect(kinds.lastIndexOf("curated")).toBeLessThan(kinds.indexOf("lore"));
  const drop = result.evidence.find((e) => e.kind === "observed" && e.claim.includes("dropped from"))!;
  expect(drop.claim).toContain("Peacebloom dropped from NPC 456 Forest Spider in 3 of 12 loot windows");
  expect(drop).toMatchObject({ support: 3, licence: "CC BY-SA 4.0", asOf: "2026-10-18T10:00:00Z", source: { url: "https://everloot.app/database/items/1234" } });
  const thrall = result.evidence.find((e) => e.source.title === "Thrall")!;
  expect(thrall).toMatchObject({ kind: "lore", claim: "Thrall: Thrall is the former Warchief of the Horde.", licence: "CC-BY-SA-4.0", asOf: "2023-11-13" });
  for (const e of result.evidence) {
    expect(e.source.url).toMatch(/^https:\/\//);
    expect(e.licence.length).toBeGreaterThan(0);
  }
  expect(result.furtherReading.map((l) => l.site)).toEqual(["Warcraft Wiki", "Wowhead", "Icy Veins"]);
  const text = formatAnswerSources(result, true);
  expect(text).toContain("[observed in play, 3 installs]");
  expect(text).toContain("Further reading (links only, nothing fetched)");
});

test("a known NPC name gives its agreed position; a name that only part of a word matches is left alone", async () => {
  const result = await answerSources(await seed(), { question: "Where is the Forest Spider? Not the Spiderling.", limit: 5 }, facts(), null);
  const pin = result.evidence.find((e) => e.claim.startsWith("Forest Spider was seen"))!;
  expect(pin).toMatchObject({ kind: "observed", support: 3, source: { url: "https://everloot.app/database/npcs/456" } });
  expect(pin.claim).toContain("map 141 at 41, 61");
  expect(result.evidence.some((e) => e.claim.includes("Peacebloom"))).toBe(false);
});

test("a position names its zone when the game files have it, and keeps the map id when they do not", async () => {
  const files = { build: "1.60.1.70707", extractedAt: null, facts: [], zones: { 141: "Teldrassil" } };
  const named = await answerSources(await seed(), { question: "Where is the Forest Spider?", limit: 3 }, facts(), null, files);
  expect(named.evidence.find((e) => e.claim.startsWith("Forest Spider was seen"))!.claim).toBe("Forest Spider was seen in Teldrassil at 41, 61.");
  const unnamed = await answerSources(await seed(), { question: "Where is the Forest Spider?", limit: 3 }, facts(), null, { ...files, zones: {} });
  expect(unnamed.evidence.find((e) => e.claim.startsWith("Forest Spider was seen"))!.claim).toBe("Forest Spider was seen on map 141 at 41, 61.");
});

test("a name with nothing agreed yet is noted after every piece that answers, and never takes an answer's place", async () => {
  // Three installs agree on the item's name, and none has looted it: a known item with no drop source yet.
  const records: unknown[] = ["install-a", "install-b", "install-c"].map((installId, i) => (
    { ...base, installId, eventId: `hammer-${i}`, kind: "item_seen", itemId: 17182, name: "Doomhammer", quality: "legendary" }
  ));
  const parsed = parseRecords(records);
  expect(parsed.receipt.rejected).toEqual([]);
  const result = await answerSources(await seed(), { question: "Did Thrall carry the Doomhammer?", limit: 2 }, answerSourcesFactsFromRecords(parsed.records), null);
  expect(result.evidence.slice(0, 2).map((e) => e.kind).sort()).toEqual(["curated", "lore"]);
  expect(result.evidence).toHaveLength(3);
  expect(result.evidence[2]).toMatchObject({ kind: "observed", claim: expect.stringContaining("Doomhammer is a known item; no drop source has reached three installs yet") });
});

test("nothing found is said plainly, never invented; without the corpus, lore still answers and the text says observations are unrecorded", async () => {
  const empty = await answerSources(await seed(), { question: "xyzzy plugh", limit: 8 }, facts(), null);
  expect(empty.evidence).toEqual([]);
  expect(formatAnswerSources(empty, true)).toContain("No evidence found");
  const loreOnly = await answerSources(await seed(), { question: "Who is Thrall?", limit: 8 }, null, null);
  expect(loreOnly.evidence.map((e) => e.kind)).toEqual(["curated", "lore"]);
  expect(formatAnswerSources(loreOnly, false)).toContain("not connected here, so the observed layer is unrecorded, not empty");
});

test("a question no page answers in full gets the pages with some of its words, and the text says so first", async () => {
  // Found live: "whats the best racial class for warlock on horde" gave "No evidence found".
  const some = await answerSources(await seed(), { question: "whats the best warchief for horde mains", limit: 8 }, null, null);
  expect(some.someWords).toBe(true);
  expect(some.evidence.map((e) => e.source.url)).toContain("https://example.test/thrall");
  expect(formatAnswerSources(some, false).startsWith(SOME_WORDS)).toBe(true);
  const full = await answerSources(await seed(), { question: "Who is Thrall?", limit: 8 }, null, null);
  expect(full.someWords).toBeUndefined();
  expect(formatAnswerSources(full, false)).not.toContain(SOME_WORDS);
});

test("further-reading links are search URLs with the question encoded, and nothing for an empty question", () => {
  expect(furtherReading("Thrall & Jaina")[1].url).toBe("https://www.wowhead.com/search?q=Thrall%20%26%20Jaina");
  expect(furtherReading("   ")).toEqual([]);
});
