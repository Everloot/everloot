import { expect, test } from "vitest";
import {
  agreedLabelsById, agreedNpc, agreedNpcFacts, agreedNpcNames, agreedQuestTitles, handleNpcPage, handleQuestPage, handleVendorPage, npcNameReporters, npcPage,
  npcReportedName, npcTraits, npcZonesOf, questPage, questTraits, vendorPage, worldFactsFromRecords, zonesFor, type WorldFacts,
} from "../src/world-pages.js";

test("an NPC's level and reaction are kept from sightings and public once 3 installs agree", () => {
  const sight = (installId: string, level: unknown, reaction: unknown) =>
    ({ kind: "npc_sighting", installId, npcId: 7, name: "Hogger", mapId: 12, x: 1, y: 1, level, reaction });
  const facts = worldFactsFromRecords([sight("a", 11, "hostile"), sight("b", 11, "hostile"), sight("c", 11, "hostile"), sight("d", 0.5, "angry")]);
  expect(facts.npcs.map((r) => [r.level, r.reaction])).toEqual([[11, "hostile"], [11, "hostile"], [11, "hostile"], [undefined, undefined]]);
  expect(npcTraits(facts.npcs)).toMatchObject({ level: 11, reaction: "hostile" });
  expect(npcTraits(facts.npcs.slice(0, 2))).toMatchObject({ level: null, reaction: null });
  // Alliance and Horde players see the same NPC differently: two agreed reactions are no answer.
  const split = worldFactsFromRecords(["a", "b", "c", "d", "e", "f"].map((id, i) => sight(id, 11, i < 3 ? "hostile" : "friendly")));
  expect(npcTraits(split.npcs).reaction).toBeNull();
});

test("an NPC's type and rank are public once 3 installs agree, and an unknown type is dropped", () => {
  const sight = (installId: string, creatureType: unknown, rank: unknown) =>
    ({ kind: "npc_sighting", installId, npcId: 7, name: "Hogger", mapId: 12, x: 1, y: 1, creatureType, rank });
  const facts = worldFactsFromRecords([sight("a", "Humanoid", "elite"), sight("b", "Humanoid", "elite"), sight("c", "Humanoid", "elite"), sight("d", "Bestie", "legend")]);
  expect(facts.npcs.map((r) => [r.creatureType, r.rank]).slice(3)).toEqual([[undefined, undefined]]);
  expect(npcTraits(facts.npcs)).toMatchObject({ creatureType: "Humanoid", rank: "elite" });
  expect(npcTraits(facts.npcs.slice(0, 2))).toMatchObject({ creatureType: null, rank: null });
});

test("a quest's side is one faction only when 3 installs report it and none the other, Both when 3 report each", () => {
  const quest = (installId: string, faction: unknown, extra: Record<string, unknown> = {}) =>
    ({ kind: "quest", installId, questId: 9, title: "Q", level: 5, rewardItemIds: [], faction, ...extra });
  const side = (rows: unknown[]) => questTraits(worldFactsFromRecords(rows).quests).side;
  expect(side([quest("a", "alliance"), quest("b", "alliance"), quest("c", "alliance")])).toBe("alliance");
  expect(side([quest("a", "horde"), quest("b", "horde"), quest("c", "horde")])).toBe("horde");
  // Two installs are not enough, and one stray report from the other side is not enough for Both: no guess.
  expect(side([quest("a", "alliance"), quest("b", "alliance")])).toBeNull();
  expect(side([quest("a", "alliance"), quest("b", "alliance"), quest("c", "alliance"), quest("d", "horde")])).toBeNull();
  expect(side(["a", "b", "c", "d", "e", "f"].map((i, k) => quest(i, k < 3 ? "alliance" : "horde")))).toBe("both");
  // The same install reporting twice counts once, and a row with no faction says nothing about a side.
  expect(side([quest("a", "alliance"), quest("a", "alliance"), quest("a", "alliance"), quest("b", undefined), quest("c", undefined)])).toBeNull();
  const traits = questTraits(worldFactsFromRecords(["a", "b", "c"].map((i) => quest(i, "alliance", { category: "Elwynn Forest", suggestedGroup: 5, tag: "dungeon" }))).quests);
  expect(traits).toEqual({ category: "Elwynn Forest", side: "alliance", suggestedGroup: 5, tag: "dungeon" });
});

test("three agreeing sightings publish a name and a pin, and a split name stays blank", () => {
  const sight = (installId: string, name: string, x: number) => ({
    kind: "npc_sighting",
    positionKind: "npc",
    installId,
    npcId: 42,
    name,
    mapId: 12,
    x,
    y: 20,
  });
  const agreed = worldFactsFromRecords([
    sight("a", "Hogger", 40),
    sight("b", "hogger", 42),
    sight("c", "Hogger", 41),
    { kind: "npc_sighting" },
  ]);
  const text = handleNpcPage({ npcId: 42 }, agreed);
  expect(text).toContain("NPC 42 — Hogger");
  expect(text).toContain("Map 12 at 41, 20  3 reporters");

  const split = worldFactsFromRecords([
    sight("a", "Hogger", 40),
    sight("b", "Hogger", 42),
    sight("c", "Hogger", 41),
    sight("d", "Riverpaw", 10),
    sight("e", "Riverpaw", 10),
    sight("f", "Riverpaw", 10),
  ]);
  expect(handleNpcPage({ npcId: 42 }, split)).toContain("No agreed name");
  expect(handleNpcPage({ npcId: 0 })).toBe("Name an npc id.");
});

test("an NPC with no agreed name counts the installs behind its leading name; an agreed or split name counts none", () => {
  const sight = (installId: string, name: string) => ({ kind: "npc_sighting", positionKind: "npc", installId, npcId: 42, name, mapId: 12, x: 40, y: 20 });
  const count = (records: object[]) => npcNameReporters(42, worldFactsFromRecords(records));
  expect(count([])).toBe(0);
  expect(count([sight("a", "Hogger"), sight("a", "Hogger")])).toBe(1);
  expect(count([sight("a", "Hogger"), sight("b", "hogger "), sight("c", "Riverpaw")])).toBe(2);
  expect(count(["a", "b", "c"].map((i) => sight(i, "Hogger")))).toBe(0);
  expect(count([...["a", "b", "c"].map((i) => sight(i, "Hogger")), ...["d", "e", "f"].map((i) => sight(i, "Riverpaw"))])).toBe(0);
});

test("a quest publishes title, level, giver, and a reward only after 3 installs", () => {
  const quest = (installId: string, title: string, rewards: number[]) => ({
    kind: "quest",
    installId,
    questId: 9,
    title,
    level: 5,
    giverNpcId: 100,
    rewardItemIds: rewards,
  });
  const facts = worldFactsFromRecords([
    quest("a", "A New Threat", [1, 2]),
    quest("b", "A New Threat", [1, 2]),
    quest("c", "A New Threat", [1]),
    { kind: "quest", installId: "z" },
  ]);
  const text = handleQuestPage({ questId: 9 }, facts);
  expect(text).toContain("Quest 9 — A New Threat");
  expect(text).toContain("Level 5");
  expect(text).toContain("Giver NPC 100");
  expect(text).toContain("No agreed turn-in.");
  expect(text).toContain("Rewards: 1");
  expect(text).not.toContain("Rewards: 1, 2");

  const disputed = worldFactsFromRecords([
    { kind: "quest", installId: "a", questId: 10, title: "Alpha", level: 1, rewardItemIds: [] },
    { kind: "quest", installId: "b", questId: 10, title: "Alpha", level: 1, rewardItemIds: [] },
    { kind: "quest", installId: "c", questId: 10, title: "Alpha", level: 1, rewardItemIds: [] },
    { kind: "quest", installId: "d", questId: 10, title: "Beta", level: 2, rewardItemIds: [] },
    { kind: "quest", installId: "e", questId: 10, title: "Beta", level: 2, rewardItemIds: [] },
    { kind: "quest", installId: "f", questId: 10, title: "Beta", level: 2, rewardItemIds: [] },
  ]);
  expect(handleQuestPage({ questId: 10 }, disputed)).toContain("No agreed title");
  expect(handleQuestPage({ questId: 0 })).toBe("Name a quest id.");
});

test("two prices with 3 installs each both stay on the vendor page", () => {
  const vendor = (installId: string, priceCopper: number, limitedStock?: number) => ({
    kind: "vendor",
    installId,
    vendorNpcId: 80,
    items: [{ itemId: 5, priceCopper, ...(limitedStock ? { limitedStock } : {}) }],
  });
  const facts = worldFactsFromRecords([
    vendor("a", 100, 10),
    vendor("b", 100, 10),
    vendor("c", 100, 10),
    vendor("d", 200),
    vendor("e", 200),
    vendor("f", 200),
    { kind: "vendor", installId: "g", vendorNpcId: 80, items: [{ itemId: 5 }] },
  ]);
  const text = handleVendorPage({ vendorNpcId: 80 }, facts);
  expect(text).toContain("Item 5  1s 0c  stock 10  3 reporters");
  expect(text).toContain("Item 5  2s 0c  not limited  3 reporters");
  expect(handleVendorPage({ vendorNpcId: 1 })).toContain("Goods unrecorded");
  expect(handleVendorPage({ vendorNpcId: 0 })).toBe("Name a vendor id.");
});

test("a stock only some installs reported is unrecorded, not unlimited", () => {
  const vendor = (installId: string, limitedStock?: number) => ({
    kind: "vendor",
    installId,
    vendorNpcId: 81,
    items: [{ itemId: 6, priceCopper: 50, ...(limitedStock ? { limitedStock } : {}) }],
  });
  const text = handleVendorPage({ vendorNpcId: 81 }, worldFactsFromRecords([vendor("a", 5), vendor("b", 5), vendor("c")]));
  expect(text).toContain("Item 6  50c  stock unrecorded  3 reporters");
  expect(text).not.toContain("not limited");
});


test("the agreed NPC table gives every NPC reader the answer the sightings give, recheck scopes included", () => {
  const old = "2026-10-01T00:00:00Z", fresh = "2026-11-01T00:00:00Z";
  const sight = (installId: string, npcId: number, name: string, extra: Record<string, unknown> = {}) =>
    ({ kind: "npc_sighting", installId, npcId, name, mapId: 12, x: 40, y: 60, positionKind: "npc", level: 10, reaction: "hostile", creatureType: "Beast", rank: "rare", capturedAt: old, ...extra });
  const records = [
    // Outside the scope: agreed name, pin and traits. Where the player stood never dates the pin.
    ...["a", "b", "c"].map((i) => sight(i, 7, "Hogger", { mapId: 14 })), sight("d", 7, "Hogger", { mapId: 14, capturedAt: fresh, positionKind: "player" }), sight("e", 7, "Hogger", { mapId: 15, capturedAt: fresh }),
    // Two installs: a candidate name with its reporter count, and a drop source name.
    ...["a", "b"].map((i) => sight(i, 8, "Old Murk-Eye", { mapId: 13 })),
    // A rare on map 12 the scope below rechecks: the old name was agreed before it, two new installs report another.
    ...["a", "b", "c"].map((i) => sight(i, 9, "Old Name")), ...["d", "e"].map((i) => sight(i, 9, "New Name", { capturedAt: fresh })),
    ...["a", "b", "c"].map((installId) => ({ kind: "quest", installId, questId: 50, title: "Old Title", level: 5, giverNpcId: 9, rewardItemIds: [1], capturedAt: old })),
    ...["d", "e", "f"].map((installId) => ({ kind: "quest", installId, questId: 50, title: "New Title", level: 5, giverNpcId: 9, rewardItemIds: [1], capturedAt: fresh })),
    ...["a", "b", "c"].map((installId) => ({ kind: "vendor", installId, vendorNpcId: 9, items: [{ itemId: 5, priceCopper: 10 }], capturedAt: old })),
    ...["d", "e", "f"].map((installId) => ({ kind: "vendor", installId, vendorNpcId: 9, items: [{ itemId: 5, priceCopper: 12 }], capturedAt: fresh })),
  ];
  const recheck = [{ since: "2026-10-15T00:00:00Z", source: "fixture", zones: [12] }];
  const raw = worldFactsFromRecords(records, recheck);
  const table: WorldFacts = { ...raw, npcs: [], agreedNpcs: agreedNpcFacts(raw) };
  for (const npcId of [7, 8, 9, 404]) {
    expect(npcPage(npcId, table)).toEqual(npcPage(npcId, raw));
    expect(npcNameReporters(npcId, table)).toBe(npcNameReporters(npcId, raw));
    expect(npcReportedName(npcId, table)).toBe(npcReportedName(npcId, raw));
    expect(agreedNpc(npcId, table)).toEqual(agreedNpc(npcId, raw));
  }
  expect([...agreedNpcNames(table)]).toEqual([...agreedNpcNames(raw)]);
  expect([...agreedNpcNames(table, true)]).toEqual([...agreedNpcNames(raw, true)]);
  expect([...agreedQuestTitles(table)]).toEqual([...agreedQuestTitles(raw)]);
  expect(questPage(50, table)).toEqual(questPage(50, raw));
  expect(questTraits(raw.quests, table)).toEqual(questTraits(raw.quests, raw));
  expect(vendorPage(9, table)).toEqual(vendorPage(9, raw));
  expect([...npcZonesOf(table)]).toEqual([...zonesFor(raw.npcs)]);
  // The scope is what the zone is for: the rare's name and its quest's title are the new reports'.
  expect(questPage(50, table).title).toBe("New Title");
  expect(vendorPage(9, table).offers.map((o) => o.priceCopper)).toEqual([12]);
  expect(agreedNpc(7, table)).toMatchObject({ name: "Hogger", level: 10, reaction: "hostile", creatureType: "Beast", rank: "rare", pinDates: [[14, "2026-10-01"]] });
  expect(agreedNpc(8, table)).toMatchObject({ name: null, nameReporters: 2, reportedName: "old murk-eye", dropName: { name: "Old Murk-Eye" } });
  expect(agreedNpc(404, table)).toBeNull();
});

test("tiered drop names respect recheck and leave other name readers at three installs", () => {
  const old = ["fixture-a", "fixture-b", "fixture-c"].map((installId) =>
    ({ id: 7001, installId, label: "Fixture Old", capturedAt: "2026-10-01T00:00:00Z" }));
  const fresh = ["fixture-d", "fixture-e"].map((installId) =>
    ({ id: 7001, installId, label: "Fixture New", capturedAt: "2026-11-01T00:00:00Z" }));
  const since = () => "2026-10-15T00:00:00Z";
  expect(agreedLabelsById([...old, fresh[0]!], since, true).get(7001)).toEqual({ name: "Fixture New", tier: "reported" });
  expect(agreedLabelsById([...old, ...fresh], since, true).get(7001)).toEqual({ name: "Fixture New", tier: "verified" });
  expect(agreedLabelsById([...old, ...fresh], since).size).toBe(0);
});

test("a kill loot window with a place adds one kill place per install, NPC and map; other windows add none", () => {
  const kill = { kind: "loot", installId: "a", sourceEvidence: "loot-api", lootType: "kill", sourceNpcId: 6, items: [], mapId: 1429, x: 40, y: 60 };
  const facts = worldFactsFromRecords([
    kill, { ...kill, x: 41 }, { ...kill, installId: "b" }, { ...kill, mapId: 1436 },
    { ...kill, installId: "c", mapId: undefined, x: undefined, y: undefined },
    { ...kill, installId: "d", lootType: "skinning" },
    { ...kill, installId: "e", sourceEvidence: "empty-window" },
    { ...kill, installId: "f", sourceNpcId: undefined, sourceObjectId: 1618, lootType: "gather" },
  ]);
  expect(facts.kills).toEqual([
    { installId: "a", npcId: 6, mapId: 1429 }, { installId: "b", npcId: 6, mapId: 1429 }, { installId: "a", npcId: 6, mapId: 1436 },
  ]);
  expect(worldFactsFromRecords([{ ...kill, mapId: undefined }])).not.toHaveProperty("kills");
});
