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
/** One board's card on the hub. */
const boardCard = (html: string, metric: string) => {
  const start = html.indexOf(`aria-labelledby="board-card-${metric}"`);
  if (start < 0) return "";
  const end = html.indexOf('aria-labelledby="board-card-', start + 1);
  return html.slice(start, end < 0 ? html.length : end);
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

test("with the armory on, the hub leads with every board as a card: its top 3, each name in its class colour linking its page, and View all", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  // The gear board needs five members read; the fixture guild has one, so four more join it.
  for (const n of ["ash", "bry", "cole", "dena"]) (holder.store as ReturnType<typeof createMemoryArmoryStore>).putCharacter(armoryCharacter({ slug: `${n}-wardens`, name: n, surname: "Wardens", itemLevel: 20, gearScore: null, honorableKills: null }));
  const spy = vi.spyOn(holder.store!, "boardFiltered");
  const html = await hub();
  const me = armoryCharacter();
  const characters = section(html, "characters");
  for (const title of ["Item level", "Gear Score", "Honorable kills", "Quests completed", "Fish caught", "Deaths"]) expect(characters, title).toContain(title);
  const card = boardCard(characters, "item-level");
  expect(card).toMatch(new RegExp(`<a href="/armory/${me.region}/${me.slug}" class="[^"]*text-class-hunter`));
  expect(card).toContain('data-region="eu"');
  expect(card).toMatch(/href="\/armory\/rankings\/item-level"[^>]*>View all/);
  // Three rows at most, each board read once for both regions together: one read of three rows per board.
  expect(card.match(/<li/g)?.length).toBeLessThanOrEqual(3);
  expect(spy.mock.calls.filter((c) => c[5] === 3).map((c) => [c[0], c[1]])).toEqual([
    ["item_level", null], ["gear_score", null], ["honorable_kills", null], ["quests_completed", null], ["creatures_killed", null],
    ["fish_caught", null], ["flight_paths", null], ["dungeons_entered", null], ["total_deaths", null],
  ]);
  // A board with nobody on it yet says so in its card.
  expect(boardCard(characters, "fish-caught")).toContain("No character with this number here yet.");
  const guilds = section(html, "guilds");
  const guild = armoryGuild();
  expect(guilds).toContain(`href="/armory/${guild.region}/guilds/${guild.slug}"`);
  expect(guilds).toContain('href="/guilds?sort=item-level"');
  expect(html).toContain(BLIZZARD_CREDIT);
  // The census rankings stay below, under their own heading.
  expect(html.indexOf('aria-labelledby="characters"')).toBeLessThan(html.indexOf("Who plays"));
});

test("the guild gear board keeps guilds with five members read or more, and says so", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  const mem = holder.store as ReturnType<typeof createMemoryArmoryStore>;
  // Ember Wardens (the fixture) has one member read; Reed Few has five.
  const reed = ["tova", "ulma", "vann", "wren", "yoss"].map((n) => armoryCharacter({ slug: `${n}-reed`, name: n, surname: "Reed", itemLevel: 50, guildSlug: "reed-few", guildName: "Reed Few" }));
  for (const c of reed) mem.putCharacter(c);
  mem.putGuild(armoryGuild({ slug: "reed-few", name: "Reed Few" }), []);
  const guilds = section(await hub(), "guilds");
  expect(guilds).toContain('href="/armory/eu/guilds/reed-few"');
  expect(guilds).not.toContain(`href="/armory/eu/guilds/${armoryGuild().slug}"`);
  expect(guilds).toContain("guilds with at least 5 members read");
});

test("before the database takes a minimum, the guild gear board lists what the directory gives and does not claim one", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  const mem = holder.store as ReturnType<typeof createMemoryArmoryStore>;
  holder.store = { ...mem, guildDirectory: async (f) => { const page = await mem.guildDirectory({ ...f, minRead: undefined }); return page && { rows: page.rows, total: page.total }; } };
  const guilds = section(await hub(), "guilds");
  expect(guilds).toContain(`href="/armory/eu/guilds/${armoryGuild().slug}"`);
  expect(guilds).not.toContain("at least 5 members read");
});

test("tied characters on a card share their rank and say so; the top three wear a rank badge", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  const mem = holder.store as ReturnType<typeof createMemoryArmoryStore>;
  mem.putCharacter(armoryCharacter({ slug: "torvin-ashbrook", name: "Torvin", surname: "Ashbrook", class: "Warrior", classId: 1, itemLevel: armoryCharacter().itemLevel, gearScore: null, honorableKills: 5 }));
  const card = boardCard(section(await hub(), "characters"), "item-level");
  expect([...card.matchAll(/data-rank="(\d+)"/g)].map((m) => m[1])).toEqual(["1", "1"]);
  expect(card.match(/sr-only">#1 \(tied\)/g)).toHaveLength(2);
  expect(card).toContain("data-rank-top");
});

test("a region tab narrows the cards and rides on their View all links", async () => {
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

test("a card ranks US and EU together, each row wearing its region chip; an old ?metric= address still opens the hub", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  (holder.store as ReturnType<typeof createMemoryArmoryStore>).putCharacter(armoryCharacter({ region: "us", slug: "maren-holt", name: "Maren", surname: "Holt", class: "Mage", classId: 8, itemLevel: 40, gearScore: 45, honorableKills: 9 }));
  const card = boardCard(section(await hub({ metric: "gear-score" }), "characters"), "item-level");
  expect(card).toContain('href="/armory/us/maren-holt"');
  expect(card).toContain(`href="/armory/eu/${armoryCharacter().slug}"`);
  expect(card).toContain('data-region="us"');
  expect(card).toContain('data-region="eu"');
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

test("a card row keeps the rank beside the name, so a narrow card still names who it ranks", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  const card = boardCard(section(await hub(), "characters"), "gear-score");
  const me = armoryCharacter();
  expect(card).toMatch(new RegExp(`<li[^>]*><span data-rank="1"[\\s\\S]*?<a href="/armory/${me.region}/${me.slug}"[^<]*</a></span><span data-region`));
  expect(card).not.toContain(">#<");
});

test("the guild gear board names each guild's faction and region beside its rank", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  const mem = holder.store as ReturnType<typeof createMemoryArmoryStore>;
  for (const n of ["tova", "ulma", "vann", "wren", "yoss"]) mem.putCharacter(armoryCharacter({ slug: `${n}-reed`, name: n, surname: "Reed", itemLevel: 50, guildSlug: "reed-few", guildName: "Reed Few" }));
  mem.putGuild(armoryGuild({ slug: "reed-few", name: "Reed Few", faction: "Horde" }), []);
  const gear = section(await hub(), "guilds");
  expect(gear).toMatch(/data-rank="1"[\s\S]*?href="\/armory\/eu\/guilds\/reed-few"/);
  expect(gear).toMatch(/role="img" aria-label="Horde"/);
  expect(gear).toContain('data-region="eu"');
  expect(gear).toContain(">Members read<");
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
