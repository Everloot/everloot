import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMemoryPlayerStore, type PlayerStore } from "@/lib/player-store";

vi.mock("@/lib/supabase/server", () => ({ getUser: vi.fn(), authQuery: vi.fn(), siteUrl: () => "https://everloot.app" }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("next/cache", () => ({ unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn, revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

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

import { GUILD_LINE, GUILDMATES_SHOWN, PLAN_LINE, raceFaction } from "./[ruleset]/[realm]/[name]/character-guild";

const base = (installId: string, i: number) => ({ installId, eventId: `${installId}:${i}`, capturedAt: "2026-10-20T20:00:00Z" });
/** Molten Core and its two bosses, as three installs agree on them. */
const world = ["w1", "w2", "w3"].flatMap((id) => [
  { ...base(id, 1), kind: "instance_entrance", instanceMapId: 409, name: "Molten Core", instanceType: "raid", mapId: 1415, x: 30, y: 80 },
  { ...base(id, 2), kind: "encounter", encounterId: 663, name: "Lucifron", instanceMapId: 409, success: true, npcIds: [12118] },
  { ...base(id, 3), kind: "encounter", encounterId: 664, name: "Magmadar", instanceMapId: 409, success: true, npcIds: [11982] },
]);
const kill = (installId: string, guildName: string, encounterId: number, name: string, capturedAt: string) => ({
  kind: "guild_kill", installId, eventId: `${installId}:${guildName}:${encounterId}`, capturedAt,
  guildName, realm: "Forever Pioneer", faction: "horde", encounterId, name, instanceMapId: 409, difficulty: 9, size: 40,
});
/** Night Watch killed Lucifron, as two members' installs agree; Magmadar has one report only. */
const memberKills = [
  kill("a", "Night Watch", 663, "Lucifron", "2026-10-20T20:00:00Z"), kill("b", "Night Watch", 663, "Lucifron", "2026-10-20T20:05:00Z"),
  kill("a", "Night Watch", 664, "Magmadar", "2026-10-21T20:00:00Z"),
];
/** Iron Oath's officers publish a board, agreed by two uploads: Ada on the roster, loot to Ada, Ada present. */
const officers = ["o1", "o2"].flatMap((installId, i) => [
  { installId, eventId: `${installId}:s`, kind: "guild_snapshot", claimToken: "x".repeat(16), guildName: "Iron Oath", realm: "Forever Pioneer", faction: "alliance", members: [{ name: "Ada", rank: "Officer", level: 60, class: "Mage" }, { name: "Bram", rank: "Member", level: 58, class: "Warrior" }] },
  { installId, eventId: `${installId}:l${i}`, kind: "loot_award", guildName: "Iron Oath", realm: "Forever Pioneer", itemId: 16800, recipient: "Ada", sourceBoss: "Lucifron" },
  { installId, eventId: `${installId}:a${i}`, kind: "attendance", guildName: "Iron Oath", realm: "Forever Pioneer", present: ["Ada", "Bram"] },
]);

const PARAMS = { ruleset: "forever", realm: "forever-pioneer", name: "thrallina" };
const render = async (p = PARAMS) => {
  const { default: Page } = await import("./[ruleset]/[realm]/[name]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve(p) })).replace(/&#x27;/g, "'");
};
/** Everything from a part's start to the next part's start: enough to say what sits inside it. */
const between = (html: string, name: string) => {
  const start = html.indexOf(`data-part="${name}"`);
  if (start < 0) return "";
  const next = html.slice(start + 10).search(/data-part="/);
  return next < 0 ? html.slice(start) : html.slice(start, start + 10 + next);
};

beforeEach(async () => {
  holder.store = createMemoryPlayerStore(() => new Date("2026-10-24T10:00:00Z"));
  holder.records = [...world, ...memberKills, ...officers];
  holder.unreachable = false;
  holder.reads = 0;
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  vi.stubEnv("EVERLOOT_SHOWCASE", "");
  vi.stubEnv("SUPABASE_URL", "");
  await holder.store.upsert([
    { name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 25, guild: "Night Watch", seen: "2026-10-21" },
    { name: "Throgar", realm: "Forever Pioneer", race: "Orc", class: "WARRIOR", level: 30, guild: "Night Watch", seen: "2026-10-23" },
    { name: "Ada", realm: "Forever Pioneer", race: "Human", class: "MAGE", level: 60, guild: "Iron Oath", seen: "2026-10-22" },
    { name: "Wingra", realm: "Forever Pioneer", race: "Skyborne", class: "DRUID", level: 12, seen: "2026-10-22" },
  ]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

test("the faction is derived from the race, and a race on both sides names none", () => {
  expect(raceFaction("Orc")).toBe("Horde");
  expect(raceFaction("Scourge")).toBe("Horde");
  expect(raceFaction("NightElf")).toBe("Alliance");
  expect(raceFaction("Skyborne")).toBeNull();
  expect(raceFaction("Murloc")).toBeNull();
});

describe("the guild part", () => {
  test("with the guild pages off there is no guild part and the uploads are never read", async () => {
    const html = await render();
    expect(html).toContain('data-part="sighting"');
    expect(html).not.toContain('data-part="guild"');
    expect(holder.reads).toBe(0);
  });

  test("on, it shows the guild as its page does: link, size, the guild's agreed kills and who else was seen in it", async () => {
    vi.stubEnv("EVERLOOT_GUILDS", "1");
    const html = await render();
    const guild = between(html, "guild");
    expect(guild).toContain('href="/guilds/forever-pioneer/night-watch"');
    expect(guild).toContain("2 characters seen");
    expect(guild).toContain(GUILD_LINE);
    // Lucifron is agreed by two installs; Magmadar has one report, so it is not a kill.
    expect(guild).toContain("Molten Core");
    expect(guild).toMatch(/1\/2/);
    // The other character seen in the guild links to its own page; this character is not listed as its own guildmate.
    expect(guild).toContain("Also seen in Night Watch");
    expect(guild).toContain('href="/characters/forever/forever-pioneer/throgar"');
    expect(guild).not.toContain('href="/characters/forever/forever-pioneer/thrallina"');
    // No officers published for Night Watch, and the officers' facts are behind their own switch anyway.
    expect(guild).not.toContain('data-guild="officers"');
    expect(guild).not.toContain("Rank");
  });

  test("the guild part comes after the sighting it is read from, and the rail dates each source", async () => {
    vi.stubEnv("EVERLOOT_GUILDS", "1");
    const html = await render();
    expect(html.indexOf('data-part="guild"')).toBeGreaterThan(html.indexOf('data-part="sighting"'));
    const rail = html.slice(html.indexOf('data-rail="sources"'));
    expect(rail).toContain("Last seen by the addon");
    expect(rail).toContain("2026-10-21");
    expect(rail).toContain("Data as of 2026-10-24");
    expect(rail).toContain('href="#character-guild"');
  });

  test("a hidden guild, or no guild seen, leaves the part out", async () => {
    vi.stubEnv("EVERLOOT_GUILDS", "1");
    await holder.store!.suppressGuild("Forever Pioneer", "Night Watch");
    const hidden = await render();
    expect(hidden).toContain('data-part="sighting"');
    expect(hidden).not.toContain('data-part="guild"');
    const lone = await render({ ...PARAMS, name: "wingra" });
    expect(lone).toContain('data-part="sighting"');
    expect(lone).not.toContain('data-part="guild"');
  });

  test("guild data failing says so in place of the part and keeps the rest of the page", async () => {
    vi.stubEnv("EVERLOOT_GUILDS", "1");
    holder.unreachable = true;
    const html = await render();
    expect(html).toContain('data-part="sighting"');
    expect(html).toContain("The guild's data is unreachable right now");
    expect(html).not.toContain('data-part="guild"');
  });

  test("at most GUILDMATES_SHOWN guildmates, newest first, with a link to the rest", async () => {
    vi.stubEnv("EVERLOOT_GUILDS", "1");
    const names = ["Aaa", "Bbb", "Ccc", "Ddd", "Eee", "Fff", "Ggg", "Hhh", "Iii", "Jjj"];
    await holder.store!.upsert(names.map((name, i) => ({ name, realm: "Forever Pioneer", race: "Orc", class: "ROGUE", level: 10 + i, guild: "Night Watch", seen: `2026-10-${String(10 + i).padStart(2, "0")}` })));
    const guild = between(await render(), "guild");
    const listed = [...guild.matchAll(/href="\/characters\/forever\/forever-pioneer\/([a-z]+)"/g)].map((m) => m[1]);
    expect(listed).toHaveLength(GUILDMATES_SHOWN);
    // Throgar (10-23) is the newest; Jjj (10-19) next.
    expect(listed[0]).toBe("throgar");
    expect(listed[1]).toBe("jjj");
    expect(guild).toContain(`All ${names.length + 1} on the guild's page`);
  });
});

describe("the officers' facts about this character", () => {
  test("off by default: no rank, loot or attendance, even with a board naming the character", async () => {
    vi.stubEnv("EVERLOOT_GUILDS", "1");
    const guild = between(await render({ ...PARAMS, name: "ada" }), "guild");
    expect(guild).toContain("Iron Oath");
    expect(guild).toContain("2 members");
    expect(guild).not.toContain("Officer");
    expect(guild).not.toContain("16800");
    expect(guild).not.toContain("last raid");
  });

  test("with EVERLOOT_CHARACTER_GUILD_FACTS=1: the rank, the loot the officers gave it and its attendance", async () => {
    vi.stubEnv("EVERLOOT_GUILDS", "1");
    vi.stubEnv("EVERLOOT_CHARACTER_GUILD_FACTS", "1");
    const guild = between(await render({ ...PARAMS, name: "ada" }), "guild");
    expect(guild).toContain("Officer");
    expect(guild).toContain('href="/database/items/16800"');
    expect(guild).toContain("from Lucifron");
    expect(guild).toContain("Present at the guild's last raid.");
  });

  test("with the hidden characters unreadable, the officers' facts are withheld", async () => {
    vi.stubEnv("EVERLOOT_GUILDS", "1");
    vi.stubEnv("EVERLOOT_CHARACTER_GUILD_FACTS", "1");
    vi.spyOn(holder.store!, "hiddenPlayers").mockRejectedValue(new Error("down"));
    const guild = between(await render({ ...PARAMS, name: "ada" }), "guild");
    expect(guild).not.toContain("Officer");
    expect(guild).not.toContain("16800");
  });
});

describe("the sighting's faction and the class plan", () => {
  test("the sighting shows the faction its race plays on, and none for Skyborne", async () => {
    const orc = between(await render(), "sighting");
    expect(orc).toMatch(/Faction<\/dt><dd[^>]*>Horde</);
    const skyborne = between(await render({ ...PARAMS, name: "wingra" }), "sighting");
    expect(skyborne).not.toContain("Faction");
  });

  test("the plan links carry the class and level, say they are not read from the character, and come last", async () => {
    const html = await render();
    const plan = between(html, "plan");
    expect(plan).toContain("Plan a level 25 Shaman");
    expect(plan).toContain('href="/classes/shaman?level=25"');
    expect(plan).toContain('href="/tools/talents/shaman"');
    expect(plan).toContain('href="/database/items?class=shaman&amp;level=25"');
    expect(plan).toContain(PLAN_LINE);
    expect(html.indexOf('data-part="plan"')).toBeGreaterThan(html.indexOf('data-part="sighting"'));
    expect(html.indexOf('data-part="plan"')).toBeLessThan(html.indexOf("Hide this character"));
  });
});
