import { expect, test, vi } from "vitest";
import { answerSourcesFactsFromRecords } from "../src/answer-sources.js";
import { auctionSightingsFromRecords } from "../src/auction-history.js";
import { collectionFactsFromRecords } from "../src/collection-gap.js";
import { itemToolFactsFromRecords } from "../src/item-page-tool.js";
import { observedEdgesFromRecords } from "../src/edges.js";
import { objectFactsFromRecords } from "../src/object-page.js";
import { goldFactsFromRecords } from "../src/gold-ledger.js";
import { guildFactsFromRecords } from "../src/guild-board.js";
import { fromUploads, TOOL_KINDS, UPLOADS_UNSET } from "../src/mcp-server.js";
import { pathFactsFromRecords, recipeFactsFromRecords } from "../src/recipe-thresholds.js";
import { npcFactsFromRecords, worldFactsFromRecords } from "../src/world-pages.js";
import { mapFactsFromRecords } from "../src/world-map-near.js";
import { ALL_RECORD_KINDS, CENSUS_KINDS, COMPLETION_KINDS, LINK_KINDS, PLAYER_KINDS, parseRecords } from "@everloot/protocol";
import { MCP_CREDIT } from "@everloot/protocol";

const base = { installId: "install-one", capturedAt: "2026-10-09T00:00:00Z" };
const guild = { guildName: "Olympus", realm: "Forever" };

/** One schema-valid record of every kind, so a tool that reads an unlisted kind changes its facts. */
const EVERY_KIND = parseRecords([
  { ...base, eventId: "e:1", kind: "npc_sighting", npcId: 42, name: "Forest Spider", mapId: 141, x: 40, y: 60, level: 10, reaction: "hostile", positionKind: "npc" },
  { ...base, eventId: "e:2", kind: "loot", sourceNpcId: 42, sourceEvidence: "loot-api", items: [{ itemId: 5, count: 1 }] },
  { ...base, eventId: "e:3", kind: "quest", questId: 7, title: "Road", level: 10, giverNpcId: 42, rewardItemIds: [5] },
  { ...base, eventId: "e:4", kind: "vendor", vendorNpcId: 43, items: [{ itemId: 5, priceCopper: 10 }] },
  { ...base, eventId: "e:5", kind: "item_seen", itemId: 5, name: "Silk", quality: "common" },
  { ...base, eventId: "e:6", kind: "guild_snapshot", ...guild, faction: "horde", members: [{ name: "Thrall", rank: "GM", level: 60, class: "Shaman", lastOnlineDays: 0 }] },
  { ...base, eventId: "e:7", kind: "raid_lockout", ...guild, instance: "Molten Core", difficulty: "40", bossesKilled: ["Lucifron"], resetAt: "2026-10-14T00:00:00Z" },
  { ...base, eventId: "e:8", kind: "attendance", ...guild, instance: "Molten Core", present: ["Thrall"] },
  { ...base, eventId: "e:9", kind: "loot_award", ...guild, itemId: 5, itemName: "Silk", recipient: "Thrall", sourceBoss: "Lucifron" },
  { ...base, eventId: "e:10", kind: "gear_snapshot", character: "Thrall", realm: "Forever", equipped: [{ slot: "Head", itemId: 5, itemLevel: 60 }] },
  { ...base, eventId: "e:11", kind: "collection_catalog", collection: "Mounts", source: "Vendor", itemId: 5 },
  { ...base, eventId: "e:12", kind: "collection_owned", collection: "Mounts", itemId: 5 },
  { ...base, eventId: "e:13", kind: "auction_scan", realm: "Forever", itemId: 5, copper: 10 },
  { ...base, eventId: "e:14", kind: "recipe_seen", profession: "Alchemy", recipe: "Minor Healing Potion", skillMin: 1, skillMax: 10, points: 1, reagents: [{ item: "Peacebloom", count: 1 }] },
  { ...base, eventId: "e:15", kind: "price_seen", item: "Peacebloom", copper: 100 },
  { ...base, eventId: "e:16", kind: "gold_snapshot", character: "Thrall", realm: "Forever", currentCopper: 100, peakCopper: 100 },
  { ...base, eventId: "e:17", kind: "money_event", character: "Thrall", realm: "Forever", category: "loot", copper: 10 },
  { ...base, eventId: "e:18", kind: "recipe_observed", profession: "Alchemy", rank: 60, recipe: "Lesser Healing Potion", difficulty: "optimal", reagents: [] },
  { ...base, eventId: "e:19", kind: "trainer_seen", profession: "Alchemy", recipe: "Lesser Healing Potion", requiredRank: 55, costCopper: 250 },
  { ...base, eventId: "e:20", kind: "addon_seen", name: "Questie", title: "Questie", version: "9.5.1", loaded: true },
  // A Polestar Recorder loot window: counted as pending, never in the rates.
  { ...base, installId: "ps-1111111111111111-2222222222222222", eventId: "e:36", kind: "loot", sourceNpcId: 42, items: [{ itemId: 5, count: 1 }] },
  { ...base, eventId: "e:37", kind: "instance_entrance", instanceMapId: 36, name: "Deadmines", instanceType: "party", mapId: 1436, x: 42, y: 71 },
  { ...base, eventId: "e:38", kind: "encounter", encounterId: 1144, name: "Edwin VanCleef", instanceMapId: 36, success: true, npcIds: [639] },
  { ...base, eventId: "e:39", kind: "object_sighting", objectId: 2843, name: "Battered Chest", mapId: 1436, x: 30, y: 50 },
  // Read by item_page as well as the site's item pages; the tool input stays frozen.
  { ...base, eventId: "e:40", kind: "item_fact", itemId: 5, fact: "stamina", value: 3, clientBuild: "1.60.1.70450" },
  { ...base, eventId: "e:21", kind: "map_bounds", mapId: 1429, continentId: 0, left: 1535.4, top: -7939.6, right: -1599.6, bottom: -10254.2 },
  // Read by the completion rollup (kb/src/completion-rollup.ts), never by a corpus tool.
  { ...base, eventId: "e:24", kind: "achievement_catalog", achievementId: 11, name: "Explorer", categoryId: 3, category: "Exploration", points: 10, criteriaCount: 1, criteria: [{ text: "Elwynn Forest", required: 1 }] },
  { ...base, eventId: "e:25", kind: "reputation_catalog", factionId: 72, name: "Stormwind", header: "Alliance" },
  { ...base, eventId: "e:26", kind: "title_catalog", titleId: 4, name: "Private" },
  { ...base, eventId: "e:27", kind: "quest_chain_catalog", questLineId: 900, name: "The Defias", questIds: [7, 8] },
  { ...base, eventId: "e:28", kind: "achievement_owned", characterKey: "0a1b2c3d", class: "MAGE", level: 30, achievementId: 11, completed: false, criteriaMet: 0, criteriaTotal: 1 },
  { ...base, eventId: "e:29", kind: "reputation_owned", characterKey: "0a1b2c3d", class: "MAGE", level: 30, factionId: 72, reaction: 5, standing: 3100, floor: 3000, ceiling: 9000 },
  { ...base, eventId: "e:30", kind: "title_owned", characterKey: "0a1b2c3d", class: "MAGE", level: 30, titleIds: [4] },
  { ...base, eventId: "e:31", kind: "quest_owned", characterKey: "0a1b2c3d", class: "MAGE", level: 30, questIds: [7] },
  // Read by the market rollup, never by a corpus tool: no TOOL_KINDS entry lists it.
  { ...base, eventId: "e:23", kind: "auction_snapshot", realm: "Forever", scanId: "scan-1", part: 1, parts: 1, items: [[5, 1, 1, 10, 10]] },
  // Read by the guild ladder through the host's guild reader (kb/src/guilds.ts), never by a corpus tool.
  { ...base, eventId: "e:41", kind: "guild_kill", ...guild, faction: "horde", encounterId: 663, name: "Lucifron", instanceMapId: 409, difficulty: 9, size: 40 },
  // Census rows are published only as counts, never read by a corpus tool.
  { ...base, eventId: "e:32", kind: "census_self", guid: "Player-4395-0A1B2C3D", race: "Orc", class: "WARRIOR", level: 30, faction: "Horde", realm: "Forever" },
  // Player rows go to the player pages, never to a corpus tool.
  { ...base, eventId: "e:34", kind: "player_seen", name: "Thrallina", realm: "Forever", race: "Orc", class: "SHAMAN", level: 24, guild: "Night Watch" },
  // Link rows go to the account's link endpoint and are never stored, so no tool can read one.
  { ...base, eventId: "e:35", kind: "character_link", code: "EL-7K3Q-9P", name: "Thrallina", realm: "Forever", race: "Orc", class: "SHAMAN", level: 24, faction: "Horde", guid: "Player-4395-0A1B2C3D", completionKey: "0a1b2c3d" },
  { ...base, eventId: "e:33", kind: "census_seen", guid: "Player-4395-0F00BA44", race: "Human", class: "MAGE", level: 60, faction: "Alliance", via: "target" },
  { ...base, eventId: "e:22", kind: "talent_snapshot", class: "MAGE", level: 30, group: 1, active: true, configId: 7, treeId: 786, exportStatus: "unavailable", points: 2, nodes: [{ nodeId: 90001, ranks: 2 }] },
]);

const FACTS: Record<keyof typeof TOOL_KINDS, (records: unknown[]) => unknown> = {
  answer_sources: answerSourcesFactsFromRecords,
  profession_path: pathFactsFromRecords,
  recipe_thresholds: recipeFactsFromRecords,
  item_page: itemToolFactsFromRecords,
  npc_page: npcFactsFromRecords,
  object_page: objectFactsFromRecords,
  quest_page: worldFactsFromRecords,
  vendor_page: worldFactsFromRecords,
  world_map_near: mapFactsFromRecords,
  entity_relations: observedEdgesFromRecords,
  collection_gap: collectionFactsFromRecords,
  guild_board: guildFactsFromRecords,
  auction_history: auctionSightingsFromRecords,
  gold_ledger: goldFactsFromRecords,
};

test("the fixture covers every record kind", () => {
  expect(EVERY_KIND.receipt.rejected).toEqual([]);
  expect(new Set(EVERY_KIND.records.map((r) => r.kind))).toEqual(new Set(ALL_RECORD_KINDS));
});

test("each tool's kinds give the same facts as the whole corpus", () => {
  for (const [tool, kinds] of Object.entries(TOOL_KINDS) as [keyof typeof TOOL_KINDS, readonly string[]][]) {
    const narrowed = EVERY_KIND.records.filter((r) => kinds.includes(r.kind));
    expect(FACTS[tool](narrowed), tool).toEqual(FACTS[tool](EVERY_KIND.records));
    expect(narrowed.length, tool).toBeGreaterThan(0);
  }
});

test("no corpus tool reads a completion kind: completion_progress reads the rollup", () => {
  for (const [tool, kinds] of Object.entries(TOOL_KINDS)) for (const kind of COMPLETION_KINDS) expect(kinds, tool).not.toContain(kind);
});

test("no corpus tool reads a census, player or link kind: the census is published as counts only", () => {
  for (const [tool, kinds] of Object.entries(TOOL_KINDS)) for (const kind of [...CENSUS_KINDS, ...PLAYER_KINDS, ...LINK_KINDS]) expect(kinds, tool).not.toContain(kind);
});

test("a tool asks the public corpus for its kinds only", async () => {
  vi.stubEnv("EVERLOOT_PUBLIC_CORPUS_URL", "https://everloot.example/api/corpus/public");
  const send = vi.fn().mockResolvedValue(Response.json({ ok: true, records: [] }));
  vi.stubGlobal("fetch", send);
  try {
    await fromUploads(() => "ok", TOOL_KINDS.auction_history);
    expect(send.mock.calls[0][0]).toBe("https://everloot.example/api/corpus/public?kinds=auction_scan");
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

test("an in-process corpus loader (the site's own /mcp route) wins over the URL and needs no HTTP", async () => {
  vi.stubEnv("EVERLOOT_PUBLIC_CORPUS_URL", "https://everloot.example/api/corpus/public");
  const send = vi.fn();
  vi.stubGlobal("fetch", send);
  try {
    const loader = vi.fn(async () => ({ records: EVERY_KIND.records, dataAsOf: "2026-10-10T06:30:00.000Z" }));
    const answer = await fromUploads((records) => `kinds:${[...new Set((records as { kind: string }[]).map((r) => r.kind))].join(",")}`,
      TOOL_KINDS.gold_ledger, loader);
    expect(answer).toBe(`kinds:gold_snapshot,money_event\nData as of 2026-10-10 06:30 UTC.\n${MCP_CREDIT}`);
    expect(send).not.toHaveBeenCalled();
    const down = await fromUploads(() => "renderer must not run", TOOL_KINDS.auction_history, async () => null);
    expect(down).toMatch(/unavailable/i);
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

test("with no corpus source the answer names both settings, and is not a zero", () => {
  expect(UPLOADS_UNSET).toContain("EVERLOOT_PUBLIC_CORPUS_URL");
  expect(UPLOADS_UNSET).toContain("not a measured zero");
});
