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

test("the traits shown follow Blizzard's October 26 racial pass where the game files still hold the old ones", () => {
  const byName = (faction: string, race: string) => Object.fromEntries(traitsFor(faction, race).map((t) => [t.name, t]));
  const dwarf = byName("Alliance", "Dwarf");
  expect(dwarf["Earth Fury"]).toBeUndefined();
  expect(dwarf["Artisan's Precision"]).toMatchObject({ kind: "passive", description: "Increases hit chance with spells and attacks by 1%", fromNotes: true });
  const orc = byName("Horde", "Orc");
  expect(orc.Savage).toBeUndefined();
  expect(orc.Command).toMatchObject({ kind: "passive", description: "Increases Warlock and Hunter pet damage by 5%" });
  const human = byName("Alliance", "Human");
  expect(human.Ruthless.description).toBe("Increases spell and ability critical chance by 1%");
  expect(human["The Human Spirit"].description).toBe("10% increased Spirit");
  const tauren = byName("Horde", "Tauren");
  expect(tauren.Plainsrunning.description).toContain("2% movement speed per stack");
  expect(tauren.Plainsrunning.description).toContain("up to 60%");
  expect(tauren.Plainsrunning.description).toContain("No longer increases mounted speed");
  expect(tauren.Endurance.description).toBe("Total Health increased by 5%");
  expect(byName("Horde", "Troll").Berserking.description).toContain("for 15 sec");
  for (const faction of ["Alliance", "Horde"]) expect(byName(faction, "Skyborne")["Wind Blessed"].description).toMatch(/^2% /);
  expect(byName("Alliance", "Skyborne")["Read Leyline"].description).toContain("by 50% for 15 sec");
  expect(byName("Alliance", "Skyborne")["Read Leyline"].description).toContain("Attuned for 1 hour, raising it to 100%");
  expect(byName("Horde", "Skyborne").Skysight.description).toContain("by 15% for 15 sec");
  expect(byName("Horde", "Skyborne").Skysight.description).toContain("Charged for 1 hour, raising it to 30%");
  // Traits the notes leave alone keep the files' text and no mark; the files themselves are untouched.
  expect(byName("Alliance", "Night Elf").Quickness.fromNotes).toBeUndefined();
  expect(RACE_TABLE.races.find((r) => r.name === "Dwarf")?.traits.map((t) => t.name)).toContain("Earth Fury");
});
