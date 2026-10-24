import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MCP_TOOLS } from "@everloot/protocol";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { openDb, type DB } from "../src/db.js";
import { guildBoard, guildFactsFromRecords } from "../src/guild-board.js";
import {
  agreedKills, guildDirectory, guildProgression, guildRanks, searchGuilds,
  type GuildKillRow, type GuildPage, type GuildReader, type InstanceDef,
} from "../src/guilds.js";
import { createKnowledgeServer, type ToolOptions } from "../src/mcp-server.js";

const OUT = {
  guild_board: z.object(MCP_TOOLS.guild_board.outputSchema),
  guild_search: z.object(MCP_TOOLS.guild_search.outputSchema),
  guild_rankings: z.object(MCP_TOOLS.guild_rankings.outputSchema),
};
const AS_OF = "2026-10-24T10:00:00.000Z";
const MC: InstanceDef = { instanceMapId: 409, name: "Molten Core", instanceType: "raid", tier: 2, bosses: [{ encounterId: 663, name: "Lucifron" }, { encounterId: 664, name: "Magmadar" }] };
const DM: InstanceDef = { instanceMapId: 36, name: "The Deadmines", instanceType: "dungeon", tier: 1, bosses: [{ encounterId: 2, name: "Cookie" }] };

const row = (installId: string, guildName: string, encounterId: number, instanceMapId: number, capturedAt: string): GuildKillRow => ({
  installId, guildName, realm: "Forever Pioneer", faction: "horde", encounterId, name: "Boss", instanceMapId, difficulty: 9, capturedAt,
});
const kills = agreedKills([
  row("a", "Night Watch", 663, 409, "2026-10-20T20:00:00Z"), row("b", "Night Watch", 663, 409, "2026-10-20T20:00:00Z"),
  row("a", "Night Watch", 664, 409, "2026-10-21T20:00:00Z"), row("b", "Night Watch", 664, 409, "2026-10-21T20:00:00Z"),
  row("c", "Ember", 663, 409, "2026-10-22T20:00:00Z"), row("d", "Ember", 663, 409, "2026-10-22T20:00:00Z"),
  row("c", "Ember", 2, 36, "2026-10-19T20:00:00Z"), row("d", "Ember", 2, 36, "2026-10-19T20:00:00Z"),
], new Date(AS_OF));
const progress = guildProgression(kills, [MC, DM]);
const directory = guildDirectory({ kills, seen: new Map(), boards: [] });

/** A reader over fixtures, as the site lends one when EVERLOOT_GUILDS is on. */
const reader: GuildReader = {
  ladder: async () => ({ instances: [MC, DM], progress, dataAsOf: AS_OF }),
  search: async (prefix, limit) => ({ guilds: searchGuilds(directory, prefix, limit), dataAsOf: AS_OF }),
  page: async (guildName, realm) => {
    const summary = directory.find((g) => g.guildName.toLowerCase() === guildName.toLowerCase() && g.realm.toLowerCase() === realm.toLowerCase());
    if (!summary) return { page: null, dataAsOf: AS_OF };
    const page: GuildPage = {
      summary: { ...summary, membersSeen: 1 }, progression: progress.filter((p) => p.key === summary.key),
      activity: kills.filter((k) => k.key === summary.key).reverse(), ranks: guildRanks(summary.key, progress),
      seenRoster: [{ name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 25, lastSeen: "2026-10-21" }],
    };
    return { page, dataAsOf: AS_OF };
  },
};

const officers: unknown[] = ["a", "b"].map((installId) => ({
  installId, kind: "guild_snapshot", claimToken: "x".repeat(16), guildName: "Night Watch", realm: "Forever Pioneer",
  members: [{ name: "Ada", rank: "Officer", level: 60, class: "Mage" }],
}));

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

async function client(options: ToolOptions) {
  const db = openDb(":memory:");
  databases.push(db);
  const server = createKnowledgeServer(db, options);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const c = new Client({ name: "test", version: "0" });
  await c.connect(clientSide);
  return c;
}
const corpus = async () => ({ records: officers, dataAsOf: AS_OF });

test("without a guild reader the two ladder tools are not listed, and guild_board answers as before", async () => {
  const c = await client({ corpus });
  const names = (await c.listTools()).tools.map((t) => t.name);
  expect(names).not.toContain("guild_search");
  expect(names).not.toContain("guild_rankings");
  const board = await c.callTool({ name: "guild_board", arguments: { guildName: "Night Watch", realm: "Forever Pioneer" } });
  const parsed = OUT.guild_board.parse(board.structuredContent);
  expect(parsed.page).toEqual(guildBoard("Night Watch", "Forever Pioneer", guildFactsFromRecords(officers)));
  expect(parsed.page).not.toHaveProperty("ladderProgression");
  const unknown = await c.callTool({ name: "guild_rankings", arguments: {} });
  expect(unknown.isError).toBe(true);
});

test("guild_search lists guilds by the start of the name, under its output schema", async () => {
  const c = await client({ corpus, guilds: reader });
  const answer = await c.callTool({ name: "guild_search", arguments: { query: "night" } });
  const parsed = OUT.guild_search.parse(answer.structuredContent);
  expect(parsed).toMatchObject({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/guilds?q=night" });
  expect(parsed.page!.guilds).toEqual([{ guildName: "Night Watch", realm: "Forever Pioneer", faction: "horde", membersSeen: null, kills: 2, latestKillAt: "2026-10-21T20:00:00.000Z" }]);
  expect(JSON.stringify(answer.content)).toContain("Night Watch, Forever Pioneer (Horde): 2 agreed kills, latest 2026-10-21; members seen unrecorded");
  const none = await c.callTool({ name: "guild_search", arguments: { query: "zz" } });
  expect(OUT.guild_search.parse(none.structuredContent).page!.guilds).toEqual([]);
  expect(JSON.stringify(none.content)).toContain('No guild starts with \\"zz\\"');
});

test("guild_rankings ranks the newest raid with a kill by default, and an instance, realm and faction on request", async () => {
  const c = await client({ corpus, guilds: reader });
  const ladder = OUT.guild_rankings.parse((await c.callTool({ name: "guild_rankings", arguments: {} })).structuredContent);
  expect(ladder.page!.instance).toEqual({ instanceMapId: 409, name: "Molten Core" });
  expect(ladder.page!.rows.map((r) => [r.rank, r.guildName, r.killed, r.bosses])).toEqual([[1, "Night Watch", 2, 2], [2, "Ember", 1, 2]]);
  expect(ladder.url).toBe("https://everloot.app/guilds?instance=409");
  const dm = OUT.guild_rankings.parse((await c.callTool({ name: "guild_rankings", arguments: { instanceMapId: 36 } })).structuredContent);
  expect(dm.page!.rows.map((r) => r.guildName)).toEqual(["Ember"]);
  const alliance = OUT.guild_rankings.parse((await c.callTool({ name: "guild_rankings", arguments: { faction: "alliance" } })).structuredContent);
  expect(alliance.page!.rows).toEqual([]);
  const unknown = await c.callTool({ name: "guild_rankings", arguments: { instanceMapId: 999 } });
  expect(OUT.guild_rankings.parse(unknown.structuredContent).page).toEqual({ instance: null, rows: [] });
  expect(JSON.stringify(unknown.content)).toContain("No agreed kill in instance 999 yet.");
});

test("guild_board's output stays a superset: the officer board as before, plus the ladder side", async () => {
  const c = await client({ corpus, guilds: reader });
  const answer = await c.callTool({ name: "guild_board", arguments: { guildName: "Night Watch", realm: "Forever Pioneer" } });
  const parsed = OUT.guild_board.parse(answer.structuredContent);
  expect(parsed.page).toMatchObject(guildBoard("Night Watch", "Forever Pioneer", guildFactsFromRecords(officers)));
  expect(parsed.page!.ladderProgression![0]).toMatchObject({ instanceMapId: 409, name: "Molten Core", killed: 2, bosses: 2 });
  expect(parsed.page!.ladderProgression![0]!.list[0]).toEqual({ encounterId: 663, name: "Lucifron", killed: true, killedAt: "2026-10-20T20:00:00.000Z", source: "members" });
  expect(parsed.page!.activity!.map((k) => k.encounterId)).toEqual([664, 663]);
  expect(parsed.page!.seenRoster).toEqual({ count: 1, members: [{ name: "Thrallina", level: 25, class: "SHAMAN", lastSeen: "2026-10-21" }] });
  expect(parsed.page!.ranks).toEqual({ instanceMapId: 409, instanceName: "Molten Core", realm: 1, overall: 1 });
  expect(parsed.url).toBe("https://everloot.app/guilds/forever-pioneer/night-watch");
  const text = JSON.stringify(answer.content);
  expect(text).toContain("Molten Core: 2/2");
  expect(text).toContain("not the game's roster");
});

test("a reader that fails is unrecorded, not zero", async () => {
  const broken: GuildReader = { ladder: async () => null, search: async () => { throw new Error("down"); }, page: async () => null };
  const c = await client({ corpus, guilds: broken });
  const ladder = await c.callTool({ name: "guild_rankings", arguments: {} });
  expect(ladder.structuredContent).toMatchObject({ connected: false, reason: expect.stringContaining("not zero") });
  const search = await c.callTool({ name: "guild_search", arguments: { query: "night" } });
  expect(search.structuredContent).toMatchObject({ connected: false });
  const board = await c.callTool({ name: "guild_board", arguments: { guildName: "Night Watch", realm: "Forever Pioneer" } });
  expect(JSON.stringify(board.content)).toContain("Guild data unavailable");
});
