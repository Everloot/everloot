import { describe, expect, test } from "vitest";
import { ALL_RECORD_KINDS, parseRecords, parseUpload, PUBLIC_RECORD_KINDS, sharingCategory, validateUpload } from "../src/index.js";

const base = { installId: "test-install-1234", capturedAt: "2026-09-29T12:00:00.000Z", eventId: "evt-1" };

describe("intake contract", () => {
  test("all record kinds exist", () => {
    expect(ALL_RECORD_KINDS).toHaveLength(40);
    expect(ALL_RECORD_KINDS).toContain("guild_kill");
    expect(ALL_RECORD_KINDS).toContain("item_fact");
    expect(ALL_RECORD_KINDS).toContain("census_self");
    expect(ALL_RECORD_KINDS).toContain("census_seen");
    expect(ALL_RECORD_KINDS).toContain("achievement_catalog");
    expect(ALL_RECORD_KINDS).toContain("quest_owned");
    expect(ALL_RECORD_KINDS).toContain("auction_snapshot");
    expect(ALL_RECORD_KINDS).toContain("talent_snapshot");
    expect(ALL_RECORD_KINDS).toContain("addon_seen");
    expect(ALL_RECORD_KINDS).toContain("map_bounds");
    expect(ALL_RECORD_KINDS).toContain("recipe_observed");
    expect(ALL_RECORD_KINDS).toContain("trainer_seen");
    expect(ALL_RECORD_KINDS).toContain("gold_snapshot");
    expect(ALL_RECORD_KINDS).toContain("money_event");
    expect(ALL_RECORD_KINDS).toContain("loot_award");
    expect(ALL_RECORD_KINDS).toContain("collection_catalog");
    expect(ALL_RECORD_KINDS).toContain("recipe_seen");
    expect(ALL_RECORD_KINDS).toContain("auction_scan");
  });

  test("accepts a mixed valid upload", () => {
    const r = validateUpload({
      addonVersion: "0.1.0",
      records: [
        { ...base, kind: "npc_sighting", npcId: 1234, name: "Forest Spider", mapId: 141, x: 42.5, y: 61.0, level: 60, reaction: "hostile" },
        { ...base, kind: "loot", sourceNpcId: 1234, items: [{ itemId: 456, count: 2 }] },
        {
          ...base, kind: "guild_snapshot", guildName: "Olympus", realm: "Forever-1", faction: "horde",
          claimToken: "evt_officerclaimtoken0123456789abcdef",
          members: [{ name: "Thrallfan", rank: "Guild Master", level: 60, class: "Shaman", lastOnlineDays: 0 }],
        },
      ],
    });
    expect(r.rejected).toHaveLength(0);
    expect(r.accepted.map((a) => a.kind)).toEqual(["npc_sighting", "loot", "guild_snapshot"]);
  });

  test("rejects unknown kinds, bad fields and loot without a source", () => {
    const r = validateUpload({
      addonVersion: "0.1.0",
      records: [
        { ...base, kind: "flying_mounts" },
        { ...base, kind: "loot", items: [{ itemId: 1, count: 1 }] },
        { ...base, kind: "npc_sighting", npcId: -5, name: "X", mapId: 1, x: 1, y: 1, level: 60, reaction: "hostile" },
      ],
    });
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      "unknown kind: flying_mounts",
      "loot needs a source: npc, object or item",
      expect.stringContaining(">0"),
    ]);
  });

  test("accepts collection, auction, and recipe records", () => {
    const r = validateUpload({
      addonVersion: "0.1.0",
      records: [
        { ...base, kind: "collection_catalog", collection: "Mounts", source: "Vendor", itemId: 1 },
        { ...base, kind: "collection_owned", collection: "Mounts", itemId: 1 },
        { ...base, kind: "auction_scan", realm: "Forever", itemId: 1, copper: 50 },
        { ...base, kind: "recipe_seen", profession: "Alchemy", recipe: "Minor Healing Potion", skillMin: 1, skillMax: 10, points: 1, reagents: [{ item: "Peacebloom", count: 1 }] },
        { ...base, kind: "price_seen", item: "Peacebloom", copper: 100 },
      ],
    });
    expect(r.rejected).toHaveLength(0);
    expect(r.accepted).toHaveLength(5);
  });

  test("auction scans keep the stack size and per-unit price basis", () => {
    const result = parseRecords([
      { ...base, kind: "auction_scan", realm: "Forever", itemId: 1, copper: 25, count: 4, priceBasis: "unit" },
      { ...base, kind: "auction_scan", realm: "Forever", itemId: 1, copper: 25, count: 0, priceBasis: "unit" },
      { ...base, kind: "auction_scan", realm: "Forever", itemId: 1, copper: 25, priceBasis: "stack" },
    ]);
    expect(result.records).toEqual([
      expect.objectContaining({ kind: "auction_scan", copper: 25, count: 4, priceBasis: "unit" }),
    ]);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([1, 2]);
  });

  test("a full-scan snapshot keeps whole-copper item summaries and rejects bad tuples", () => {
    const snap = (items: unknown, over = {}) => ({
      ...base, kind: "auction_snapshot", realm: "Forever", scanId: "scan-1", part: 1, parts: 2, items, ...over,
    });
    const result = parseRecords([
      snap([[2589, 4, 80, 95, 100], [765, 1, 3, 33, 33]]),
      snap([[2589, 4, 80, -1, 100]]),
      snap([[2589, 4, 80, 95.5, 100]]),
      snap([[0, 4, 80, 95, 100]]),
      snap([[2589, 0, 80, 95, 100]]),
      snap([[2589, 4, 80, 95]]),
      snap([]),
      snap(Array.from({ length: 1001 }, (_, i) => [i + 1, 1, 1, 1, 1])),
      snap([[2589, 4, 80, 95, 100]], { part: 3, parts: 2 }),
    ]);
    expect(result.records).toEqual([
      expect.objectContaining({ kind: "auction_snapshot", scanId: "scan-1", part: 1, parts: 2, items: [[2589, 4, 80, 95, 100], [765, 1, 3, 33, 33]] }),
    ]);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("a scan may say its faction and auction house; older scans without them still parse", () => {
    const snap = (over = {}) => ({
      ...base, kind: "auction_snapshot", realm: "Forever", scanId: "scan-1", part: 1, parts: 1, items: [[2589, 4, 80, 95, 100]], ...over,
    });
    const result = parseRecords([
      snap({ faction: "Horde", house: "Neutral" }),
      snap(),
      snap({ faction: "Alliance" }),
      snap({ faction: "Neutral" }),
      snap({ house: "alliance" }),
    ]);
    expect(result.records).toEqual([
      expect.objectContaining({ faction: "Horde", house: "Neutral" }),
      expect.not.objectContaining({ faction: expect.anything() }),
      expect.objectContaining({ faction: "Alliance" }),
    ]);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([3, 4]);
  });

  test("one listing above 200k gold does not drop the other items of its scan part", () => {
    const result = parseRecords([{
      ...base, kind: "auction_snapshot", realm: "Forever", scanId: "scan-1", part: 1, parts: 1,
      items: [[19019, 1, 1, 99_999_999_999, 99_999_999_999], [2589, 4, 2_000_000, 95, 100]],
    }]);
    expect(result.receipt.rejected).toEqual([]);
  });

  test("a recipe observation keeps the colour the window showed at that rank", () => {
    const result = parseRecords([
      { ...base, kind: "recipe_observed", profession: "Alchemy", rank: 60, maxRank: 75, recipe: "Lesser Healing Potion",
        difficulty: "optimal", productItemId: 858, reagents: [{ item: "Briarthorn", count: 1 }] },
      { ...base, kind: "recipe_observed", profession: "Enchanting", rank: 40, recipe: "Enchant Bracer - Minor Health",
        difficulty: "medium", reagents: [] },
      { ...base, kind: "recipe_observed", profession: "Alchemy", rank: 60, recipe: "X", difficulty: "glowing", reagents: [] },
    ]);
    expect(result.records).toHaveLength(2);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([2]);
  });

  test("a trainer row keeps the recipe's required rank and optional training cost", () => {
    const result = parseRecords([
      { ...base, kind: "trainer_seen", profession: "Alchemy", recipe: "Lesser Healing Potion", requiredRank: 55, costCopper: 250 },
      { ...base, kind: "trainer_seen", profession: "Alchemy", recipe: "Elixir of Minor Agility", requiredRank: 50 },
      { ...base, kind: "trainer_seen", profession: "Alchemy", recipe: "X", requiredRank: 0 },
      { ...base, kind: "trainer_seen", profession: "Alchemy", recipe: "Y", requiredRank: 50, costCopper: -1 },
    ]);
    expect(result.records).toHaveLength(2);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([2, 3]);
  });

  test("an NPC seen at its window carries an interaction position and a role; older rows still parse", () => {
    const seen = { ...base, kind: "npc_sighting", npcId: 3158, name: "Duokna", mapId: 1411, x: 51.2, y: 42.8, level: 15, reaction: "friendly" };
    const result = parseRecords([
      { ...seen, positionKind: "interaction", role: "vendor" },
      { ...seen, positionKind: "interaction" },
      { ...seen, positionKind: "player" },
      seen,
      { ...seen, positionKind: "interaction", role: "blacksmith" },
      { ...seen, positionKind: "nearby" },
    ]);
    expect(result.records).toEqual([
      expect.objectContaining({ positionKind: "interaction", role: "vendor" }),
      expect.objectContaining({ positionKind: "interaction" }),
      expect.objectContaining({ positionKind: "player" }),
      expect.not.objectContaining({ positionKind: expect.anything() }),
    ]);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([4, 5]);
  });

  test("an NPC sighting may leave out its level and reaction, as a converted Polestar Recorder row does", () => {
    const seen = { ...base, kind: "npc_sighting", npcId: 197, name: "Marshal McBride", mapId: 1429, x: 48.17, y: 42.95, positionKind: "interaction", role: "questgiver" };
    const result = parseRecords([seen, { ...seen, level: 0 }, { ...seen, reaction: "unfriendly" }]);
    expect(result.records).toEqual([expect.not.objectContaining({ level: expect.anything() })]);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([1, 2]);
  });

  test("a rare seen through a vignette carries the NPC's own position", () => {
    const rare = { ...base, kind: "npc_sighting", npcId: 61, name: "Thuros Lightfingers", mapId: 1429, x: 70.1, y: 79.2, level: 11, rank: "rare", positionKind: "vignette" };
    expect(parseRecords([rare]).records).toEqual([expect.objectContaining({ positionKind: "vignette", rank: "rare" })]);
  });

  test("an instance entrance, an encounter and an object sighting parse; optional fields stay optional", () => {
    const entrance = { ...base, kind: "instance_entrance", instanceMapId: 36, name: "Deadmines", instanceType: "party", mapId: 1436, x: 42.5, y: 71.6 };
    const encounter = { ...base, kind: "encounter", encounterId: 1144, name: "Edwin VanCleef", instanceMapId: 36, success: true };
    const chest = { ...base, kind: "object_sighting", objectId: 2843, name: "Battered Chest", mapId: 1436, x: 30.1, y: 50.2 };
    const result = parseRecords([
      entrance, { ...entrance, difficulty: 1 },
      encounter, { ...encounter, difficulty: 1, size: 5, npcIds: [639] },
      chest, { ...chest, instanceMapId: 36 },
      { ...entrance, instanceType: "scenario" },
      { ...entrance, mapId: undefined },
      { ...encounter, success: undefined },
      { ...encounter, npcIds: [0] },
      { ...chest, x: 101 },
      { ...chest, name: "" },
    ]);
    expect(result.records.map((r) => r.kind)).toEqual(["instance_entrance", "instance_entrance", "encounter", "encounter", "object_sighting", "object_sighting"]);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([6, 7, 8, 9, 10, 11]);
  });

  test("an item fact carries the item, the line, its number and the build; only damage per second has a decimal", () => {
    const fact = { ...base, kind: "item_fact", itemId: 6070, fact: "stamina", value: 5, clientBuild: "1.60.1.70450" };
    const result = parseRecords([
      fact,
      { ...fact, fact: "armor", value: 103 },
      { ...fact, fact: "spirit", value: -5 },
      { ...fact, fact: "damage_per_second", value: 12.4 },
      { ...fact, value: 5.5 },
      { ...fact, fact: "luck" },
      { ...fact, clientBuild: undefined },
      { ...fact, clientBuild: "beta" },
      { ...fact, itemId: 0 },
      { ...fact, value: 10_001 },
      { ...fact, value: "5" },
    ]);
    expect(result.records.map((r) => r.kind === "item_fact" && r.fact)).toEqual(["stamina", "armor", "spirit", "damage_per_second"]);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(PUBLIC_RECORD_KINDS).toContain("item_fact");
  });

  test("a guild kill names a guild, a realm, a faction and a boss; a person never survives parsing; the kind is public", () => {
    const kill = { ...base, kind: "guild_kill", guildName: "Night Watch", realm: "Forever", faction: "horde", encounterId: 1144, name: "Edwin VanCleef", instanceMapId: 36 };
    const result = parseRecords([
      kill,
      { ...kill, difficulty: 1, size: 5 },
      // The schema has no field for a character, so one sent along is dropped, not stored.
      { ...kill, character: "Thrallina", playerName: "Thrallina" },
      { ...kill, faction: "Horde" },
      { ...kill, faction: undefined },
      { ...kill, guildName: "N" },
      { ...kill, guildName: "Night<Watch>" },
      { ...kill, realm: "" },
      { ...kill, encounterId: 0 },
      { ...kill, name: "" },
      { ...kill, instanceMapId: undefined },
      { ...kill, size: 41 },
    ]);
    expect(result.records.map((r) => r.kind)).toEqual(["guild_kill", "guild_kill", "guild_kill"]);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(result.records[2]).not.toHaveProperty("character");
    expect(result.records[2]).not.toHaveProperty("playerName");
    expect(result.records[1]).toMatchObject({ difficulty: 1, size: 5 });
    expect(PUBLIC_RECORD_KINDS).toContain("guild_kill");
    // No sharing choice or grant: members agreeing is the bar, not an officer's grant.
    expect(sharingCategory(result.records[0]!)).toBeNull();
    expect(sharingCategory({ ...base, kind: "raid_lockout", guildName: "Night Watch", realm: "Forever", instance: "Molten Core", difficulty: "40", bossesKilled: [], resetAt: "2026-10-14T00:00:00Z" } as never)).toBe("guild");
  });

  test("the envelope may say its rows came from a Polestar Recorder file, and nothing else", () => {
    const records = [{ ...base, kind: "npc_sighting", npcId: 197, name: "Marshal McBride", mapId: 1429, x: 48, y: 42 }];
    const recorder = parseUpload({ addonVersion: "polestar-recorder", source: "polestar_recorder", records });
    expect(recorder.ok && recorder.upload.source).toBe("polestar_recorder");
    const addon = parseUpload({ addonVersion: "0.3.10", records });
    expect(addon.ok && "source" in addon.upload).toBe(false);
    expect(parseUpload({ addonVersion: "0.3.10", source: "questie", records }).ok).toBe(false);
  });

  test("an object's loot window may carry where it was opened, how and the object's name", () => {
    const herb = { ...base, kind: "loot", sourceEvidence: "loot-api", sourceObjectId: 1618, items: [{ itemId: 2447, count: 2 }] };
    const result = parseRecords([
      { ...herb, mapId: 1411, x: 52.4, y: 43.1, gatherKind: "herb", sourceObjectName: "Peacebloom" },
      herb,
      { ...herb, mapId: 1411, x: 52.4, y: 43.1, gatherKind: "other" },
      { ...herb, mapId: 1411, x: 52.4 },
      { ...herb, mapId: 1411, x: 101, y: 43.1 },
      { ...herb, gatherKind: "skinning" },
      { ...herb, sourceObjectName: "" },
    ]);
    expect(result.records).toEqual([
      expect.objectContaining({ mapId: 1411, x: 52.4, y: 43.1, gatherKind: "herb", sourceObjectName: "Peacebloom" }),
      expect.not.objectContaining({ mapId: expect.anything() }),
      expect.objectContaining({ gatherKind: "other" }),
    ]);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([3, 4, 5, 6]);
    expect(result.receipt.rejected[0]!.reason).toBe("a loot position needs mapId, x and y together");
  });

  test("a loot window may carry its type, the item it came from and its coin, and old windows stay valid", () => {
    const kill = { ...base, kind: "loot", sourceEvidence: "loot-api", sourceNpcId: 1234, items: [{ itemId: 2589, count: 1 }] };
    const disenchant = { ...base, kind: "loot", sourceEvidence: "loot-api", sourceItemId: 2455, lootType: "disenchant", items: [{ itemId: 10940, count: 2 }] };
    const result = parseRecords([
      kill,
      { ...kill, lootType: "pickpocket", copper: 154 },
      disenchant,
      { ...disenchant, sourceItemId: undefined },
      { ...kill, lootType: "mining" },
      { ...kill, copper: 0 },
      { ...kill, sourceItemId: 0 },
    ]);
    expect(result.records).toEqual([
      expect.not.objectContaining({ lootType: expect.anything() }),
      expect.objectContaining({ sourceNpcId: 1234, lootType: "pickpocket", copper: 154 }),
      expect.objectContaining({ sourceItemId: 2455, lootType: "disenchant" }),
    ]);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([3, 4, 5, 6]);
    expect(result.receipt.rejected[0]!.reason).toBe("loot needs a source: npc, object or item");
  });

  test("a trainer row may name the trainer", () => {
    const row = { ...base, kind: "trainer_seen", profession: "Alchemy", recipe: "Lesser Healing Potion", requiredRank: 55 };
    const result = parseRecords([{ ...row, trainerNpcId: 3347 }, row, { ...row, trainerNpcId: 0 }]);
    expect(result.records).toEqual([expect.objectContaining({ trainerNpcId: 3347 }), expect.not.objectContaining({ trainerNpcId: expect.anything() })]);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([2]);
  });

  test("a loot window with no items is a kill when it names a source", () => {
    const r = validateUpload({
      addonVersion: "0.1.0",
      records: [{ ...base, kind: "loot", sourceNpcId: 1234, items: [] }],
    });
    expect(r.rejected).toHaveLength(0);
    expect(r.accepted).toEqual([{ index: 0, kind: "loot" }]);
    const bare = validateUpload({
      addonVersion: "0.1.0",
      records: [{ ...base, kind: "loot", items: [] }],
    });
    expect(bare.accepted).toHaveLength(0);
    expect(bare.rejected.map((row) => row.reason)).toContain("loot needs a source: npc, object or item");
  });

  test("accepts a gold snapshot and a loot money event", () => {
    const r = validateUpload({
      addonVersion: "0.1.0",
      records: [
        { ...base, kind: "gold_snapshot", character: "Bigz", realm: "Forever", currentCopper: 120000, peakCopper: 5389075 },
        { ...base, kind: "money_event", character: "Bigz", realm: "Forever", category: "loot", copper: 64600 },
      ],
    });
    expect(r.rejected).toHaveLength(0);
    expect(r.accepted.map((row) => row.kind)).toEqual(["gold_snapshot", "money_event"]);
    const low = validateUpload({
      addonVersion: "0.1.0",
      records: [{ ...base, kind: "gold_snapshot", character: "Bigz", realm: "Forever", currentCopper: 10, peakCopper: 1 }],
    });
expect(low.rejected.map((row) => row.reason).join(" ")).toContain("peak gold cannot be below current gold");
  });

  test("an installed addon keeps its folder name, title, .toc version and whether it loaded", () => {
    const result = parseRecords([
      { ...base, kind: "addon_seen", name: "Questie", title: "Questie", version: "9.5.1", loaded: true },
      { ...base, kind: "addon_seen", name: "OldBags", title: "Old Bags", loaded: false },
      { ...base, kind: "addon_seen", name: "", title: "Nameless", loaded: true },
      { ...base, kind: "addon_seen", name: "Questie", title: "Questie", loaded: "yes" },
    ]);
    expect(result.records).toEqual([
      { ...base, kind: "addon_seen", name: "Questie", title: "Questie", version: "9.5.1", loaded: true },
      { ...base, kind: "addon_seen", name: "OldBags", title: "Old Bags", loaded: false },
    ]);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([2, 3]);
  });

  test("zone bounds are four world coordinates with a width and a height", () => {
    const zone = { ...base, kind: "map_bounds", mapId: 1429, continentId: 0, left: 1535.4, top: -7939.6, right: -1599.6, bottom: -10254.2 };
    const result = parseRecords([
      zone,
      { ...zone, right: zone.left },
      { ...zone, top: zone.bottom },
      { ...zone, mapId: 0 },
      { ...zone, left: Number.POSITIVE_INFINITY },
    ]);
    expect(result.records).toEqual([zone]);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([1, 2, 3, 4]);
    expect(result.receipt.rejected[0].reason).toBe("map bounds need a width and a height");
  });

  test("a talent build is spent nodes in one spec group, with Blizzard's string only when it is plain base64", () => {
    const build = {
      ...base, kind: "talent_snapshot", class: "MAGE", level: 30, group: 1, active: true, configId: 7, treeId: 786,
      specId: 1482, clientBuild: "1.60.1.70450", serializationVersion: 2, exportStatus: "ok", points: 3,
      loadoutString: "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      nodes: [{ nodeId: 90001, ranks: 2 }, { nodeId: 90002, ranks: 1, choice: 1 }],
    };
    const result = parseRecords([
      build,
      { ...build, loadoutString: undefined, exportStatus: "unavailable" },
      { ...build, group: 3 },
      { ...build, loadoutString: "not base64!" },
      { ...build, nodes: [{ nodeId: 90001, ranks: 0 }] },
      { ...build, exportStatus: "maybe" },
      { ...build, points: 4 },
      { ...build, nodes: [{ nodeId: 90001, ranks: 1 }, { nodeId: 90001, ranks: 2 }] },
    ]);
    expect(result.receipt.rejected.map((r) => r.index)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(result.records).toHaveLength(2);
  });

  describe("completion tracker", () => {
    const achievement = {
      ...base, kind: "achievement_catalog", achievementId: 11, name: "Explorer", categoryId: 3, category: "Exploration",
      parentCategory: "General", points: 10, criteriaCount: 2, criteria: [{ text: "Elwynn Forest", required: 1 }, { text: "", required: 1 }],
    };
    const owned = { ...base, characterKey: "0a1b2c3d", class: "MAGE", level: 30 };

    test("an achievement catalog row keeps names and counts, and refuses what does not add up", () => {
      const result = parseRecords([
        achievement,
        { ...achievement, name: "" },
        { ...achievement, name: "x".repeat(121) },
        { ...achievement, points: 1001 },
        { ...achievement, criteriaCount: 1 },
        { ...achievement, criteria: Array.from({ length: 101 }, () => ({ text: "a", required: 1 })), criteriaCount: 101 },
        { ...achievement, criteria: [{ text: "x".repeat(121), required: 1 }] },
        { ...achievement, achievementId: 0 },
      ]);
      expect(result.receipt.rejected.map((r) => r.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(result.records).toHaveLength(1);
    });

    test("faction, title and quest chain catalog rows are bounded", () => {
      const result = parseRecords([
        { ...base, kind: "reputation_catalog", factionId: 72, name: "Stormwind", header: "Alliance", major: false },
        { ...base, kind: "reputation_catalog", factionId: 72, name: "" },
        { ...base, kind: "title_catalog", titleId: 4, name: "Private" },
        { ...base, kind: "title_catalog", titleId: 5001, name: "Too far" },
        { ...base, kind: "quest_chain_catalog", questLineId: 9, name: "The Defias", questIds: [1, 2] },
        { ...base, kind: "quest_chain_catalog", questLineId: 9, name: "Empty", questIds: [] },
        { ...base, kind: "quest_chain_catalog", questLineId: 9, name: "Long", questIds: Array.from({ length: 81 }, (_, i) => i + 1) },
      ]);
      expect(result.receipt.rejected.map((r) => r.index)).toEqual([1, 3, 5, 6]);
    });

    test("owned rows need an opaque character key, never a name", () => {
      const row = { ...owned, kind: "achievement_owned", achievementId: 11, completed: true, earnedByMe: true, earnedOn: "2026-10-01", criteriaMet: 2, criteriaTotal: 2 };
      const result = parseRecords([
        row,
        { ...row, characterKey: "Thrall" },
        { ...row, characterKey: "0A1B2C3D" },
        { ...row, characterKey: undefined },
        { ...row, criteriaMet: 3 },
        { ...row, completed: false },
        { ...row, earnedOn: "1 Oct 2026" },
        { ...row, character: "Thrall", realm: "Forever" },
      ]);
      expect(result.receipt.rejected.map((r) => r.index)).toEqual([1, 2, 3, 4, 5, 6]);
      // An unknown field is stripped, not kept: the name cannot ride along.
      expect(result.records[1]).not.toHaveProperty("character");
    });

    test("reputation, title and quest rows", () => {
      const rep = { ...owned, kind: "reputation_owned", factionId: 72, reaction: 5, standing: 3100, floor: 3000, ceiling: 9000 };
      const result = parseRecords([
        rep,
        { ...rep, standing: -42000, floor: -42000, ceiling: -6000, reaction: 1 },
        { ...rep, floor: 9001 },
        { ...rep, reaction: 0 },
        { ...owned, kind: "title_owned", titleIds: [4, 5] },
        { ...owned, kind: "title_owned", titleIds: [] },
        { ...owned, kind: "quest_owned", questIds: [7] },
        { ...owned, kind: "quest_owned", questIds: Array.from({ length: 201 }, (_, i) => i + 1) },
        { ...owned, level: 101, kind: "quest_owned", questIds: [7] },
      ]);
      expect(result.receipt.rejected.map((r) => r.index)).toEqual([2, 3, 5, 7, 8]);
    });
  });

  test("rejects empty and oversized payloads", () => {
    expect(validateUpload({ addonVersion: "0.1.0", records: [] }).rejected[0].index).toBe(-1);
    expect(validateUpload({}).rejected).toHaveLength(1);
  });
});

describe("canonical parsing", () => {
  const validLoot = {
    kind: "loot",
    installId: "install-1234",
    capturedAt: "2026-10-05T00:00:00.000Z",
    eventId: "evt-1",
    sourceNpcId: 123,
    items: [{ itemId: 456, count: 1, secret: "strip" }],
    extra: "strip",
  };
  const canonicalLoot = {
    kind: "loot",
    installId: "install-1234",
    capturedAt: "2026-10-05T00:00:00.000Z",
    eventId: "evt-1",
    sourceNpcId: 123,
    items: [{ itemId: 456, count: 1 }],
  };

  test("a rejected first row does not own attribution; accepted rows are stored parsed", () => {
    const result = parseUpload({
      addonVersion: "0.1.0",
      records: [{ ...validLoot, installId: "" }, validLoot],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a parsed envelope");
    expect(result.upload).toEqual({ addonVersion: "0.1.0", records: [canonicalLoot] });
    expect(result.receipt.accepted).toEqual([{ index: 1, kind: "loot" }]);
    expect(result.receipt.rejected[0].index).toBe(0);
  });

  test("schema defaults survive and unknown extra fields are stripped", () => {
    const result = parseUpload({
      addonVersion: "0.1.0",
      records: [
        {
          ...base,
          kind: "quest",
          questId: 55,
          title: "Road to Westfall",
          level: 12,
          nested: { keep: "no" },
        },
        { ...base, kind: "price_seen", item: "Peacebloom", copper: 100, note: "strip" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a parsed envelope");
    expect(result.upload.records[0]).toEqual({
      ...base,
      kind: "quest",
      questId: 55,
      title: "Road to Westfall",
      level: 12,
      rewardItemIds: [],
    });
    expect(result.upload.records[1]).toEqual({ ...base, kind: "price_seen", item: "Peacebloom", copper: 100 });
  });

  test("the client build is kept when sent and optional for 0.2.5 uploads", () => {
    const withBuild = parseUpload({ addonVersion: "0.2.6", clientBuild: "1.60.1.70450", records: [validLoot] });
    expect(withBuild.ok).toBe(true);
    if (!withBuild.ok) throw new Error("expected a parsed envelope");
    expect(withBuild.upload).toEqual({ addonVersion: "0.2.6", clientBuild: "1.60.1.70450", records: [canonicalLoot] });
    const without = parseUpload({ addonVersion: "0.2.5", records: [validLoot] });
    expect(without.ok).toBe(true);
    if (!without.ok) throw new Error("expected a parsed envelope");
    expect(without.upload).not.toHaveProperty("clientBuild");
    expect(parseUpload({ addonVersion: "0.2.6", clientBuild: "<script>", records: [validLoot] }).ok).toBe(false);
  });

  test("a valid envelope whose rows are all rejected still parses with no records", () => {
    const result = parseUpload({
      addonVersion: "0.1.0",
      records: [{ ...validLoot, installId: "" }, { ...base, kind: "flying_mounts" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a parsed envelope");
    expect(result.upload.records).toEqual([]);
    expect(result.receipt.accepted).toEqual([]);
    expect(result.receipt.rejected.map((row) => row.index)).toEqual([0, 1]);
  });

  test("an invalid envelope does not parse and keeps the receipt reason", () => {
    const result = parseUpload({});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a rejected envelope");
    expect(result.receipt.accepted).toEqual([]);
    expect(result.receipt.rejected).toHaveLength(1);
    expect(result.receipt.rejected[0].index).toBe(-1);
    expect(validateUpload({})).toEqual(result.receipt);
  });

  test("2000 rows parse and 2001 rows are an envelope failure", () => {
    const rows = Array.from({ length: 2000 }, () => validLoot);
    expect(parseUpload({ addonVersion: "0.1.0", records: rows }).ok).toBe(true);
    const over = parseUpload({ addonVersion: "0.1.0", records: [...rows, validLoot] });
    expect(over.ok).toBe(false);
    if (over.ok) throw new Error("expected the 2001-row envelope to be refused");
    expect(over.receipt.rejected[0].reason).toContain("2000");
  });

  test("hostile kinds and non-object rows are ordinary rejected rows", () => {
    const rows: unknown[] = [
      { ...base, kind: "constructor" },
      { ...base, kind: "toString" },
      { ...base, kind: "__proto__" },
      { ...base, kind: "hasOwnProperty" },
      42,
      "loot",
      null,
      true,
      [],
      Object.create({ kind: "loot" }),
    ];
    const result = parseRecords(rows);
    expect(result.records).toEqual([]);
    expect(result.receipt.accepted).toEqual([]);
    expect(result.receipt.rejected.map((row) => row.index)).toEqual(rows.map((_, index) => index));
    expect(result.receipt.rejected[rows.length - 1].reason).toContain("unknown kind");
  });

  test("parseRecords reports original indices without an envelope cap", () => {
    const rows: unknown[] = Array.from({ length: 2001 }, (_, index) =>
      index === 1500 ? { ...base, kind: "price_seen", item: "Peacebloom", copper: 1 } : { ...base, kind: "price_seen", copper: -1 },
    );
    const result = parseRecords(rows);
    expect(result.receipt.accepted).toEqual([{ index: 1500, kind: "price_seen" }]);
    expect(result.records).toHaveLength(1);
  });
});

describe("protocol version on the envelope", () => {
  const payload = (protocol?: string) => ({
    addonVersion: "0.3.3",
    ...(protocol ? { protocol } : {}),
    records: [{ ...base, kind: "price_seen", item: "Silk", copper: 10 }],
  });

  test("a missing protocol means major 1 and is accepted", () => {
    const parsed = parseUpload(payload());
    expect(parsed.ok).toBe(true);
    expect(parsed.receipt.accepted).toHaveLength(1);
  });

  test("a newer minor of the current major is accepted", () => {
    expect(parseUpload(payload("1.4.0")).ok).toBe(true);
  });

  test("a major the server does not speak is refused whole, with the reason", () => {
    const parsed = parseUpload(payload("2.0.0"));
    expect(parsed.ok).toBe(false);
    expect(parsed.receipt.rejected).toEqual([{ index: -1, reason: "protocol 2.0.0 is not supported; update the addon or uploader" }]);
  });

  test("a protocol that is not x.y.z fails the envelope", () => {
    expect(parseUpload(payload("one")).ok).toBe(false);
  });
});
