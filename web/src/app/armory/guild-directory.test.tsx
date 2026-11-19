import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/components/guild-profile", () => ({ default: () => <section aria-label="Guild profile">Claim or edit this guild</section> }));
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BLIZZARD_CREDIT } from "@/lib/armory";
import { armoryCharacter, armoryGuild } from "@/lib/armory.fixture";
import { createCloudArmoryStore, createMemoryArmoryStore, type ArmoryStore, type MemoryArmoryStore } from "@/lib/armory-store";
import { playerStore } from "@/lib/player-store";
import { StorageError } from "@/lib/supabase/server";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`NEXT_REDIRECT 308 ${to}`); },
  usePathname: () => "/guilds", useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams(),
}));

const holder = vi.hoisted(() => ({ store: null as ArmoryStore | null }));
vi.mock("@/lib/armory-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/armory-store")>()), armoryStore: () => holder.store }));

const held = globalThis as typeof globalThis & { __everlootPlayers?: unknown };
let mem: MemoryArmoryStore;
beforeEach(() => {
  held.__everlootPlayers = undefined;
  mem = createMemoryArmoryStore(() => new Date("2026-11-10T00:00:00Z"));
  mem.putCharacter(armoryCharacter());
  mem.putCharacter(armoryCharacter({ slug: "torvin-ashbrook", name: "Torvin", surname: "Ashbrook", class: "Warrior", classId: 1, level: 44, itemLevel: 50, fetchedAt: "2026-11-09T11:30:00.000Z" }));
  mem.putGuild(armoryGuild(), [
    { characterSlug: "velkara-duskmantle", name: "Velkara", surname: "Duskmantle", level: 60, classId: 3, raceId: 8, rank: 1 },
    { characterSlug: "torvin-ashbrook", name: "Torvin", surname: "Ashbrook", level: 44, classId: 1, raceId: 2, rank: 2 },
    { characterSlug: "brannoc-tide", name: "Brannoc", surname: "Tide", level: 41, classId: 3, raceId: 10, rank: 0 },
  ]);
  mem.putGuild(armoryGuild({ region: "us", slug: "ash-pact", name: "Ash Pact", faction: "Alliance", rulesetId: 1, ruleset: "PvP", memberCount: 9 }), []);
  holder.store = mem;
  vi.stubEnv("EVERLOOT_ARMORY", "1");
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); held.__everlootPlayers = undefined; });

const pages = {
  directory: async (search: Record<string, string> = {}) => (await import("../guilds/page")).default({ searchParams: Promise.resolve(search) }),
  moved: async (search: Record<string, string | string[]> = {}) => (await import("./guilds/page")).default({ searchParams: Promise.resolve(search) }),
  guild: async (region: string, slug: string, search: Record<string, string> = {}) => (await import("./[region]/guilds/[slug]/page")).default({ params: Promise.resolve({ region, slug }), searchParams: Promise.resolve(search) }),
  board: async (metric: string) => (await import("./rankings/[metric]/page")).default({ params: Promise.resolve({ metric }), searchParams: Promise.resolve({}) }),
};
const html = async (page: Promise<React.ReactElement>) => renderToStaticMarkup(await page);

describe("the guild directory", () => {
  test("is a 404 on /guilds with the armory and guild switches off", async () => {
    vi.stubEnv("EVERLOOT_ARMORY", "");
    await expect(pages.directory()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  test("its old address redirects to /guilds for good, the filters carried over under their new names", async () => {
    await expect(pages.moved()).rejects.toThrow("NEXT_REDIRECT 308 /guilds");
    await expect(pages.moved({ q: "ash", region: "us", ruleset: "roleplay-pvp", sort: "level-60", page: "2" }))
      .rejects.toThrow("NEXT_REDIRECT 308 /guilds?q=ash&region=us&rules=roleplay-pvp&sort=level-60&p=2");
    // The switch does not matter: the address moved either way.
    vi.stubEnv("EVERLOOT_ARMORY", "");
    await expect(pages.moved({ q: "émber" })).rejects.toThrow("NEXT_REDIRECT 308 /guilds?q=%C3%A9mber");
  });

  test("lists guilds by members read with region chips, counts, the credit and sort and filter links in the address", async () => {
    const out = await html(pages.directory());
    expect(out.indexOf("Ember Wardens")).toBeLessThan(out.indexOf("Ash Pact"));
    expect(out).toContain('href="/armory/eu/guilds/ember-wardens"');
    expect(out).toContain('data-region="us"');
    expect(out).toContain("text-region-eu");
    expect(out).toContain(">53.7<");
    expect(out).toContain(BLIZZARD_CREDIT);
    expect(out).toContain('href="/guilds?sort=item-level"');
    expect(out).toContain('href="/guilds?sort=level-60"');
    expect(out).toContain('href="/guilds?region=us"');
    expect(out).toContain('href="/guilds?rules=roleplay-pvp"');
  });

  test("leaves out a disbanded guild (Blizzard's DELETED record) from the rows and the counts, and says so", async () => {
    mem.putGuild(armoryGuild({ region: "us", slug: "old-oath", guildId: 78, name: "DELETED", memberCount: 0 }), []);
    const out = await html(pages.directory());
    expect(out).not.toContain(">DELETED<");
    expect(out).not.toContain("old-oath");
    expect(out).toContain("Ash Pact");
    expect(out).toContain("Disbanded guilds are left out of this list and its counts.");
    expect((await mem.guildDirectory({ prefix: null, region: null, rulesetId: null, sort: "members", limit: 50, offset: 0 }))!.total).toBe(2);
    expect((await mem.counts()).reduce((n, c) => n + c.guilds, 0)).toBe(2);
    // A cloud answer that still carries the row (the migration not yet applied) is filtered on the page too.
    const { loadGuildDirectory, guildDirectoryQuery, isDisbandedGuild } = await import("@/lib/armory-guilds");
    expect(isDisbandedGuild("DELETED")).toBe(true);
    expect(isDisbandedGuild("Deleted Dreams")).toBe(false);
    const row = { region: "us", slug: "old-oath", name: "DELETED", faction: "Alliance", ruleset_id: 1, ruleset: "PvP", member_count: 0, members_read: 0, average_item_level: null, level_60: 0, fetched_at: "2026-11-09T09:00:00.000Z", total: 1 };
    holder.store = createCloudArmoryStore((async () => [row]) as never);
    const dir = await loadGuildDirectory(guildDirectoryQuery({}), new Set());
    expect(dir.state === "ready" && dir.rows).toEqual([]);
  });

  test("searches by name prefix, keeps filters in the form, and says when nothing matches", async () => {
    const found = await html(pages.directory({ q: "ash", region: "us" }));
    expect(found).toContain("Ash Pact");
    expect(found).not.toContain("Ember Wardens");
    expect(found).toContain('name="region" value="us"');
    expect(await html(pages.directory({ q: "zz" }))).toContain("No guild read yet starts with “zz”.");
    expect(await html(pages.directory({ q: "zz" }))).toContain('href="/armory/guilds/submit"');
    expect(await html(pages.directory({ q: "a1" }))).toContain("Type 2 to 24 letters");
  });

  test("pages through the list with page in the address", async () => {
    for (let i = 0; i < 55; i++) mem.putGuild(armoryGuild({ slug: `hall-${i}`, name: `Hall ${String(i).padStart(2, "0")}` }), []);
    const first = await html(pages.directory());
    expect(first).toContain('href="/guilds?p=2"');
    const second = await html(pages.directory({ p: "2" }));
    expect(second).toContain("Hall 54");
    expect(second).not.toContain("Ember Wardens");
  });

  test("a guild hidden through /guilds/hide is left out, as is a hidden character's count", async () => {
    await playerStore().suppressGuild("CAMWOW US1 Realm 4 PvP", "Ash Pact");
    await mem.hide("eu", "torvin-ashbrook");
    const out = await html(pages.directory());
    expect(out).not.toContain("Ash Pact");
    expect(out).toContain(">57.4<");
  });

  test("before the migration it says the directory is not ready, and a search still finds guilds by name", async () => {
    const guild = { region: "eu", slug: "ember-wardens", name: "Ember Wardens", faction: "Horde", ruleset: "Normal", member_count: 3 };
    holder.store = createCloudArmoryStore((async (path: string) => {
      if (path === "rpc/armory_guild_directory") throw new StorageError(404, "PGRST202", "missing");
      return path === "rpc/armory_search_guilds" ? [guild] : [];
    }) as never);
    const bare = await html(pages.directory());
    expect(bare).toContain("Counts and sorting start once the directory&#x27;s database update is applied.");
    expect(bare).not.toContain(STORAGE_UNREACHABLE);
    const found = await html(pages.directory({ q: "emb" }));
    expect(found).toContain('href="/armory/eu/guilds/ember-wardens"');
    expect(found).not.toContain("Members read</th>");
  });

  test("storage out of reach says so", async () => {
    holder.store = createCloudArmoryStore((async () => { throw new StorageError(500, null, "down"); }) as never);
    const out = await html(pages.directory());
    expect(out).toContain(STORAGE_UNREACHABLE);
    expect(out).toContain(BLIZZARD_CREDIT);
  });
});

describe("the guild page summary", () => {
  test("population tiles and labelled bars count only shown members", async () => {
    const out = await html(pages.guild("eu", "ember-wardens"));
    expect(out).toContain("On the roster");
    expect(out).toContain("Members read");
    expect(out).toContain("Level 60");
    expect(out).toMatch(/On the roster<\/dt><dd[^>]*>3<\/dd>/);
    expect(out).toMatch(/Members read<\/dt><dd[^>]*>2<\/dd>/);
    expect(out).toMatch(/Level 60<\/dt><dd[^>]*>1<\/dd>/);
    expect(out).toContain('data-population="classes"');
    expect(out).toContain("2 (66.7%)");
    expect(out).toContain("1 (33.3%)");
    expect(out).toContain("bg-class-hunter");
    expect(out).toContain('data-population="item-levels"');
    expect(out).toContain("50–59");
    expect(out).toContain("2 (100%)");
    expect(out).toContain('action="/guilds"');
    expect(out).toContain('href="/armory/guilds/submit?region=eu&amp;name=Ember+Wardens"');
    await mem.hide("eu", "torvin-ashbrook");
    const hidden = await html(pages.guild("eu", "ember-wardens"));
    expect(hidden).not.toContain("bg-class-warrior");
    expect(hidden).not.toContain("Torvin");
    expect(hidden).toContain("2 (100%)");
    expect(hidden).toMatch(/On the roster<\/dt><dd[^>]*>2<\/dd>/);
    expect(hidden).toMatch(/Members read<\/dt><dd[^>]*>1<\/dd>/);
  });

  test("sort parameters order roster rows and keep unread item levels last", async () => {
    for (const [sort, first, last] of [["rank", "Brannoc", "Torvin"], ["level", "Velkara", "Brannoc"], ["item-level", "Velkara", "Brannoc"], ["name", "Brannoc", "Velkara"], ["invalid", "Brannoc", "Torvin"]]) {
      const out = await html(pages.guild("eu", "ember-wardens", { sort: sort! }));
      expect(out.indexOf(first!)).toBeLessThan(out.indexOf(last!));
      expect(out).toContain(`?sort=item-level`);
    }
  });

  test("refresh link is available only after the recheck window using checkedAt", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-29T09:00:00Z"));
      mem.putGuild(armoryGuild({ checkedAt: "2026-11-09T09:00:00.001Z" }), []);
      expect(await html(pages.guild("eu", "ember-wardens"))).not.toContain(">Refresh this guild<");
      mem.putGuild(armoryGuild({ checkedAt: "2026-11-09T09:00:00Z" }), []);
      expect(await html(pages.guild("eu", "ember-wardens"))).toContain(">Refresh this guild<");
    } finally { vi.useRealTimers(); }
  });

  test("shows the class mix, the level spread, the average item level of members read and the roster read time", async () => {
    const out = await html(pages.guild("eu", "ember-wardens"));
    expect(out).toContain('aria-label="Guild profile"');
    expect(out).toContain("Class mix");
    expect(out).toContain("bg-class-hunter");
    expect(out).toContain("bg-class-warrior");
    expect(out).toContain("2 (66.7%)");
    expect(out).toContain("1 (33.3%)");
    expect(out).toContain("53.7 (2 read)");
    expect(out).toContain("2026-11-09");
    expect(out).toContain('"name":"Guilds","item":"https://everloot.app/guilds"'); // the trail runs Home › Guilds › the guild
    expect(out).toContain('href="/armory/eu/torvin-ashbrook"');
  });

  test("a hidden member leaves the roster and the summary; a hidden guild is a 404", async () => {
    await mem.hide("eu", "torvin-ashbrook");
    const out = await html(pages.guild("eu", "ember-wardens"));
    expect(out).not.toContain("Torvin");
    expect(out).not.toContain("Warrior");
    expect(out).toContain("57.4 (1 read)");
    await playerStore().suppressGuild("EU1 Realm 2 Normal", "Ember Wardens");
    await expect(pages.guild("eu", "ember-wardens")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

test("ranking rows carry the region chip", async () => {
  expect(await html(pages.board("item-level"))).toMatch(/data-region="eu"[^>]*>EU<\/span>Normal/);
});
