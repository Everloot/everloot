import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { RaceTable, traitText, writeRaceTable } from "../src/client-races.js";
import { CLIENT_TABLES, writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "wowf", buildConfig: "7d8ae4cd9c1f639a3ea04fd47e21c746", buildId: 70634,
  version: "1.60.1.70634", extractedAt: "2026-10-27T18:15:44.450Z", library: "@rhyster/wow-casc-dbc@2.16.17",
  definitions: "50ce5d272897",
};
const table = (name: keyof typeof CLIENT_TABLES, rows: Record<string, unknown>[]): ExtractedTable =>
  ({ table: name, fileDataID: CLIENT_TABLES[name], cKey: null, encryptedBlocks: 0, rows: new Map(rows.map((r) => [r.ID as number, r])) });

const ability = (ID: number, ChrRacesID: number, Name_lang: string, Order: number, DescriptionShort_lang: string) =>
  ({ ID, ChrRacesID, Name_lang, Order, DescriptionShort_lang, Description_lang: "The long text.", Icon: 1 });

function snapshot(): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-races-"));
  const snap = join(dir, "client.sqlite");
  writeClientSnapshot(snap, meta, [
    table("ChrRaces", [
      { ID: 1, Name_lang: "Human", Alliance: 0, PlayableRaceBit: 0 },
      { ID: 2, Name_lang: "Orc", Alliance: 1, PlayableRaceBit: 1 },
      // Playable in the retail tables, but no class can be made with it in this build: left out.
      { ID: 9, Name_lang: "Goblin", Alliance: 1, PlayableRaceBit: 8 },
      // A creature race, not playable.
      { ID: 12, Name_lang: "Fel Orc", Alliance: 1, PlayableRaceBit: -1 },
      { ID: 96, Name_lang: "Windshaper Skyborne", Alliance: 1, PlayableRaceBit: 33 },
    ]),
    table("ChrClasses", [
      { ID: 1, Name_lang: "Warrior" }, { ID: 7, Name_lang: "Shaman" }, { ID: 9, Name_lang: "Warlock" },
    ]),
    table("CharBaseInfo", [
      { ID: 1, RaceID: 1, ClassID: 9 }, { ID: 2, RaceID: 1, ClassID: 1 },
      { ID: 7, RaceID: 2, ClassID: 9 }, { ID: 12, RaceID: 2, ClassID: 1 },
      { ID: 13, RaceID: 12, ClassID: 1 },
      { ID: 893, RaceID: 96, ClassID: 7 },
    ]),
    table("ChrRaceRacialAbility", [
      ability(681, 2, "Orc - Passive - Hardiness", 3, "|cnWHITE_FONT_COLOR:Hardiness (Passive):|r Stun durations decreased by 20%"),
      ability(678, 2, "Orc - Active - Blood Fury", 0, "|cnWHITE_FONT_COLOR:Blood Fury:|r Increases Attack Power and Spell Power by 10% for 15 sec"),
      ability(662, 1, "Human - Active - Will to Survive", 0, "|cnWHITE_FONT_COLOR:Will to Survive:|r Remove Stuns"),
      ability(695, 96, "Skyborne - Horde - Active - Skysight", 1, "|cnWHITE_FONT_COLOR:Skysight:|r Receive an Elemental Blessing increasing run speed by 10%"),
    ]),
  ]);
  return snap;
}

test("the race table is one build-stamped, labelled file: each playable race with its faction, classes and traits", () => {
  const dir = mkdtempSync(join(tmpdir(), "kb-races-out-"));
  const path = join(dir, "game-data", "races.json");
  const written = writeRaceTable(snapshot(), path);
  const file = RaceTable.parse(JSON.parse(readFileSync(path, "utf8")));
  expect(file).toEqual(written);
  expect(file).toMatchObject({
    schema: "everloot.races/1", label: "Found in game files, unconfirmed",
    build: { product: "wowf", buildId: 70634, version: "1.60.1.70634", buildConfig: "7d8ae4cd9c1f639a3ea04fd47e21c746", definitions: "50ce5d272897" },
  });
  expect(file.credit).toContain("WoWDBDefs");
  // A race no class can be made with (Goblin) and a creature race (Fel Orc) are not playable here.
  expect(file.races.map((r) => r.name)).toEqual(["Human", "Orc", "Windshaper Skyborne"]);
  expect(file.races[1]).toEqual({
    id: 2, name: "Orc", faction: "Horde",
    classes: [{ id: 1, name: "Warrior" }, { id: 9, name: "Warlock" }],
    traits: [
      { name: "Blood Fury", kind: "active", order: 0, description: "Increases Attack Power and Spell Power by 10% for 15 sec" },
      { name: "Hardiness", kind: "passive", order: 3, description: "Stun durations decreased by 20%" },
    ],
  });
  expect(file.races[0].faction).toBe("Alliance");
  // The faction part of a Skyborne trait's name goes with the prefix.
  expect(file.races[2]).toMatchObject({ faction: "Horde", classes: [{ id: 7, name: "Shaman" }], traits: [{ name: "Skysight", kind: "active", order: 1 }] });
});

test("a trait's short text loses the client's colour codes and the label that repeats its name", () => {
  expect(traitText("|cnWHITE_FONT_COLOR:Hardiness (Passive):|r Stun durations decreased by 20%", "Hardiness")).toBe("Stun durations decreased by 20%");
  expect(traitText("|cnWHITE_FONT_COLOR:Eureka!:|r Reduced cost", "Eureka!")).toBe("Reduced cost");
  // A label that is not the name stays, as plain text.
  expect(traitText("|cFFFFFFFFNote:|r Something", "Other")).toBe("Note: Something");
  expect(traitText("Plain text", "Other")).toBe("Plain text");
  expect(traitText(undefined, "Other")).toBe("");
});
