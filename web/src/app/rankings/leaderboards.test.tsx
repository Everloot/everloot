import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { armoryCharacter, armoryGuild } from "@/lib/armory.fixture";
import { createMemoryArmoryStore, createUnavailableArmoryStore, type ArmoryStore } from "@/lib/armory-store";
import { BLIZZARD_CREDIT } from "@/lib/armory";
import { guildPath } from "@/lib/guilds";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import adFree from "@/data/ad-free-paths.json";

// The hub reads the census for its week-by-week rankings; here it has no weeks, so only the leaderboards are under test.
const publicProgression = vi.hoisted(() => vi.fn());
vi.mock("@/lib/progression", () => ({ loadGuildProgressionRanking: publicProgression }));
const census = vi.hoisted(() => ({ loadCensus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCensus: census.loadCensus },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string; "aria-current"?: "page" }) => (
    <a href={href} className={className} aria-current={rest["aria-current"]}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn, revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as ArmoryStore | null, hidden: null as Set<string> | null }));
vi.mock("@/lib/armory-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/armory-store")>()), armoryStore: () => holder.store }));
vi.mock("@/lib/player-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/player-store")>()),
  playerStore: () => ({ hiddenGuilds: async () => { if (holder.hidden === null) throw new Error("down"); return holder.hidden; } }),
}));
// The progression ladder comes from members' uploads; a test sets its rows and whether raids have opened.
const ladder = vi.hoisted(() => ({ rows: [] as unknown[], open: false, unreachable: false, kind: "raid" as "raid" | "dungeon" }));
vi.mock("@/lib/guilds", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/guilds")>()),
  loadGuildData: async () => ({ unreachable: ladder.unreachable }),
  loadLadder: async () => ({ rows: ladder.rows, instance: ladder.rows.length ? { instanceMapId: 409, name: ladder.kind === "raid" ? "Molten Core" : "Deadmines", instanceType: ladder.kind, tier: 1, bosses: [] } : null, instances: [], rulesets: [], realms: [], firsts: [], total: ladder.rows.length, page: 1, pages: 1, query: {} }),
  raidsOpen: () => ladder.open,
}));

import RankingsHub, { generateMetadata } from "./page";

const hub = async (search: Record<string, string> = {}) => renderToStaticMarkup(await RankingsHub({ searchParams: Promise.resolve(search) }));
/** One hub section's markup: the boards are sections too, so it runs to the next top-level section. */
const section = (html: string, id: string) => {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  if (start < 0) return "";
  const ends = ['aria-labelledby="guilds"', 'id="who-plays"'].map((m) => html.indexOf(m, start + 1)).filter((j) => j > start);
  return html.slice(start, Math.min(...ends, html.length));
};
const kill = (guildName: string, realm: string, killed: number) => ({
  key: `${realm}/${guildName}`, guildName, realm, faction: "horde", instanceMapId: 409, instanceName: "Molten Core", tier: 1, killed, bosses: 10,
  latestKillAt: "2026-12-10T20:00:00.000Z", list: [], ruleset: "pve", ranks: { world: 1, ruleset: 1, faction: 1 },
});

beforeEach(() => {
  publicProgression.mockReset().mockResolvedValue([]);
  census.loadCensus.mockReset().mockResolvedValue({ rows: [], dataAsOf: "2026-11-18T10:00:00.000Z" });
  const mem = createMemoryArmoryStore(() => new Date("2026-11-18T00:00:00Z"));
  mem.putCharacter(armoryCharacter());
  mem.putCharacter(armoryCharacter({ slug: "torvin-ashbrook", name: "Torvin", surname: "Ashbrook", class: "Warrior", classId: 1, itemLevel: 60, gearScore: null, honorableKills: 5, fetchedAt: "2026-11-09T11:30:00.000Z" }));
  mem.putGuild(armoryGuild(), [{ characterSlug: armoryCharacter().slug, name: armoryCharacter().name, surname: armoryCharacter().surname, level: 60, classId: 3, raceId: 8, rank: 1 }]);
  holder.store = mem;
  holder.hidden = new Set();
  ladder.rows = [];
  ladder.open = false;
  ladder.unreachable = false;
  ladder.kind = "raid";
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

test("with the armory on, the hub leads with the character boards and the guild gear board, each row linking its page and each board its full list", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  const html = await hub();
  const me = armoryCharacter();
  const characters = section(html, "characters");
  for (const title of ["Item level", "Gear Score", "Honorable kills", "Fish caught"]) expect(characters, title).toContain(title);
  expect(characters).toContain(`href="/armory/${me.region}/${me.slug}"`);
  expect(characters).toContain('href="/armory/rankings/item-level?region=eu"');
  expect(characters).toContain('href="/armory/rankings/item-level?region=us"');
  // One board at a time: the hub reads the shown board, one region each, never all nine.
  const spy = vi.spyOn(holder.store!, "boardFiltered");
  await hub({ metric: "honorable-kills" });
  // (The memory store answers best-of-class through boardFiltered too, one row a class; those are left out.)
  expect(spy.mock.calls.filter((c) => c[5] === 10).map((c) => [c[0], c[1]])).toEqual([["honorable_kills", "us"], ["honorable_kills", "eu"]]);
  expect(html).toContain('href="/armory/rankings/fish-caught"');
  const guilds = section(html, "guilds");
  const guild = armoryGuild();
  expect(guilds).toContain(`href="/armory/${guild.region}/guilds/${guild.slug}"`);
  expect(guilds).toContain('href="/guilds?sort=item-level"');
  expect(html).toContain(BLIZZARD_CREDIT);
  // The census rankings stay below, under their own heading.
  expect(html.indexOf('aria-labelledby="characters"')).toBeLessThan(html.indexOf("Who plays"));
});

test("a region tab narrows the boards and rides on their full-list links", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  const html = await hub({ region: "us" });
  const tabs = html.match(/<nav aria-label="Region"[\s\S]*?<\/nav>/)?.[0] ?? "";
  expect(tabs).toContain('href="/rankings"');
  expect(tabs).toContain('href="/rankings?region=eu"');
  expect(tabs).toMatch(/href="\/rankings\?region=us"[^>]*aria-current="page"/);
  const characters = section(html, "characters");
  expect(characters).not.toContain(`href="/armory/eu/${armoryCharacter().slug}"`);
  expect(characters).toContain("No character with this number here yet.");
  expect(characters).toContain('href="/armory/rankings/item-level?region=us"');
  expect(section(html, "guilds")).toContain('href="/guilds?region=us&amp;sort=item-level"');
  // An unknown region reads as every region; any casing is read.
  expect(section(await hub({ region: "kr" }), "characters")).toContain(`href="/armory/eu/${armoryCharacter().slug}"`);
  expect(section(await hub({ region: "EU" }), "characters")).toContain(`href="/armory/eu/${armoryCharacter().slug}"`);
});

test("the character board shows US and EU side by side for one metric at a time, the metric and region in the URL", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  (holder.store as ReturnType<typeof createMemoryArmoryStore>).putCharacter(armoryCharacter({ region: "us", slug: "maren-holt", name: "Maren", surname: "Holt", class: "Mage", classId: 8, itemLevel: 40, gearScore: 45, honorableKills: 9 }));
  const html = await hub();
  const characters = section(html, "characters");
  const us = characters.slice(characters.indexOf('aria-labelledby="board-us"'), characters.indexOf('aria-labelledby="board-eu"'));
  expect(us).toContain('href="/armory/us/maren-holt"');
  expect(us).toContain('href="/armory/rankings/item-level?region=us"');
  expect(characters.slice(characters.indexOf('aria-labelledby="board-eu"'))).toContain(`href="/armory/eu/${armoryCharacter().slug}"`);
  // Every board is a tab; the current one is marked, and a tab keeps the region.
  const tabs = html.match(/<nav aria-label="Character rankings"[\s\S]*?<\/nav>/)?.[0] ?? "";
  expect(tabs).toMatch(/href="\/rankings"[^>]*aria-current="page"[^>]*>Item level/);
  expect(tabs).toContain('href="/rankings?metric=fish-caught"');
  const gear = section(await hub({ metric: "gear-score", region: "us" }), "characters");
  expect(gear).toContain('href="/armory/rankings/gear-score?region=us"');
  expect(gear).not.toContain('aria-labelledby="board-eu"');
  expect((await hub({ metric: "gear-score", region: "us" })).match(/<nav aria-label="Character rankings"[\s\S]*?<\/nav>/)?.[0]).toContain('href="/rankings?metric=deaths&amp;region=us"');
  // An unknown metric reads as the first board rather than a missing page.
  expect(section(await hub({ metric: "dps" }), "characters")).toContain('href="/armory/rankings/item-level?region=eu"');
});

test("raid progress lists the ladder's top guilds, and says where it will start before any kill", async () => {
  vi.stubEnv("EVERLOOT_GUILDS", "1");
  expect(section(await hub(), "guilds")).toContain("Progression ladders start December 9.");
  ladder.open = true;
  expect(section(await hub(), "guilds")).toContain("The ladder starts with the first kill two members report.");
  ladder.rows = [kill("Danish Vanguard", "Nightslayer", 3), kill("Moon Guard", "Nightslayer", 1)];
  const guilds = section(await hub(), "guilds");
  expect(guilds).toContain(`href="${guildPath("Nightslayer", "Danish Vanguard")}"`);
  expect(guilds).toContain("Molten Core");
  expect(guilds).toMatch(/3<!-- -->\/<!-- -->10|3\/10/);
  expect(guilds).toContain('href="/guilds"');
  // Before any raid kill the ladder's newest instance is a dungeon: that is not raid progress.
  ladder.kind = "dungeon";
  const dungeon = section(await hub(), "guilds");
  expect(dungeon).not.toContain("Deadmines");
  expect(dungeon).toContain("The ladder starts with the first kill two members report.");
  ladder.kind = "raid";
  // Without the armory there is no character section and no Blizzard credit.
  expect(section(await hub(), "characters")).toBe("");
  expect(await hub()).not.toContain(BLIZZARD_CREDIT);
});

test("unreachable armory storage says so in the boards while the rest of the hub still renders", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  holder.store = createUnavailableArmoryStore("down");
  const html = await hub();
  expect(section(html, "characters")).toContain(STORAGE_UNREACHABLE);
  expect(section(html, "guilds")).toContain(STORAGE_UNREACHABLE);
  expect(html).toContain("Who plays");
});

test("the hub is kept out of search engines while it shows Blizzard's boards, as every armory page is, and the ladder follows the guild pages' switch", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  expect((await generateMetadata()).robots).toMatchObject({ index: false });
  vi.unstubAllEnvs();
  vi.stubEnv("EVERLOOT_GUILDS", "1");
  expect((await generateMetadata()).robots).toMatchObject({ index: false });
  // The ad script never loads where Blizzard's rows are shown: the hub is an ad-free path like the armory.
  expect(adFree).toContain("/rankings");
});

test("on a phone the first column carries the rank with the name, so a folded row still names who it ranks", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  const characters = section(await hub({ metric: "gear-score" }), "characters");
  const me = armoryCharacter();
  expect(characters).toMatch(new RegExp(`<td[^>]*><span[^>]*><span[^>]*>1</span><a href="/armory/${me.region}/${me.slug}"`));
  expect(characters).not.toContain(">#<");
});

test("the hub has labelled directory searches, class winners, guild links and add tools", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  const out = await hub();
  expect(out).toContain('action="/players"');
  expect(out).toContain('action="/guilds"');
  expect(out.match(/name="q"/g)).toHaveLength(2);
  expect(out).toContain('Character name');
  expect(out).toContain('Guild name');
  const winners = section(out, "best-of-class");
  expect(winners).toContain("Best of each class");
  expect(winners).toContain('href="/armory/eu/velkara-duskmantle"');
  expect(winners).toContain('href="/armory/eu/guilds/ember-wardens"');
  expect(winners).toContain('text-class-hunter');
  expect(winners).toContain('aria-label="Gear Score:');
  expect(section(out, "characters")).toContain('href="/armory/eu/guilds/ember-wardens"');
  expect(out).toContain('href="/armory/submit"');
  expect(out).toContain('href="/armory/guilds/submit"');
});

test("hub shows public progression while the armory is on even when legacy guild boards are off", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  vi.stubEnv("EVERLOOT_GUILDS", "");
  publicProgression.mockResolvedValue([{ region: "eu", slug: "invented-watch", name: "Invented Watch", score: 60 }]);
  const result = await hub({ region: "eu" });
  expect(publicProgression).toHaveBeenCalledWith("eu");
  expect(result).toContain('aria-labelledby="board-guild-progression"');
  expect(result).toContain("Invented Watch");
  expect(result).toContain("Public guild progression");
  publicProgression.mockResolvedValue([]);
  expect(await hub()).not.toContain('aria-labelledby="board-guild-progression"');
});
