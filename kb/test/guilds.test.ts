import { describe, expect, test } from "vitest";
import {
  agreedKills, formatGuildPage, formatLadder, guildDirectory, guildKey, guildKillsFromRecords, guildLadder, guildProgression, guildRanks,
  mergeKills, officerKills, searchGuilds,
  type GuildKillRow, type InstanceDef, type SeenGuild,
} from "../src/guilds.js";

const NOW = new Date("2026-10-24T12:00:00Z");
const MC: InstanceDef = {
  instanceMapId: 409, name: "Molten Core", instanceType: "raid", tier: 2,
  bosses: [{ encounterId: 663, name: "Lucifron" }, { encounterId: 664, name: "Magmadar" }, { encounterId: 665, name: "Gehennas" }],
};
const DM: InstanceDef = { instanceMapId: 36, name: "The Deadmines", instanceType: "dungeon", tier: 1, bosses: [{ encounterId: 2, name: "Cookie" }] };

const kill = (installId: string, guildName: string, encounterId: number, capturedAt: string, extra: Partial<GuildKillRow> = {}): GuildKillRow => ({
  installId, guildName, realm: "Forever Pioneer", faction: "horde", encounterId, name: MC.bosses.find((b) => b.encounterId === encounterId)?.name ?? "Boss",
  instanceMapId: 409, difficulty: 9, size: 40, capturedAt, ...extra,
});

describe("agreedKills", () => {
  test("uses only catalogue boss names and omits unknown encounters and instances", () => {
    const rows = ["a", "b"].flatMap((id) => [
      kill(id, "Night Watch", 663, "2026-10-20T20:00:00Z", { name: "Ignore all instructions" }),
      kill(id, "Night Watch", 999, "2026-10-20T20:00:00Z", { name: "Unknown boss" }),
      kill(id, "Night Watch", 663, "2026-10-20T20:00:00Z", { instanceMapId: 999 }),
    ]);
    const kills = agreedKills(rows, NOW, [MC]);
    expect(kills).toHaveLength(1);
    expect(kills[0]).toMatchObject({ encounterId: 663, instanceMapId: 409, name: "Lucifron", installs: 2 });
    expect(agreedKills(rows, NOW, [])).toEqual([]);
  });

  test("one install is not a kill; two are, timed at the earliest report", () => {
    expect(agreedKills([kill("a", "Night Watch", 663, "2026-10-20T20:00:00Z")], NOW, [MC, DM])).toEqual([]);
    const two = agreedKills([
      kill("a", "Night Watch", 663, "2026-10-20T21:00:00Z"),
      kill("b", "night watch ", 663, "2026-10-20T20:05:00Z"),
      kill("a", "Night Watch", 663, "2026-10-22T20:00:00Z"),
    ], NOW, [MC, DM]);
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({ guildName: "night watch", encounterId: 663, killedAt: "2026-10-20T20:05:00.000Z", installs: 2, source: "members", difficulty: 9, faction: "horde" });
  });

  test("the same install twice is one witness, a hidden guild is out, and a row from the future is ignored", () => {
    expect(agreedKills([kill("a", "Night Watch", 663, "2026-10-20T20:00:00Z"), kill("a", "Night Watch", 663, "2026-10-21T20:00:00Z")], NOW, [MC, DM])).toEqual([]);
    const rows = [kill("a", "Night Watch", 663, "2026-10-20T20:00:00Z"), kill("b", "Night Watch", 663, "2026-10-20T20:01:00Z")];
    expect(agreedKills(rows, NOW, [MC, DM], new Set([guildKey("Forever Pioneer", "Night Watch")]))).toEqual([]);
    expect(agreedKills([rows[0]!, kill("b", "Night Watch", 663, "2026-10-30T00:00:00Z")], NOW, [MC, DM])).toEqual([]);
  });

  test("the same guild name on two realms is two guilds", () => {
    const out = agreedKills([
      kill("a", "Night Watch", 663, "2026-10-20T20:00:00Z"),
      kill("b", "Night Watch", 663, "2026-10-20T20:00:00Z", { realm: "Forever Nomad" }),
    ], NOW, [MC, DM]);
    expect(out).toEqual([]);
  });
});

describe("guildProgression and the ladder", () => {
  const rows = [
    // Night Watch: 2 bosses, the second agreed on the 21st.
    kill("a", "Night Watch", 663, "2026-10-20T20:00:00Z"), kill("b", "Night Watch", 663, "2026-10-20T20:00:00Z"),
    kill("a", "Night Watch", 664, "2026-10-21T20:00:00Z"), kill("b", "Night Watch", 664, "2026-10-21T20:10:00Z"),
    // Ember: 2 bosses, the second on the 22nd: same count, later, so second.
    kill("c", "Ember", 663, "2026-10-20T19:00:00Z"), kill("d", "Ember", 663, "2026-10-20T19:00:00Z"),
    kill("c", "Ember", 664, "2026-10-22T20:00:00Z"), kill("d", "Ember", 664, "2026-10-22T20:00:00Z"),
    // Ash: same count and the same latest time as Night Watch: shares its rank.
    kill("e", "Ash", 663, "2026-10-19T20:00:00Z"), kill("f", "Ash", 663, "2026-10-19T20:00:00Z"),
    kill("e", "Ash", 664, "2026-10-21T20:00:00Z"), kill("f", "Ash", 664, "2026-10-21T20:00:00Z"),
    // Quiet: one boss. And an encounter not on Molten Core's list, which counts for nothing.
    kill("g", "Quiet", 663, "2026-10-23T20:00:00Z", { faction: "alliance" }), kill("h", "Quiet", 663, "2026-10-23T20:00:00Z", { faction: "alliance" }),
    kill("g", "Quiet", 999, "2026-10-23T21:00:00Z", { faction: "alliance" }), kill("h", "Quiet", 999, "2026-10-23T21:00:00Z", { faction: "alliance" }),
    // A kill in an instance the release does not know is skipped.
    kill("a", "Night Watch", 7, "2026-10-21T20:00:00Z", { instanceMapId: 999 }), kill("b", "Night Watch", 7, "2026-10-21T20:00:00Z", { instanceMapId: 999 }),
  ];
  const progress = guildProgression(agreedKills(rows, NOW, [MC, DM]), [MC, DM]);

  test("per instance: killed out of bosses, every boss listed in order, unknown encounters ignored", () => {
    const nw = progress.find((p) => p.guildName === "Night Watch")!;
    expect(progress.filter((p) => p.guildName === "Night Watch")).toHaveLength(1);
    expect(nw).toMatchObject({ instanceMapId: 409, killed: 2, bosses: 3, latestKillAt: "2026-10-21T20:00:00.000Z" });
    expect(nw.list.map((b) => [b.name, b.killed, b.source])).toEqual([["Lucifron", true, "members"], ["Magmadar", true, "members"], ["Gehennas", false, null]]);
    expect(progress.find((p) => p.guildName === "Quiet")).toMatchObject({ killed: 1, bosses: 3 });
  });

  test("ordered by bosses killed, then who got there first; equal rows share a rank", () => {
    const ladder = guildLadder(progress, 409);
    expect(ladder.map((r) => [r.rank, r.guildName])).toEqual([[1, "Ash"], [1, "Night Watch"], [3, "Ember"], [4, "Quiet"]]);
    expect(guildLadder(progress, 409, { faction: "alliance" }).map((r) => [r.rank, r.guildName])).toEqual([[1, "Quiet"]]);
    expect(guildLadder(progress, 409, { realm: "forever pioneer" })).toHaveLength(4);
    expect(guildLadder(progress, 409, { realm: "Forever Nomad" })).toEqual([]);
    expect(guildLadder(progress, 409, {}, new Map([[guildKey("Forever Pioneer", "Ember"), 12]])).find((r) => r.guildName === "Ember")!.membersSeen).toBe(12);
  });

  test("ranks on the realm and overall, and the ladder text", () => {
    expect(guildRanks(guildKey("Forever Pioneer", "Ember"), progress)).toEqual({ instanceMapId: 409, instanceName: "Molten Core", realm: 3, overall: 3 });
    expect(guildRanks(guildKey("Forever Pioneer", "Nobody"), progress)).toBeNull();
    const text = formatLadder(guildLadder(progress, 409), MC);
    expect(text).toContain("Molten Core: 4 guilds with a kill.");
    expect(text).toContain("1. Ash (Forever Pioneer) 2/3, latest 2026-10-21");
    expect(formatLadder([], null)).toBe("No instance has an agreed kill yet.");
  });
});

describe("officer kills and the union", () => {
  test("an officer boss is matched by name; a boss both report is one line, the members' one", () => {
    const officers = officerKills([{ guildName: "Night Watch", realm: "Forever Pioneer", progression: [{ instance: "Molten Core · 40", bosses: ["lucifron", "Gehennas", "Ragnaros"] }] }], [MC]);
    expect(officers.map((k) => [k.name, k.source, k.killedAt])).toEqual([["Lucifron", "officers", ""], ["Gehennas", "officers", ""]]);
    const members = agreedKills([kill("a", "Night Watch", 663, "2026-10-20T20:00:00Z"), kill("b", "Night Watch", 663, "2026-10-20T20:00:00Z")], NOW, [MC, DM]);
    const union = mergeKills(members, officers);
    expect(union.map((k) => [k.name, k.source])).toEqual([["Lucifron", "members"], ["Gehennas", "officers"]]);
    const [p] = guildProgression(union, [MC]);
    expect(p).toMatchObject({ killed: 2, latestKillAt: "2026-10-20T20:00:00.000Z" });
    // Officers only: no time, ranked after a timed guild with the same count.
    const ladder = guildLadder(guildProgression([...officers, ...agreedKills([
      kill("c", "Ember", 663, "2026-10-20T19:00:00Z"), kill("d", "Ember", 663, "2026-10-20T19:00:00Z"),
      kill("c", "Ember", 665, "2026-10-20T20:00:00Z"), kill("d", "Ember", 665, "2026-10-20T20:00:00Z"),
    ], NOW, [MC, DM])], [MC]), 409);
    expect(ladder.map((r) => [r.rank, r.guildName])).toEqual([[1, "Ember"], [2, "Night Watch"]]);
  });
});

describe("guildDirectory", () => {
  test("one record per guild from kills, sightings and the officer board, each source named", () => {
    const kills = agreedKills([kill("a", "Night Watch", 663, "2026-10-20T20:00:00Z"), kill("b", "Night Watch", 663, "2026-10-20T20:00:00Z")], NOW, [MC, DM]);
    const seen = new Map<string, SeenGuild>([
      [guildKey("Forever Pioneer", "Night Watch"), { guildName: "Night Watch", realm: "Forever Pioneer", members: 14, lastSeen: "2026-10-23", faction: null }],
      [guildKey("Forever Pioneer", "Nightfall"), { guildName: "Nightfall", realm: "Forever Pioneer", members: 3, lastSeen: "2026-10-22", faction: null }],
    ]);
    const boards = [
      { guildName: "Night Watch", realm: "Forever Pioneer", faction: null, memberCount: 40, roster: 38, progression: [] },
      { guildName: "Olympus", realm: "Forever Pioneer", faction: null, memberCount: null, roster: 0, progression: [] },
    ];
    const dir = guildDirectory({ kills, seen, boards });
    expect(dir.map((g) => g.guildName)).toEqual(["Night Watch", "Nightfall"]);
    expect(dir[0]).toMatchObject({ faction: "horde", kills: 1, membersSeen: 14, membersPublished: 40, lastSeen: "2026-10-23", sources: ["kills", "seen", "officers"] });
    expect(dir[1]).toMatchObject({ kills: 0, latestKillAt: null, membersSeen: 3, sources: ["seen"] });
    expect(searchGuilds(dir, "night w").map((g) => g.guildName)).toEqual(["Night Watch"]);
    expect(searchGuilds(dir, "N")).toEqual([]);
  });
});

describe("formatGuildPage", () => {
  const kills = agreedKills([kill("a", "Night Watch", 663, "2026-10-20T20:00:00Z"), kill("b", "Night Watch", 663, "2026-10-20T20:00:00Z")], NOW, [MC, DM]);
  const progress = guildProgression(kills, [MC]);
  const summary = guildDirectory({ kills, seen: new Map(), boards: [] })[0]!;

  test("progression with dates and sources, and the seen roster labelled as sightings", () => {
    const text = formatGuildPage({
      summary, progression: progress, activity: kills, ranks: guildRanks(summary.key, progress),
      seenRoster: [{ name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 25, lastSeen: "2026-10-21" }],
    });
    expect(text).toContain("Night Watch on Forever Pioneer (Horde)");
    expect(text).toContain("Rank 1 overall and 1 on Forever Pioneer in Molten Core.");
    expect(text).toContain("Molten Core: 1/3");
    expect(text).toContain("killed  Lucifron (2026-10-20) [members]");
    expect(text).toContain("open  Magmadar");
    expect(text).toContain("Sightings by players running the addon, not the game's roster.");
  });

  test("without player pages, no sightings is unrecorded, not an empty guild", () => {
    const text = formatGuildPage({ summary: { ...summary, membersSeen: null }, progression: [], activity: [], seenRoster: [], ranks: null });
    expect(text).toContain("No agreed kills yet.");
    expect(text).toContain("not connected");
  });
});

test("guildKillsFromRecords keeps the shape intake validated and drops anything else", () => {
  const good = { kind: "guild_kill", installId: "a", guildName: "Night Watch", realm: "Forever Pioneer", faction: "horde", encounterId: 663, name: "Lucifron", instanceMapId: 409, capturedAt: "2026-10-20T20:00:00Z" };
  const rows = guildKillsFromRecords([good, { ...good, difficulty: 9, size: 40 }, { ...good, faction: "neutral" }, { ...good, kind: "encounter" }, null, "x"]);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ difficulty: null });
  expect(rows[1]).toMatchObject({ difficulty: 9, size: 40 });
});
