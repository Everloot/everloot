import { expect, test } from "vitest";
import { RACES } from "@/data/wow-forever";
import { gamePairs, RACE_TABLE, traitsFor } from "./race-traits";

/** Every pair one side has and the other lacks, in words, so a failure names the difference. */
function differences(article: Record<string, Record<string, readonly string[]>>, files: Record<string, Record<string, readonly string[]>>): string[] {
  const out: string[] = [];
  for (const faction of new Set([...Object.keys(article), ...Object.keys(files)])) {
    const a = article[faction] ?? {}, f = files[faction] ?? {};
    for (const race of new Set([...Object.keys(a), ...Object.keys(f)])) {
      if (!(race in f)) { out.push(`${faction} ${race}: in Blizzard's article, not in the game files`); continue; }
      if (!(race in a)) { out.push(`${faction} ${race}: in the game files, not in Blizzard's article`); continue; }
      for (const c of a[race]) if (!f[race].includes(c)) out.push(`${faction} ${race} ${c}: in Blizzard's article, not in the game files`);
      for (const c of f[race]) if (!a[race].includes(c)) out.push(`${faction} ${race} ${c}: in the game files, not in Blizzard's article`);
    }
  }
  return out;
}

test("the game files' race and class pairs agree with Blizzard's race and class article", () => {
  // Neither side is preferred: if a build or the article changes, this names each pair that differs.
  expect(differences(RACES.factions, gamePairs())).toEqual([]);
});

test("the comparison names a pair either side lacks", () => {
  const files = { Horde: { Orc: ["Warlock"], Goblin: ["Rogue"] } };
  const article = { Horde: { Orc: ["Warlock", "Mage"], Tauren: ["Druid"] } };
  expect(differences(article, files)).toEqual([
    "Horde Orc Mage: in Blizzard's article, not in the game files",
    "Horde Tauren: in Blizzard's article, not in the game files",
    "Horde Goblin: in the game files, not in Blizzard's article",
  ]);
});

test("each race in the article has its racial traits from the files, Skyborne on each faction its own", () => {
  for (const [faction, races] of Object.entries(RACES.factions)) for (const race of Object.keys(races)) {
    expect(traitsFor(faction, race).length, `${faction} ${race}`).toBeGreaterThan(0);
  }
  expect(traitsFor("Horde", "Skyborne").map((t) => t.name)).toContain("Skysight");
  expect(traitsFor("Alliance", "Skyborne").map((t) => t.name)).toContain("Read Leyline");
  expect(traitsFor("Horde", "Human")).toEqual([]);
  // Descriptions are plain words: no colour codes left from the client.
  for (const r of RACE_TABLE.races) for (const t of r.traits) expect(t.description, t.name).not.toMatch(/\|c|\|r/);
});
