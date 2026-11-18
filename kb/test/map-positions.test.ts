import { describe, expect, test } from "vitest";
import { observedEdges } from "../src/edges.js";
import { agreedGatherKinds, agreedObjectNames, gatherSkillRanges, objectSpawnRowsFromRecords, objectSpawns, parseSpawnKey, skillRange, spawnKey, type ObjectSpawnRow } from "../src/object-spawns.js";
import { npcPage, npcRoles, worldFactsFromRecords } from "../src/world-pages.js";

const sighting = (installId: string, positionKind: unknown, extra: Record<string, unknown> = {}) => ({
  kind: "npc_sighting", installId, capturedAt: "2026-10-21T00:00:00Z", npcId: 3158, name: "Duokna", mapId: 1411, x: 51.2, y: 42.8,
  level: 15, reaction: "friendly", positionKind, ...extra,
});

describe("NPC pins from service windows", () => {
  test("interaction rows place a pin like npc rows; player rows never do, mixed or alone", () => {
    const interaction = ["a", "b", "c"].map((i) => sighting(i, "interaction", { role: "vendor" }));
    expect(npcPage(3158, worldFactsFromRecords(interaction)).pins).toEqual([{ mapId: 1411, x: 51.2, y: 42.8, reporters: 3 }]);
    const mixed = [sighting("a", "npc"), sighting("b", "interaction"), sighting("c", "interaction")];
    expect(npcPage(3158, worldFactsFromRecords(mixed)).pins).toHaveLength(1);
    // Legacy targeting rows: never a pin, not even as the third install next to two interaction rows.
    const players = ["a", "b", "c", "d", "e"].map((i) => sighting(i, "player"));
    expect(npcPage(3158, worldFactsFromRecords(players)).pins).toEqual([]);
    const two = [sighting("a", "interaction"), sighting("b", "interaction"), sighting("c", "player"), sighting("d", "player")];
    expect(npcPage(3158, worldFactsFromRecords(two)).pins).toEqual([]);
    // One or two installs never make a pin, however many rows they send.
    const few = [sighting("a", "interaction"), sighting("a", "interaction"), sighting("b", "interaction"), sighting("b", "interaction")];
    expect(npcPage(3158, worldFactsFromRecords(few)).pins).toEqual([]);
  });

  test("an interaction row places the NPC in its zone for the located-in relation; a player row does not", () => {
    const zoneEdges = (kind: string) => observedEdges(["a", "b", "c"].map((i) => sighting(i, kind)), "2026-10-22T00:00:00Z").filter((e) => e.toKind === "zone");
    expect(zoneEdges("interaction")).toHaveLength(1);
    expect(zoneEdges("player")).toHaveLength(0);
  });

  test("an NPC's roles are those 3 installs saw at its windows, and only from interaction rows", () => {
    const rows = [
      ...["a", "b", "c"].map((i) => sighting(i, "interaction", { role: "questgiver" })),
      ...["a", "b", "c"].map((i) => sighting(i, "interaction", { role: "vendor" })),
      sighting("d", "interaction", { role: "trainer" }), sighting("e", "interaction", { role: "trainer" }),
      ...["f", "g", "h"].map((i) => sighting(i, "player", { role: "banker" })),
      ...["f", "g", "h"].map((i) => sighting(i, "interaction", { role: "blacksmith" })),
    ];
    const facts = worldFactsFromRecords(rows);
    expect(facts.npcs.filter((r) => r.positionKind === "player").every((r) => r.role === undefined)).toBe(true);
    expect(npcRoles(facts.npcs)).toEqual(["vendor", "questgiver"]);
  });

  test("older rows without a position kind or role still parse and still name the NPC", () => {
    const old = ["a", "b", "c"].map((i) => ({ kind: "npc_sighting", installId: i, npcId: 3158, name: "Duokna", mapId: 1411, x: 51, y: 43 }));
    const facts = worldFactsFromRecords(old);
    expect(facts.npcs).toHaveLength(3);
    expect(npcPage(3158, facts)).toEqual({ npcId: 3158, name: "Duokna", pins: [] });
    expect(npcRoles(facts.npcs)).toEqual([]);
  });
});

const herb = (installId: string, x: number, y: number, extra: Partial<ObjectSpawnRow> = {}): ObjectSpawnRow =>
  ({ installId, objectId: 1618, mapId: 1411, x, y, gatherKind: "herb", ...extra });

describe("object spawn points", () => {
  const firstPin = "obj1618-1411-52.5_43.0";

  test("positions closer than 1.0 join one cluster, which is a pin at 3 distinct installs", () => {
    const rows = [herb("a", 52.4, 43.1), herb("b", 52.6, 42.9), herb("c", 52.5, 43.2), herb("d", 60, 60), herb("e", 60.3, 60.1)];
    const { pins, unconfirmed } = objectSpawns(rows);
    expect(pins).toEqual([{ key: firstPin, objectId: 1618, mapId: 1411, x: 52.5, y: 43.1, reporters: 3 }]);
    // The second spawn point has 2 installs: counted, never placed.
    expect(unconfirmed).toEqual([{ objectId: 1618, mapId: 1411, clusters: 1 }]);
  });

  test("1 or 2 installs never make a pin, however many rows they send", () => {
    const rows = [herb("a", 30, 30), herb("a", 30.1, 30), herb("a", 30.2, 30), herb("b", 30, 30.1), herb("b", 30.1, 30.1), herb("b ", 30, 30.2)];
    expect(objectSpawns(rows)).toEqual({ pins: [], unconfirmed: [{ objectId: 1618, mapId: 1411, clusters: 1 }] });
  });

  test("positions 1.0 or more apart are separate spawn points", () => {
    const at = (x: number) => ["a", "b", "c"].map((i) => herb(i, x, 50));
    const { pins } = objectSpawns([...at(20), ...at(21)]);
    expect(pins.map((p) => p.key)).toEqual(["obj1618-1411-20.0_50.0", "obj1618-1411-21.0_50.0"]);
  });

  test("ids and maps are clustered apart, fishing is never a pin, malformed rows are skipped", () => {
    const three = (extra: Partial<ObjectSpawnRow>) => ["a", "b", "c"].map((i) => herb(i, 40, 40, extra));
    const { pins } = objectSpawns([
      ...three({}), ...three({ objectId: 1731, gatherKind: "ore" }), ...three({ mapId: 1412 }),
      ...three({ objectId: 35591, gatherKind: "fishing" }),
      herb("d", 40, 140), herb("e", Number.NaN, 40), herb("", 40, 40), herb("f", 40, 40, { mapId: -1 }), { installId: "g", objectId: 1618 },
    ]);
    expect(pins.map((p) => [p.key, p.reporters])).toEqual([
      ["obj1618-1411-40.0_40.0", 3], ["obj1618-1412-40.0_40.0", 3], ["obj1731-1411-40.0_40.0", 3],
    ]);
  });

  test("fishing is never a pin: the bobber, and an object installs agree is fished, even on rows with no kind", () => {
    const at = (objectId: number, extra: Partial<ObjectSpawnRow> = {}) => ["a", "b", "c"].map((i) => herb(i, 40, 40, { objectId, gatherKind: undefined, ...extra }));
    const { pins, unconfirmed } = objectSpawns([
      ...at(35591), // the bobber, its kind lost to a slow bite
      ...["d", "e", "f"].map((i) => herb(i, 1, 1, { objectId: 180582, gatherKind: "fishing" })), ...at(180582), // a pool
      ...at(1618),
    ]);
    expect(pins.map((p) => p.objectId)).toEqual([1618]);
    expect(unconfirmed).toEqual([]);
  });

  test("a cluster's centre weighs installs, not rows: one install's many rows cannot drag it away", () => {
    const many = Array.from({ length: 20 }, () => herb("z", 51.1, 50));
    const rows = [...many, herb("a", 52, 50), herb("b", 52, 50), herb("c", 52, 50), herb("d", 52.6, 50)];
    // Weighted by rows the centre would sit near 51.2 and the install at 52.6 would start a cluster of its own.
    const { pins, unconfirmed } = objectSpawns(rows);
    expect(pins).toHaveLength(1);
    expect(pins[0]!.reporters).toBe(5);
    expect(unconfirmed).toEqual([]);
  });

  test("the result does not depend on the order rows arrive in", () => {
    const rows = [herb("a", 10, 10), herb("b", 10.5, 10.2), herb("c", 10.9, 10.4), herb("d", 11.6, 10.6), herb("e", 12.2, 10.8), herb("f", 12.9, 11)];
    const expected = objectSpawns(rows);
    expect(objectSpawns([...rows].reverse())).toEqual(expected);
    expect(objectSpawns([rows[3]!, rows[0]!, rows[5]!, rows[1]!, rows[4]!, rows[2]!])).toEqual(expected);
  });

  test("a published key stays when later reports move the median, and new places get their own key", () => {
    const first = objectSpawns([herb("a", 52.4, 43.1), herb("b", 52.6, 42.9), herb("c", 52.5, 43.2)]);
    const published = first.pins.map((p) => p.key);
    expect(published).toEqual(["obj1618-1411-52.5_43.0"]);
    // Later uploads lean east: without the published key the median would round to 53.0.
    const later = [herb("a", 52.4, 43.1), herb("b", 52.6, 42.9), herb("c", 52.5, 43.2),
      herb("d", 53.2, 43.0), herb("e", 53.3, 43.1), herb("f", 53.1, 42.9), herb("g", 53.2, 43.0)];
    expect(objectSpawns(later).pins.map((p) => p.key)).not.toEqual(published);
    const kept = objectSpawns(later, published);
    expect(kept.pins).toHaveLength(1);
    expect(kept.pins[0]).toMatchObject({ key: firstPin, x: 53.1, y: 43, reporters: 7 });
    // A place well away from it is a new pin with its own key; the published one is untouched.
    const away = [...later, ...["h", "i", "j"].map((i) => herb(i, 70, 20))];
    expect(objectSpawns(away, published).pins.map((p) => p.key)).toEqual(["obj1618-1411-52.5_43.0", "obj1618-1411-70.0_20.0"]);
    // A published key with fewer than 3 installs left is not a pin, and junk keys are ignored.
    expect(objectSpawns([herb("a", 52.5, 43)], [...published, "obj0-1-2_3", "npc5-1411", "obj1618-1411-200.0_1.0"]).pins).toEqual([]);
  });

  test("keys round to 0.5 and parse back", () => {
    expect(spawnKey(765, 1411, 52.26, 42.74)).toBe("obj765-1411-52.5_42.5");
    expect(spawnKey(765, 1411, 0, 100)).toBe("obj765-1411-0.0_100.0");
    expect(parseSpawnKey("obj765-1411-52.5_43.0")).toEqual({ objectId: 765, mapId: 1411, x: 52.5, y: 43 });
    expect(parseSpawnKey("obj765-1411-52.55_43.0")).toBeNull();
  });

  test("an object's name and kind are shown only when 3 installs agree on one", () => {
    const named = (installId: string, name: string) => herb(installId, 1, 1, { name });
    expect(agreedObjectNames([named("a", "Peacebloom"), named("b", "peacebloom"), named("c", "Peacebloom")])).toEqual(new Map([[1618, "Peacebloom"]]));
    expect(agreedObjectNames([named("a", "Peacebloom"), named("b", "Peacebloom")]).size).toBe(0);
    expect(agreedObjectNames([named("a", "Peacebloom"), named("a", "Peacebloom"), named("a", "Peacebloom")]).size).toBe(0);
    const split = [..."abc"].map((i) => named(i, "Peacebloom")).concat([..."def"].map((i) => named(i, "Silverleaf")));
    expect(agreedObjectNames(split).size).toBe(0);
    expect(agreedGatherKinds([..."abc"].map((i) => herb(i, 1, 1)))).toEqual(new Map([[1618, "herb"]]));
  });

  test("upload rows: object loot with and without a place, older rows kept for names, corpses and guesses left out", () => {
    const loot = (extra: Record<string, unknown>) => ({ kind: "loot", sourceEvidence: "loot-api", installId: "a", items: [], sourceObjectId: 1618, ...extra });
    const rows = objectSpawnRowsFromRecords([
      loot({ mapId: 1411, x: 52.4, y: 43.1, gatherKind: "herb", sourceObjectName: " Peacebloom " }),
      loot({}),
      loot({ gatherKind: "skinning", sourceObjectName: "" }),
      loot({ sourceObjectId: undefined, sourceNpcId: 6 }),
      { ...loot({}), sourceEvidence: undefined },
      { kind: "npc_sighting", installId: "a" },
    ]);
    expect(rows).toEqual([
      { installId: "a", objectId: 1618, mapId: 1411, x: 52.4, y: 43.1, gatherKind: "herb", name: "Peacebloom" },
      { installId: "a", objectId: 1618 },
      { installId: "a", objectId: 1618 },
    ]);
  });

  test("upload rows keep the player's gathering skill only when it is a whole rank from 1 to 500", () => {
    const loot = (gatherSkill: unknown) => ({ kind: "loot", sourceEvidence: "loot-api", installId: "a", items: [], sourceObjectId: 1618, gatherKind: "herb", gatherSkill });
    const rows = objectSpawnRowsFromRecords([loot(75), loot(0), loot(501), loot(12.5), loot("75"), loot(undefined)]);
    expect(rows.map((r) => r.gatherSkill)).toEqual([75, undefined, undefined, undefined, undefined, undefined]);
    expect(rows[1]).not.toHaveProperty("gatherSkill");
  });

  test("the skill players had: each install's lowest rank, then the lowest and the median, from 3 installs", () => {
    const at = (installId: string, gatherSkill?: number, extra: Partial<ObjectSpawnRow> = {}) => herb(installId, 40, 40, { ...(gatherSkill === undefined ? {} : { gatherSkill }), ...extra });
    expect(skillRange([at("a", 70), at("b", 90)])).toBeNull();
    // One install's many rows count once, at its lowest rank; rows with no rank do not count.
    expect(skillRange([at("a", 70), at("a", 120), at("a", 5, { installId: " a " }), at("b", 90), at("c", 110), at("d")])).toEqual({ min: 5, median: 90, installs: 3 });
    // An even count takes the lower middle rank, so the median is always one an install had.
    expect(skillRange([at("a", 10), at("b", 20), at("c", 30), at("d", 40)])).toEqual({ min: 10, median: 20, installs: 4 });
    // By object: only objects 3 installs agree are herbs, only rows opened as herbs, only with 3 installs reporting.
    const ranges = gatherSkillRanges([
      at("a", 1), at("b", 15), at("c", 30), at("d", 300, { gatherKind: "other" }),
      ...["a", "b", "c"].map((i) => at(i, 65, { objectId: 1731, gatherKind: "ore" })),
      at("a", 50, { objectId: 1617 }), at("b", 60, { objectId: 1617 }),
    ], "herb");
    expect(ranges).toEqual(new Map([[1618, { min: 1, median: 15, installs: 3 }]]));
    expect(gatherSkillRanges(["a", "b", "c"].map((i) => at(i, 65, { objectId: 1731, gatherKind: "ore" })), "ore")).toEqual(new Map([[1731, { min: 65, median: 65, installs: 3 }]]));
  });
});
