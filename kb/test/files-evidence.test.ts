import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { answerSources } from "../src/answer-sources.js";
import { openDb } from "../src/db.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import { buildFilesIndex, filesEvidence, readFilesIndex } from "../src/files-evidence.js";

// SYNTHETIC files in the shape of web/src/data/game-data; the names are made up.
const files = {
  map: {
    source: { version: "1.0.0.70634", extractedAt: "2026-10-27T08:00:00.000Z" },
    continents: [{ id: 0, name: "Synthetic Kingdoms" }],
    zones: [{ uiMapId: 1429, name: "Synthetic Forest", continentId: 0 }],
    entrances: [{ mapId: 34, name: "Synthetic Stockade", raid: false, uiMapId: 1429, minLevel: 17, maxLevel: 24 }, { mapId: 34, name: "Synthetic Stockade", raid: false, uiMapId: 1429 }, { mapId: 409, name: "Molten Core", raid: true, uiMapId: 9999, minLevel: 60, maxLevel: 60 }],
    heldBackZones: [{ uiMapId: 2548, name: "Synthetic Shore" }],
    flightNodes: [
      { id: 2, name: "Synthetic Keep, Synthetic Forest", uiMapId: 1429 },
      { id: 3, name: "Synthetic Port, Synthetic Shore", uiMapId: 2548 },
      { id: 4, name: "Synthetic Camp, Synthetic Wilds", uiMapId: 77 },
    ],
  },
  encounters: { build: { version: "1.0.0.70634" }, instances: { "34": [{ id: 1, name: "Synthetic Warden" }, { id: 2, name: "Synthetic Stockade" }] } },
  mounts: { build: { version: "1.0.0.70634" }, mounts: { "6": { name: "Synthetic Horse", spellId: 458, ridingSkill: 75 }, "7": { name: "Synthetic Wolf", spellId: 459 } } },
  achievements: { build: { version: "1.0.0.70634" }, achievements: { "49": { title: "Storm the Chasm", points: 10, description: "secret text", criteria: [{ text: "secret criterion" }, { text: "another" }] }, "50": { title: "Synthetic victories", points: 0, criteria: [{ text: "secret count" }], statistic: true } } },
  talents: {
    mage: { build: { version: "1.0.0.70634" }, className: "Mage", trees: [{ name: "Fire", nodes: [{ entries: [{ spellId: 9, name: "Synthetic Blast", maxRanks: 5 }] }] }] },
    priest: { build: { version: "1.0.0.70634" }, className: "Priest", trees: [{ name: "Holy", nodes: [{ entries: [{ spellId: 10, name: "Synthetic Blast", maxRanks: 2 }] }] }] },
  },
};

test("buildFilesIndex: one fact per thing, ids and facts only, the build stamped, no file text", () => {
  const index = buildFilesIndex(files);
  expect(index.build).toBe("1.0.0.70634");
  expect(index.extractedAt).toBe("2026-10-27T08:00:00.000Z");
  const byKind = (kind: string) => index.facts.filter((f) => f.kind === kind);
  expect(byKind("zone")).toEqual([{ kind: "zone", name: "Synthetic Forest", claim: "Synthetic Forest: a zone of Synthetic Kingdoms, in the game files.", url: "https://everloot.app/database/zones/1429-synthetic-forest" }]);
  // Two entrance pins of one instance give one fact; the level, the zone and the encounters in order are in it.
  expect(byKind("instance").map((f) => f.claim)).toEqual([
    "Synthetic Stockade: a dungeon, levels 17 to 24, entered from Synthetic Forest; the files list 2 encounters: Synthetic Warden, Synthetic Stockade.",
    "Molten Core: a raid, level 60.",
  ]);
  expect(byKind("instance")[0]!.url).toBe("https://everloot.app/database/instances/34-synthetic-stockade");
  expect(byKind("boss").map((f) => f.claim)).toEqual(["Synthetic Warden: encounter 1 of 2 in Synthetic Stockade, in the game files.", "Synthetic Stockade: encounter 2 of 2 in Synthetic Stockade, in the game files."]);
  // A node in a held-back zone is left out, name and all; one on a map the zone list lacks names no zone.
  expect(byKind("flight")).toEqual([
    { kind: "flight", name: "Synthetic Keep", claim: "Synthetic Keep: a flight master in Synthetic Forest, in the game files.", url: "https://everloot.app/map" },
    { kind: "flight", name: "Synthetic Camp", claim: "Synthetic Camp: a flight master, in the game files.", url: "https://everloot.app/map" },
  ]);
  expect(JSON.stringify(index)).not.toContain("Synthetic Port");
  expect(JSON.stringify(index)).not.toContain("Synthetic Shore");
  expect(byKind("mount").map((f) => f.claim)).toEqual(["Synthetic Horse: a mount (id 6), riding skill 75, taught by spell 458, in the game files.", "Synthetic Wolf: a mount (id 7), taught by spell 459, in the game files."]);
  // The achievement's description and criteria text never leave the page.
  const ach = byKind("achievement")[0]!;
  expect(ach.claim).toBe("Storm the Chasm: an achievement, 10 points, 2 criteria; the criteria text is on its page.");
  // A statistic is said to be one, not an achievement to earn.
  expect(byKind("achievement")[1]!.claim).toBe("Synthetic victories: a statistic the game keeps (a counter, not an achievement to earn); the criteria text is on its page.");
  expect(JSON.stringify(index)).not.toContain("secret");
  expect(ach.url).toBe("https://everloot.app/database/achievements/49-storm-the-chasm");
  expect(byKind("talent")).toEqual([
    { kind: "talent", name: "Synthetic Blast", claim: "Synthetic Blast: a Mage talent in the Fire tree, up to 5 ranks, in the game files.", url: "https://everloot.app/tools/talents/mage" },
    { kind: "talent", name: "Synthetic Blast", claim: "Synthetic Blast: a Priest talent in the Holy tree, up to 2 ranks, in the game files.", url: "https://everloot.app/tools/talents/priest" },
  ]);
  expect(buildFilesIndex({})).toEqual({ build: "", extractedAt: null, facts: [] });
});

test("filesEvidence: whole-word mentions, longest names first, one per thing, labelled and credited; nothing for an empty index", () => {
  const index = buildFilesIndex(files);
  const found = filesEvidence("where is the Synthetic Stockade entrance and who is Synthetic Warden", index, 8);
  expect(found.map((e) => e.claim.split(":")[0])).toEqual(["Synthetic Stockade", "Synthetic Stockade", "Synthetic Warden"]);
  expect(found.every((e) => e.kind === "files")).toBe(true);
  expect(found[0]!.source.title).toBe("WoW: Forever game files, build 1.0.0.70634 (Found in game files, unconfirmed)");
  expect(found[0]!.licence).toContain("Blizzard");
  expect(found[0]!.asOf).toBe("2026-10-27T08:00:00.000Z");
  // "Stockade" alone is not "Synthetic Stockade"; a substring inside a word is not a mention; the limit holds.
  expect(filesEvidence("the stockade", index, 8)).toEqual([]);
  expect(filesEvidence("Synthetic Forestry", index, 8)).toEqual([]);
  expect(filesEvidence("Synthetic Horse and Synthetic Wolf", index, 1)).toHaveLength(1);
  expect(filesEvidence("Synthetic Horse", null, 8)).toEqual([]);
  // A name two things share gives both: the talent is the Mage's and the Priest's.
  expect(filesEvidence("which class has Synthetic Blast", index, 8).map((e) => e.claim.split(":")[1]!.split(" talent")[0])).toEqual([" a Mage", " a Priest"]);
  // A short form names its page here too: "MC" is Molten Core.
  expect(filesEvidence("where is MC", index, 8).map((e) => e.claim)).toEqual(["Molten Core: a raid, level 60."]);
});

test("readFilesIndex: the same index from the files on disk, missing files left out", () => {
  const dir = mkdtempSync(join(tmpdir(), "kb-files-"));
  writeFileSync(join(dir, "map.json"), JSON.stringify(files.map));
  writeFileSync(join(dir, "client-mounts.json"), JSON.stringify(files.mounts));
  mkdirSync(join(dir, "talents"));
  writeFileSync(join(dir, "talents", "mage.json"), JSON.stringify(files.talents.mage));
  const index = readFilesIndex(dir);
  expect(index.facts.map((f) => f.kind)).toEqual(["zone", "instance", "instance", "flight", "flight", "mount", "mount", "talent"]);
  expect(readFilesIndex(mkdtempSync(join(tmpdir(), "kb-files-empty-"))).facts).toEqual([]);
});

const row = (extId: string, name: string, body: string): EntityInput => ({
  kind: "lore_page", extId, name, body, gameVersion: "lore", sourceUrl: `https://example.test/${extId}`, retrievedAt: "2023-11-13",
});

test("answerSources: the files' facts come after curated and before lore, and a question the wiki cannot answer still has evidence", async () => {
  const db = openDb(":memory:");
  await replaceSourceRows(db, "warcraft-wiki-2023", ["lore_page"], [row("stockade", "Synthetic Stockade", "The Synthetic Stockade is a dungeon under the keep.")]);
  const index = buildFilesIndex(files);
  const result = await answerSources(db, { question: "where is the Synthetic Stockade entrance", limit: 8 }, null, null, index);
  expect(result.evidence.map((e) => e.kind)).toEqual(["files", "files", "lore"]);
  // An achievement only the files know.
  const only = await answerSources(db, { question: "how do I get Storm the Chasm", limit: 8 }, null, null, index);
  expect(only.evidence.map((e) => e.kind)).toEqual(["files"]);
  expect(only.evidence[0]!.url).toBe("https://everloot.app/database/achievements/49-storm-the-chasm");
  // Without an index nothing changes.
  expect((await answerSources(db, { question: "how do I get Storm the Chasm", limit: 8 }, null, null)).evidence).toEqual([]);
});
