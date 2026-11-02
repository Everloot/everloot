import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createMemoryPlayerStore, type PlayerStore } from "@/lib/player-store";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("next/cache", () => ({ unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn, revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const AS_OF = "2026-10-24T10:00:00.000Z";
const holder = vi.hoisted(() => ({ store: null as PlayerStore | null, records: [] as unknown[], unreachable: false, reads: 0 }));
vi.mock("@/lib/player-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/player-store")>()), playerStore: () => holder.store }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: {
    loadCorpus: async () => {
      holder.reads += 1;
      return holder.unreachable
        ? { uploads: 0, records: [], dataAsOf: null, unreachable: true }
        : { uploads: holder.records.length, records: holder.records, dataAsOf: "2026-10-24T10:00:00.000Z" };
    },
  },
}));

const base = (installId: string, i: number) => ({ installId, eventId: `${installId}:${i}`, capturedAt: "2026-10-20T20:00:00Z" });
/** Molten Core and its two bosses, as three installs agree on them. */
const world = ["w1", "w2", "w3"].flatMap((id) => [
  { ...base(id, 1), kind: "instance_entrance", instanceMapId: 409, name: "Molten Core", instanceType: "raid", mapId: 1415, x: 30, y: 80 },
  { ...base(id, 2), kind: "encounter", encounterId: 663, name: "Lucifron", instanceMapId: 409, success: true, npcIds: [12118] },
  { ...base(id, 3), kind: "encounter", encounterId: 664, name: "Magmadar", instanceMapId: 409, success: true, npcIds: [11982] },
]);
const kill = (installId: string, guildName: string, encounterId: number, name: string, capturedAt: string, instanceMapId = 409) => ({
  kind: "guild_kill", installId, eventId: `${installId}:${guildName}:${encounterId}`, capturedAt,
  guildName, realm: "Forever Pioneer", faction: "horde", encounterId, name, instanceMapId, difficulty: 9, size: 40,
});
const memberKills = [
  kill("a", "Night Watch", 663, "Lucifron", "2026-10-20T20:00:00Z"), kill("b", "Night Watch", 663, "Lucifron", "2026-10-20T20:05:00Z"),
  kill("a", "Night Watch", 664, "Magmadar", "2026-10-21T20:00:00Z"), kill("b", "Night Watch", 664, "Magmadar", "2026-10-21T20:00:00Z"),
  kill("c", "Ember", 663, "Lucifron", "2026-10-22T20:00:00Z"), kill("d", "Ember", 663, "Lucifron", "2026-10-22T20:00:00Z"),
  // One install only: not a kill.
  kill("e", "Lonely", 663, "Lucifron", "2026-10-22T20:00:00Z"),
];
/** The Iron Oath's officers publish a board: a roster and Lucifron. */
const officers = ["o1", "o2"].flatMap((installId) => [
  { installId, kind: "guild_snapshot", claimToken: "x".repeat(16), guildName: "Iron Oath", realm: "Forever Pioneer", faction: "alliance", members: [{ name: "Ada", rank: "Officer", level: 60, class: "Mage" }] },
  { installId, kind: "raid_lockout", claimToken: "x".repeat(16), guildName: "Iron Oath", realm: "Forever Pioneer", instance: "Molten Core", difficulty: "40", bossesKilled: ["Lucifron"], resetAt: "2026-10-28T00:00:00Z" },
]);

beforeEach(async () => {
  holder.store = createMemoryPlayerStore(() => new Date(AS_OF));
  holder.records = [...world, ...memberKills, ...officers];
  holder.unreachable = false;
  holder.reads = 0;
  await holder.store.upsert([
    { name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 25, guild: "Night Watch", seen: "2026-10-21" },
    { name: "Throgar", realm: "Forever Pioneer", race: "Orc", class: "WARRIOR", level: 30, guild: "Night Watch", seen: "2026-10-23" },
  ]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.useRealTimers(); });

const on = () => vi.stubEnv("EVERLOOT_GUILDS", "1");
const hub = async (search: Record<string, string> = {}) => {
  const { default: Guilds } = await import("./page");
  return renderToStaticMarkup(await Guilds({ searchParams: Promise.resolve(search) }));
};
const guildPage = async (slug: string, guild: string) => {
  const { default: Guild } = await import("./[slug]/[guild]/page");
  return renderToStaticMarkup(await Guild({ params: Promise.resolve({ slug, guild }) }));
};

test("with the switch off every guild page is a 404 and nothing is read", async () => {
  const members = vi.spyOn(holder.store!, "guildMembers");
  const hidden = vi.spyOn(holder.store!, "hiddenGuilds");
  const { default: Guilds, generateMetadata } = await import("./page");
  const { default: Guild } = await import("./[slug]/[guild]/page");
  const { default: Hide } = await import("./hide/page");
  await expect(Guilds({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(Guild({ params: Promise.resolve({ slug: "forever-pioneer", guild: "night-watch" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(Hide({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(await generateMetadata({ searchParams: Promise.resolve({}) })).toEqual({});
  expect(holder.reads).toBe(0);
  expect(members).not.toHaveBeenCalled();
  expect(hidden).not.toHaveBeenCalled();
});

test("before any agreed kill the hub shows the start state, not an empty table", async () => {
  on();
  holder.records = [...world, memberKills[6]!];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  const before = await hub();
  expect(before).toContain("Ranking starts when raids open on December 9.");
  expect(before).toContain("What will be here");
  expect(before).not.toContain("<table");
  expect(before).toContain('href="/tools/guild-board"');
  vi.setSystemTime(new Date("2026-12-10T12:00:00Z"));
  const after = await hub();
  expect(after).toContain("The ladder starts with the first kill two members report.");
  expect(after).not.toContain("December 9");
});

/** Ragefire Chasm, a dungeon with one boss, as three installs agree on it. */
const dungeon = ["w1", "w2", "w3"].flatMap((id) => [
  { ...base(id, 4), kind: "instance_entrance", instanceMapId: 389, name: "Ragefire Chasm", instanceType: "party", mapId: 1454, x: 50, y: 50 },
  { ...base(id, 5), kind: "encounter", encounterId: 1443, name: "Taragaman", instanceMapId: 389, success: true, npcIds: [11520] },
]);

test("with dungeon clears only, the hub says when raid ranking starts and labels the ladder a dungeon", async () => {
  on();
  holder.records = [...dungeon, ...["a", "b"].map((id) => kill(id, "Night Watch", 1443, "Taragaman", "2026-10-22T20:00:00Z", 389))];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
  const html = await hub();
  expect(html).toContain("Ranking starts when raids open on December 9.");
  expect(html).toContain("Ragefire Chasm");
  expect(html).toContain("A dungeon: bosses cleared");
  expect(html).toContain(">Night Watch</a>");
});

test("each ladder row carries its world, ruleset and faction rank, a boss strip and the first kill per boss", async () => {
  on();
  const html = await hub();
  expect(html).toContain("World 1 · Forever 1 · Horde 1");
  expect(html).toContain("World 2 · Forever 2 · Horde 2");
  // Officers only: no faction, so no faction rank.
  expect(html).toMatch(/World 3 · Forever 3<\/span>/);
  expect(html).toContain("Lucifron: killed 2026-10-20");
  expect(html).toContain("Magmadar: not yet");
  expect(html).toContain("First kills");
  const firsts = html.slice(html.indexOf("First kills in Molten Core"));
  expect(firsts).toContain(">Night Watch</a>");
  expect(firsts).toContain("2026-10-21");
  expect(firsts).not.toContain("Iron Oath");
});

test("the ruleset filter keeps the realms of that ruleset and ignores a malformed one", async () => {
  on();
  // Every guild is on one ruleset, so the ladder offers no ruleset menu until the address picks one.
  const plain = await hub();
  expect(plain).not.toContain("Every ruleset");
  expect(plain).not.toContain("ruleset=");
  expect(plain).toContain("Every realm");
  const forever = await hub({ ruleset: "forever" });
  expect(forever).toContain("Every ruleset");
  expect(forever).toContain(">Night Watch</a>");
  expect(forever).toContain('href="/guilds?ruleset=forever"');
  const other = await hub({ ruleset: "hardcore" });
  expect(other).toContain("No guild matches these filters yet.");
  expect(other).not.toContain(">Night Watch</a>");
  const { parseLadderQuery } = await import("@/lib/guilds");
  expect(parseLadderQuery({ ruleset: "<script>" })).toEqual({});
  expect(parseLadderQuery({ ruleset: "Forever" })).toEqual({ ruleset: "forever" });
});

test("a first kill needs two installs on one kill: reports a week apart never beat a kill two installs saw together", async () => {
  const { bossFirsts } = await import("@/lib/guilds");
  const { agreedKills, guildKey, guildProgression } = await import("../../../../kb/src/guilds");
  const mc = { instanceMapId: 409, name: "Molten Core", instanceType: "raid" as const, tier: 2, bosses: [{ encounterId: 663, name: "Lucifron" }] };
  const rows = [
    kill("a", "Ashen", 663, "Lucifron", "2026-12-09T20:00:00Z"), kill("b", "Ashen", 663, "Lucifron", "2026-12-16T20:00:00Z"),
    kill("c", "Bastion", 663, "Lucifron", "2026-12-10T20:00:00Z"), kill("d", "Bastion", 663, "Lucifron", "2026-12-10T20:03:00Z"),
  ] as Parameters<typeof agreedKills>[0];
  const progress = guildProgression(agreedKills(rows, new Date("2026-12-20T00:00:00Z"), [mc]), [mc]);
  // Both guilds have the boss on the ladder; only Bastion's kill is one two installs saw.
  expect(progress.map((p) => [p.guildName, p.killed])).toEqual([["Ashen", 1], ["Bastion", 1]]);
  expect(bossFirsts(mc, progress)).toEqual([
    { encounterId: 663, name: "Lucifron", killedAt: "2026-12-10T20:00:00.000Z", guilds: [{ key: guildKey("Forever Pioneer", "Bastion"), guildName: "Bastion", realm: "Forever Pioneer" }] },
  ]);
});

test("guilds with the same first-kill time share the first, in name order whatever the input order", async () => {
  on();
  const { bossFirsts } = await import("@/lib/guilds");
  const { agreedKills, guildProgression } = await import("../../../../kb/src/guilds");
  const mc = { instanceMapId: 409, name: "Molten Core", instanceType: "raid" as const, tier: 2, bosses: [{ encounterId: 663, name: "Lucifron" }] };
  const at = "2026-10-20T20:00:00Z";
  const rows = [kill("a", "Zephyr", 663, "Lucifron", at), kill("b", "Zephyr", 663, "Lucifron", at), kill("c", "Anvil", 663, "Lucifron", at), kill("d", "Anvil", 663, "Lucifron", at)] as Parameters<typeof agreedKills>[0];
  const progress = guildProgression(agreedKills(rows, new Date(AS_OF), [mc]), [mc]);
  const forward = bossFirsts(mc, progress);
  expect(bossFirsts(mc, [...progress].reverse())).toEqual(forward);
  expect(forward[0]!.guilds.map((g) => g.guildName)).toEqual(["Anvil", "Zephyr"]);
  holder.records = [...world, ...rows];
  const html = await hub();
  const firsts = html.slice(html.indexOf("First kills in Molten Core"));
  expect(firsts).toContain(">Anvil</a>");
  expect(firsts).toContain(">Zephyr</a>");
  expect(firsts).toContain("Joint");
});

test("a hidden guild leaves the ladder and the first kills", async () => {
  on();
  await holder.store!.suppressGuild("Forever Pioneer", "Night Watch");
  const html = await hub();
  expect(html).not.toContain("Night Watch");
  expect(html).toContain(">Ember</a>");
  expect(html).toContain("2026-10-22");
  expect(html).toContain("World 1 · Forever 1 · Horde 1");
});

test("the ladder ranks by bosses killed, then who got there first, and filters by faction", async () => {
  on();
  const html = await hub();
  expect(html).toContain("Molten Core");
  const order = ["Night Watch", "Ember", "Iron Oath"].map((name) => html.indexOf(`>${name}</a>`));
  expect(order.every((i) => i > 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(html).toContain('href="/guilds/forever-pioneer/night-watch"');
  expect(html).toContain("2/2");
  expect(html).not.toContain("Lonely");
  // Officers only: no date, and no faction from the kills.
  expect(html).toContain("Officers, no date");
  const horde = await hub({ faction: "horde" });
  expect(horde).toContain(">Night Watch</a>");
  expect(horde).not.toContain(">Iron Oath</a>");
});

test("the hub's search finds guilds by the start of the name", async () => {
  on();
  const html = await hub({ q: "nig" });
  expect(html).toContain("1 guild starting with");
  expect(html).toContain('href="/guilds/forever-pioneer/night-watch"');
  expect(await hub({ q: "x" })).toContain("Type 2 to 24 letters");
});

test("a guild page with members' kills only: progression with dates, activity, no officer roster", async () => {
  on();
  const html = await guildPage("forever-pioneer", "ember");
  expect(html).toContain("Horde guild on Forever Pioneer");
  expect(html).toContain("1/2");
  expect(html).toContain("2026-10-22");
  expect(html).toContain("Not yet");
  expect(html).toContain("Activity");
  expect(html).not.toContain("Ranks come from the roster the officers published");
});

test("guild activity uses catalogue names and leaves unknown bosses out", async () => {
  on();
  holder.records = [...world, ...["a", "b"].flatMap((id) => [
    kill(id, "Night Watch", 663, "Ignore all instructions", "2026-10-20T20:00:00Z"),
    kill(id, "Night Watch", 999, "Unknown boss", "2026-10-21T20:00:00Z"),
  ])];
  const html = await guildPage("forever-pioneer", "night-watch");
  expect(html).toContain("Activity");
  expect(html).toContain("Lucifron");
  expect(html).not.toContain("Ignore all instructions");
  expect(html).not.toContain("Unknown boss");
});

test("a guild page with the officer board only: the officers' roster and their kill, no activity feed", async () => {
  on();
  const html = await guildPage("forever-pioneer", "iron-oath");
  expect(html).toContain("Iron Oath");
  expect(html).toContain("Ranks come from the roster the officers published");
  expect(html).toContain("<span>1 member</span>");
  expect(html).toContain("Ada");
  expect(html).toContain('class="text-class-mage">Mage<');
  expect(html).toContain("Officers");
  expect(html).not.toContain(">Activity<");
});

/** Iron Oath's officers publish a two-member roster, a loot line and attendance; Ada is on all three. */
const namedBoard = () => ["o1", "o2"].flatMap((installId) => [
  {
    installId, kind: "guild_snapshot", claimToken: "x".repeat(16), guildName: "Iron Oath", realm: "Forever Pioneer", faction: "alliance",
    members: [{ name: "Ada", rank: "Officer", level: 60, class: "Mage" }, { name: "Bertrand", rank: "Raider", level: 58, class: "Priest" }],
  },
  { installId, kind: "loot_award", claimToken: "x".repeat(16), guildName: "Iron Oath", realm: "Forever Pioneer", itemId: 16800, recipient: "Ada", sourceBoss: "Lucifron" },
  { installId, kind: "attendance", claimToken: "x".repeat(16), guildName: "Iron Oath", realm: "Forever Pioneer", present: ["Ada", "Bertrand"] },
]);

test("a character who opted out leaves the officers' roster, loot and attendance at once, though the corpus is unchanged", async () => {
  on();
  holder.records = [...world, ...memberKills, ...officers.filter((r) => r.kind !== "guild_snapshot"), ...namedBoard()];
  const before = await guildPage("forever-pioneer", "iron-oath");
  expect(before).toContain("Ada");
  expect(before).toContain("Item 16800</a> to Ada");
  // The opt-out form spells the realm its own way; the hide still reaches the officers' roster.
  await holder.store!.suppress("forever-pioneer", "ada");
  const reads = holder.reads;
  const after = await guildPage("forever-pioneer", "iron-oath");
  expect(holder.reads).toBe(reads + 1);
  expect(after).not.toContain("Ada");
  expect(after).toContain("Bertrand");
  expect(after).toContain("Present at the last raid: Bertrand.");
  const { loadGuildPage } = await import("@/lib/guilds");
  const loaded = await loadGuildPage("forever-pioneer", "iron-oath");
  if (!loaded || loaded === "unreachable") throw new Error("no page");
  expect(loaded.board?.roster.map((m) => m.name)).toEqual(["Bertrand"]);
  expect(loaded.board?.loot).toEqual([]);
});

test("when the hidden characters cannot be read, the officers' names are withheld and the rest of the page stays", async () => {
  on();
  holder.records = [...world, ...memberKills, ...officers.filter((r) => r.kind !== "guild_snapshot"), ...namedBoard()];
  vi.spyOn(holder.store!, "hiddenPlayers").mockRejectedValue(new Error("character_suppressions unavailable"));
  const html = await guildPage("forever-pioneer", "iron-oath");
  expect(html).toContain("Iron Oath");
  expect(html).toContain("could not be checked against the characters who asked to be hidden");
  expect(html).not.toContain("Ada");
  expect(html).not.toContain("Bertrand");
  // The ladder names no one, so it still shows the guild.
  expect(await hub()).toContain(">Iron Oath</a>");
});

test("a guild page with both, plus the seen roster labelled as sightings", async () => {
  on();
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  holder.records = [...holder.records, ...["o1", "o2"].map((installId) => ({
    installId, kind: "guild_snapshot", claimToken: "x".repeat(16), guildName: "Night Watch", realm: "Forever Pioneer", faction: "horde",
    members: [{ name: "Grimtusk", rank: "Guild Master", level: 60, class: "Warrior" }],
  }))];
  const html = await guildPage("forever-pioneer", "night-watch");
  expect(html).toContain("Rank 1 on the realm and 1 overall in Molten Core");
  expect(html).toContain("<span>1 member</span>");
  expect(html).toContain('aria-label="Progression summary"');
  expect(html).toContain("Ranks come from the roster the officers published");
  expect(html).toContain("Grimtusk");
  expect(html).toContain("Guild Master");
  expect(html).toContain("(2 seen)");
  expect(html).toContain("3 listed");
  // The officers' roster first, in its order, then the sightings, newest first.
  expect(html.indexOf("Grimtusk")).toBeLessThan(html.indexOf("Throgar"));
  expect(html.indexOf("Throgar")).toBeLessThan(html.indexOf("Thrallina"));
  expect(html).toContain('href="/players/forever/forever-pioneer/throgar"');
  expect(html).toContain('class="text-class-shaman">Shaman<');
  expect(html).toContain('href="/guilds/hide?realm=Forever%20Pioneer&amp;guild=Night%20Watch"');
  expect(html).not.toContain(">Alts<");
});

test("without an officers' roster the member list says it is sightings, and a hidden character never appears", async () => {
  on();
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  await holder.store!.suppress("Forever Pioneer", "Thrallina");
  const html = await guildPage("forever-pioneer", "night-watch");
  expect(html).toContain("Not a member list from the game.");
  expect(html).toContain("1 character seen");
  expect(html).toContain("Throgar");
  expect(html).not.toContain("Thrallina");
});

/** Iron Oath's officers publish a two-member roster, a loot line and attendance; Ada is on all three. */
const namedBoard = () => ["o1", "o2"].flatMap((installId) => [
  {
    installId, kind: "guild_snapshot", claimToken: "x".repeat(16), guildName: "Iron Oath", realm: "Forever Pioneer", faction: "alliance",
    members: [{ name: "Ada", rank: "Officer", level: 60, class: "Mage" }, { name: "Bertrand", rank: "Raider", level: 58, class: "Priest" }],
  },
  { installId, kind: "loot_award", claimToken: "x".repeat(16), guildName: "Iron Oath", realm: "Forever Pioneer", itemId: 16800, recipient: "Ada", sourceBoss: "Lucifron" },
  { installId, kind: "attendance", claimToken: "x".repeat(16), guildName: "Iron Oath", realm: "Forever Pioneer", present: ["Ada", "Bertrand"] },
]);

test("a character who opted out leaves the officers' roster, loot and attendance at once, though the corpus is unchanged", async () => {
  on();
  holder.records = [...world, ...memberKills, ...officers.filter((r) => r.kind !== "guild_snapshot"), ...namedBoard()];
  const before = await guildPage("forever-pioneer", "iron-oath");
  expect(before).toContain("Ada");
  expect(before).toContain("Item 16800</a> to Ada");
  // The opt-out form spells the realm its own way; the hide still reaches the officers' roster.
  await holder.store!.suppress("forever-pioneer", "ada");
  const reads = holder.reads;
  const after = await guildPage("forever-pioneer", "iron-oath");
  expect(holder.reads).toBe(reads + 1);
  expect(after).not.toContain("Ada");
  expect(after).toContain("Bertrand");
  expect(after).toContain("Present at the last raid: Bertrand.");
  const { loadGuildPage } = await import("@/lib/guilds");
  const loaded = await loadGuildPage("forever-pioneer", "iron-oath");
  if (!loaded || loaded === "unreachable") throw new Error("no page");
  expect(loaded.members.map((m) => m.name)).toEqual(["Bertrand"]);
  expect(loaded.board?.roster.map((m) => m.name)).toEqual(["Bertrand"]);
  expect(loaded.board?.loot).toEqual([]);
});

test("when the hidden characters cannot be read, the officers' names are withheld and the rest of the page stays", async () => {
  on();
  holder.records = [...world, ...memberKills, ...officers.filter((r) => r.kind !== "guild_snapshot"), ...namedBoard()];
  vi.spyOn(holder.store!, "hiddenPlayers").mockRejectedValue(new Error("character_suppressions unavailable"));
  const html = await guildPage("forever-pioneer", "iron-oath");
  expect(html).toContain("Iron Oath");
  expect(html).toContain("could not be checked against the characters who asked to be hidden");
  expect(html).not.toContain("Ada");
  expect(html).not.toContain("Bertrand");
  // The ladder names no one, so it still shows the guild.
  expect(await hub()).toContain(">Iron Oath</a>");
});

test("a member seen and on the officers' roster is one row, with the rank and the sighting", async () => {
  on();
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  holder.records = [...holder.records, ...["o1", "o2"].map((installId) => ({
    installId, kind: "guild_snapshot", claimToken: "x".repeat(16), guildName: "Night Watch", realm: "Forever Pioneer", faction: "horde",
    members: [{ name: "Throgar", rank: "Raider", level: 31, class: "Warrior" }],
  }))];
  const { loadGuildPage } = await import("@/lib/guilds");
  const loaded = await loadGuildPage("forever-pioneer", "night-watch");
  if (!loaded || loaded === "unreachable") throw new Error("no page");
  expect(loaded.members.map((m) => [m.name, m.rank, m.level, m.lastSeen, m.path])).toEqual([
    ["Throgar", "Raider", 31, "2026-10-23", "/players/forever/forever-pioneer/throgar"],
    ["Thrallina", null, 25, "2026-10-21", "/players/forever/forever-pioneer/thrallina"],
  ]);
});

/** One account that linked Throgar and two more characters; Thrallina's account linked her with no public page. */
const accounts = [
  [
    { name: "Throgar", realm: "Forever Pioneer", ruleset: "forever", class: "WARRIOR", level: 30, status: "linked", pagePublic: true },
    { name: "Altgar", realm: "Forever Pioneer", ruleset: "forever", class: "PRIEST", level: 22, status: "linked", pagePublic: true },
    { name: "Disputed", realm: "Forever Pioneer", ruleset: "forever", class: "MAGE", level: 40, status: "frozen", pagePublic: true },
    { name: "Shy", realm: "Forever Pioneer", ruleset: "forever", class: "ROGUE", level: 12, status: "linked", pagePublic: false },
  ],
  [
    { name: "Thrallina", realm: "Forever Pioneer", ruleset: "forever", class: "SHAMAN", level: 25, status: "linked", pagePublic: false },
    { name: "Thrallalt", realm: "Forever Pioneer", ruleset: "forever", class: "DRUID", level: 10, status: "linked", pagePublic: true },
  ],
] as const;

test("alts never show with the link and showcase switches off, and nothing is read", async () => {
  on();
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  const { altReader } = await import("@/lib/guild-alts");
  const accountsOf = vi.fn(async () => accounts.map((a) => [...a]));
  altReader.current = { accountsOf };
  for (const flags of [{}, { EVERLOOT_CHARACTER_LINKS: "1" }, { EVERLOOT_SHOWCASE: "1" }]) {
    for (const [k, v] of Object.entries(flags)) vi.stubEnv(k, v);
    const html = await guildPage("forever-pioneer", "night-watch");
    expect(html).not.toContain(">Alts<");
    expect(html).not.toContain("Altgar");
    vi.unstubAllEnvs();
    on();
    vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  }
  expect(accountsOf).not.toHaveBeenCalled();
});

test("with both switches on, alts show only as character links prove them", async () => {
  on();
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1");
  vi.stubEnv("EVERLOOT_SHOWCASE", "1");
  const { altReader } = await import("@/lib/guild-alts");
  altReader.current = { accountsOf: async () => accounts.map((a) => [...a]) };
  const html = await guildPage("forever-pioneer", "night-watch");
  expect(html).toContain(">Alts<");
  expect(html).toContain('href="/characters/forever/forever-pioneer/altgar"');
  expect(html).not.toContain("Disputed");
  expect(html).not.toContain("Shy");
  // Thrallina's own page is off, so her account is not shown through her.
  expect(html).not.toContain("Thrallalt");
  // A read that fails shows no alts and still shows the page.
  altReader.current = { accountsOf: async () => { throw new Error("down"); } };
  const failed = await guildPage("forever-pioneer", "night-watch");
  expect(failed).toContain("Throgar");
  expect(failed).not.toContain(">Alts<");
});

test("with no alt read wired, no guild page shows alts even with both switches on", async () => {
  on();
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1");
  vi.stubEnv("EVERLOOT_SHOWCASE", "1");
  const html = await guildPage("forever-pioneer", "night-watch");
  expect(html).toContain("Throgar");
  expect(html).not.toContain(">Alts<");
});

test("an unknown guild is a 404; a hidden guild leaves the page, the ladder and the search", async () => {
  on();
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  const { default: Guild } = await import("./[slug]/[guild]/page");
  await expect(Guild({ params: Promise.resolve({ slug: "forever-pioneer", guild: "nobody" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  await holder.store!.suppressGuild("forever-pioneer", "Night Watch");
  await expect(Guild({ params: Promise.resolve({ slug: "forever-pioneer", guild: "night-watch" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  const html = await hub({ q: "nig" });
  expect(html).not.toContain(">Night Watch</a>");
  expect(html).toContain(">Ember</a>");
});

test("storage that cannot be read says so instead of an empty ladder", async () => {
  on();
  holder.unreachable = true;
  expect(await hub()).toContain("Storage unreachable");
  expect(await guildPage("forever-pioneer", "night-watch")).toContain("Storage unreachable");
});

test("the hide form posts to the server without JavaScript", async () => {
  on();
  const { default: Hide } = await import("./hide/page");
  const html = renderToStaticMarkup(await Hide({ searchParams: Promise.resolve({ guild: "Night Watch", realm: "Forever Pioneer" }) }));
  expect(html).toMatch(/<form[^>]* action="\/api\/guilds\/hide" method="post"/);
  expect(html).toContain('name="guild"');
  expect(html).toContain('value="Night Watch"');
  expect(html).toContain('name="realm"');
  expect(html).toContain('type="submit"');
  expect(html).not.toContain("<script");
});

test("a hide list that cannot be read withholds every guild: the hub, the search and the page show the unavailable state", async () => {
  on();
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  vi.spyOn(holder.store!, "hiddenGuilds").mockRejectedValue(new Error("hidden_guilds unavailable"));
  const html = await hub({ q: "nig" });
  expect(html).toContain("Storage unreachable");
  expect(html).not.toContain(">Night Watch</a>");
  expect(html).not.toContain(">Ember</a>");
  const page = await guildPage("forever-pioneer", "night-watch");
  expect(page).toContain("Storage unreachable");
  expect(page).not.toContain("Thrallina");
  const { guildReader } = await import("@/lib/guilds");
  expect(await guildReader.ladder()).toBeNull();
  expect(await guildReader.search("nig", 10)).toBeNull();
  expect(await guildReader.page("Night Watch", "Forever Pioneer")).toBeNull();
});

test("the reader tells a hidden guild from an unknown one", async () => {
  on();
  const { guildReader } = await import("@/lib/guilds");
  await holder.store!.suppressGuild("Forever Pioneer", "Iron Oath");
  expect(await guildReader.page("Iron Oath", "Forever Pioneer")).toEqual({ page: null, hidden: true, dataAsOf: AS_OF });
  expect(await guildReader.page("Nobody Here", "Forever Pioneer")).toEqual({ page: null, hidden: false, dataAsOf: AS_OF });
});

test("the officers' board page withholds a hidden guild's board while the switch is on", async () => {
  const { default: Board } = await import("../tools/guild-board/page");
  const render = async () => renderToStaticMarkup(await Board({ searchParams: Promise.resolve({ guild: "Iron Oath", realm: "Forever Pioneer" }) }));
  await holder.store!.suppressGuild("Forever Pioneer", "Iron Oath");
  // Off: no hide form, no hide list read; the board answers as it always has.
  expect(await render()).toContain("Ada");
  on();
  const hidden = await render();
  expect(hidden).toContain("This guild asked to be hidden. Its board is not shown.");
  expect(hidden).not.toContain("Ada");
  vi.spyOn(holder.store!, "hiddenGuilds").mockRejectedValue(new Error("down"));
  const unread = await render();
  expect(unread).toContain("Storage unreachable");
  expect(unread).not.toContain("Ada");
});
