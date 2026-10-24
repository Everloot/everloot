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
const kill = (installId: string, guildName: string, encounterId: number, name: string, capturedAt: string) => ({
  kind: "guild_kill", installId, eventId: `${installId}:${guildName}:${encounterId}`, capturedAt,
  guildName, realm: "Forever Pioneer", faction: "horde", encounterId, name, instanceMapId: 409, difficulty: 9, size: 40,
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
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

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
  const html = await hub();
  expect(html).toContain("The ladder starts with the first kill two members report.");
  expect(html).toContain("What will be here");
  expect(html).not.toContain("<table");
  expect(html).toContain('href="/tools/guild-board"');
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
  expect(html).not.toContain("Published by the officers");
});

test("a guild page with the officer board only: the officers' roster and their kill, no activity feed", async () => {
  on();
  const html = await guildPage("forever-pioneer", "iron-oath");
  expect(html).toContain("Iron Oath");
  expect(html).toContain("Published by the officers");
  expect(html).toContain("Ada");
  expect(html).toContain("Officers");
  expect(html).not.toContain(">Activity<");
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
  expect(html).toContain("Published by the officers");
  expect(html).toContain("Grimtusk");
  expect(html).toContain("Seen in this guild (2)");
  expect(html).toContain("Not a member list from the game.");
  expect(html.indexOf("Throgar")).toBeLessThan(html.indexOf("Thrallina"));
  expect(html).toContain('href="/players/forever/forever-pioneer/throgar"');
  expect(html).toContain('href="/guilds/hide?realm=Forever%20Pioneer&amp;guild=Night%20Watch"');
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
