import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BLIZZARD_CREDIT } from "@/lib/armory";
import { armoryCharacter, armoryGuild } from "@/lib/armory.fixture";
import { createCloudArmoryStore, createMemoryArmoryStore, type ArmoryStore, type MemoryArmoryStore } from "@/lib/armory-store";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { createMemoryPlayerStore, type PlayerStore } from "@/lib/player-store";
vi.mock("@/components/guild-profile", () => ({ default: () => <section aria-label="Guild profile">Claim or edit this guild</section> }));

vi.mock("@/components/progression/GuildProgression", () => ({ default: () => <section data-guild-progression-hook /> }));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`NEXT_REDIRECT 308 ${to}`); },
  usePathname: () => "/armory", useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams(),
}));

const holder = vi.hoisted(() => ({ store: null as ArmoryStore | null }));
vi.mock("@/lib/armory-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/armory-store")>()), armoryStore: () => holder.store }));

const sightings = vi.hoisted(() => ({ store: null as PlayerStore | null }));
vi.mock("@/lib/player-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/player-store")>()), playerStore: () => sightings.store }));

let mem: MemoryArmoryStore;
beforeEach(() => {
  sightings.store = createMemoryPlayerStore();
  mem = createMemoryArmoryStore(() => new Date("2026-11-10T00:00:00Z"));
  mem.putCharacter(armoryCharacter());
  mem.putCharacter(armoryCharacter({ slug: "torvin-ashbrook", name: "Torvin", surname: "Ashbrook", class: "Warrior", classId: 1, itemLevel: 60, gearScore: null, honorableKills: 5, fetchedAt: "2026-11-09T11:30:00.000Z" }));
  mem.putGuild(armoryGuild(), [
    { characterSlug: "velkara-duskmantle", name: "Velkara", surname: "Duskmantle", level: 60, classId: 3, raceId: 8, rank: 1 },
    { characterSlug: "brannoc-tide", name: "Brannoc", surname: "Tide", level: 41, classId: 6, raceId: 10, rank: 0 },
  ]);
  holder.store = mem;
  vi.stubEnv("EVERLOOT_ARMORY", "1");
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

/** A store whose every call fails, as when the migration is not applied or Supabase is down. */
const broken = (): ArmoryStore => new Proxy({} as ArmoryStore, { get: () => async () => { throw new Error("down"); } });

const pages = {
  hub: async (search: Record<string, string> = {}) => (await import("./page")).default({ searchParams: Promise.resolve(search) }),
  character: async (region: string, slug: string) => (await import("./[region]/[slug]/page")).default({ params: Promise.resolve({ region, slug }) }),
  guild: async (region: string, slug: string) => (await import("./[region]/guilds/[slug]/page")).default({ params: Promise.resolve({ region, slug }) }),
  board: async (metric: string, search: Record<string, string> = {}) => (await import("./rankings/[metric]/page")).default({ params: Promise.resolve({ metric }), searchParams: Promise.resolve(search) }),
  hide: async (search: Record<string, string> = {}) => (await import("./hide/page")).default({ searchParams: Promise.resolve(search) }),
  submit: async (search: Record<string, string> = {}) => (await import("./submit/page")).default({ searchParams: Promise.resolve(search) }),
};
const html = async (page: Promise<React.ReactElement>) => renderToStaticMarkup(await page);

test("with the switch off every armory page is a 404, says Page not found, and reads nothing", async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "");
  const spy = vi.spyOn(mem, "character");
  for (const run of [() => pages.hub(), () => pages.character("eu", "velkara-duskmantle"), () => pages.guild("eu", "ember-wardens"), () => pages.board("item-level"), () => pages.hide(), () => pages.submit()]) {
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
  }
  expect(spy).not.toHaveBeenCalled();
  const metas = await Promise.all([
    (await import("./page")).generateMetadata(),
    (await import("./[region]/[slug]/page")).generateMetadata({ params: Promise.resolve({ region: "eu", slug: "velkara-duskmantle" }) }),
    (await import("./[region]/guilds/[slug]/page")).generateMetadata({ params: Promise.resolve({ region: "eu", slug: "ember-wardens" }) }),
    (await import("./rankings/[metric]/page")).generateMetadata({ params: Promise.resolve({ metric: "item-level" }) }),
    (await import("./hide/page")).generateMetadata(),
    (await import("./submit/page")).generateMetadata(),
  ]);
  for (const m of metas) expect(m).toMatchObject({ title: "Page not found", robots: { index: false, follow: false } });
});

test("every page stays out of search engines and carries the credit line", async () => {
  const metas = await Promise.all([
    (await import("./page")).generateMetadata(),
    (await import("./[region]/[slug]/page")).generateMetadata({ params: Promise.resolve({ region: "eu", slug: "velkara-duskmantle" }) }),
    (await import("./[region]/guilds/[slug]/page")).generateMetadata({ params: Promise.resolve({ region: "eu", slug: "ember-wardens" }) }),
    (await import("./rankings/[metric]/page")).generateMetadata({ params: Promise.resolve({ metric: "gear-score" }) }),
    (await import("./hide/page")).generateMetadata(),
    (await import("./submit/page")).generateMetadata(),
  ]);
  for (const m of metas) expect(m.robots).toEqual({ index: false, follow: false });
  for (const page of [() => pages.hub(), () => pages.character("eu", "velkara-duskmantle"), () => pages.guild("eu", "ember-wardens"), () => pages.board("item-level"), () => pages.hide(), () => pages.submit()]) {
    const out = await html(page());
    expect(out).toContain(BLIZZARD_CREDIT);
    expect(out).toMatch(/Read 2026-11-09 \d\d:\d\d UTC/);
  }
});

describe("the character page", () => {
  test("shows who it is, the numbers, the ranks, the gear and the hide link", async () => {
    const out = await html(pages.character("eu", "velkara-duskmantle"));
    expect(out).toContain("Velkara Duskmantle");
    expect(out).toContain("text-class-hunter");
    expect(out).toContain("Level 60 Troll Hunter");
    expect(out).toContain('href="/armory/eu/guilds/ember-wardens"');
    expect(out).toContain("Last login");
    expect(out).toMatch(/Last read <time dateTime="2026-11-09T10:00:00.000Z"[^>]*>2026-11-09<\/time>/);
    expect(out).toContain('role="tablist"');
    expect(out).toContain('data-tab-panel="pvp"');
    expect(out).toContain("57.41");
    expect(out).toContain("61.2");
    expect(out).toContain("1,234");
    expect(out).toContain('href="/armory/rankings/item-level?ruleset=2&amp;region=eu"');
    expect(out).toContain("#2 of 2");
    expect(out).toContain('href="/database/items/16846"');
    expect(out).toContain("text-q-epic");
    expect(out).toContain("Main hand");
    expect(out).toContain('href="/armory/hide?region=eu&amp;name=Velkara&amp;surname=Duskmantle"');
    expect(out).toContain("Read 2026-11-09 10:00 UTC");
  });

  test("the sheet: gear around the summary above the tabs, the summary's numbers and key stats, and no Gear tab", async () => {
    mem.putCharacter(armoryCharacter({ details: { revision: 1, statistics: { asOf: "2026-11-09T10:00:00.000Z", rows: [
      { label: "Health", value: 4512, percent: false }, { label: "Agility", value: 412, percent: false }, { label: "Fire resistance", value: 15, percent: false },
    ] } } }));
    const out = await html(pages.character("eu", "velkara-duskmantle"));
    const at = (s: string) => out.indexOf(s);
    // Left column, the summary in the model's place, right column, weapons, then the tabs.
    expect(at('data-equipment-slot="WRIST"')).toBeLessThan(at("data-sheet-summary"));
    expect(at("data-sheet-summary")).toBeLessThan(at('data-equipment-slot="HANDS"'));
    expect(at('data-equipment-slot="RANGED"')).toBeLessThan(at('role="tablist"'));
    const summary = out.slice(at("data-sheet-summary"), at('data-equipment-slot="HANDS"'));
    for (const text of ["57.41", "61.2", "Gear Score", "#2 of 2", "4,512", "412"]) expect(summary).toContain(text);
    // A stat beyond the key ones stays in the Stats tab only.
    expect(summary).not.toContain("Fire resistance");
    expect(out).toContain('data-tab-panel="stats"');
    expect(out).not.toContain('data-tab-panel="gear"');
    // The header: faction, region and ruleset, guild.
    const header = out.slice(0, at("data-paper-doll"));
    expect(header).toContain("Horde");
    expect(header).toContain('data-region="eu"');
    expect(header).toContain('href="/armory/eu/guilds/ember-wardens"');
  });

  test("the dungeons and raids section has its own named slot, below the gear sheet and above the tabs", async () => {
    const out = await html(pages.character("eu", "velkara-duskmantle"));
    const at = (s: string) => out.indexOf(s);
    const slot = out.slice(at('data-slot="dungeon-raid-progress"'));
    expect(out).toContain('data-slot="dungeon-raid-progress"');
    expect(slot).toContain("data-dungeons-raids");
    expect(at('data-equipment-slot="RANGED"')).toBeLessThan(at('data-slot="dungeon-raid-progress"'));
    expect(at('data-slot="dungeon-raid-progress"')).toBeLessThan(at('role="tablist"'));
  });

  test("the addon's sighting fills in when the old address would redirect here: the day it was last seen and the guild it saw", async () => {
    vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
    vi.stubEnv("EVERLOOT_GUILDS", "1");
    expect(await html(pages.character("eu", "velkara-duskmantle"))).not.toContain('data-part="addon-sighting"');
    await sightings.store!.upsert([{ name: "Velkara", realm: "EU1 Realm 2 Normal", race: "Troll", class: "HUNTER", level: 58, guild: "Ember Wardens", seen: "2026-11-08" }]);
    const out = await html(pages.character("eu", "velkara-duskmantle"));
    const part = out.slice(out.indexOf('data-part="addon-sighting"'));
    expect(part).toContain("Last seen by the addon");
    expect(part).toContain("2026-11-08");
    expect(part).toContain("EU1 Realm 2 Normal");
    expect(part).toContain('href="/guilds/eu1-realm-2-normal/ember-wardens"');
    expect(part).toContain('href="/players/opt-out?realm=EU1%20Realm%202%20Normal&amp;name=Velkara"');
    // The player pages off, or the sighting hidden: nothing from it.
    vi.stubEnv("EVERLOOT_PLAYER_PAGES", "0");
    expect(await html(pages.character("eu", "velkara-duskmantle"))).not.toContain('data-part="addon-sighting"');
    vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
    await sightings.store!.suppress("EU1 Realm 2 Normal", "Velkara");
    expect(await html(pages.character("eu", "velkara-duskmantle"))).not.toContain('data-part="addon-sighting"');
  });

  test("play history ranks sit in the Play history tab, not with the gear numbers", async () => {
    mem.putCharacter(armoryCharacter({ details: { revision: 1, playHistory: { asOf: "2026-11-09T10:00:00.000Z", groups: [{ name: "Skills", rows: [{ id: 1518, name: "Fish caught", value: 9 }] }], ranked: { fish: 9 } } } }));
    const out = await html(pages.character("eu", "velkara-duskmantle"));
    const numbers = out.slice(0, out.indexOf('role="tablist"'));
    expect(numbers).not.toContain("Fish caught");
    expect(out).toContain('data-tab-panel="history"');
    expect(out).toContain('href="/armory/rankings/fish-caught?ruleset=2&amp;region=eu"');
  });

  test("a refused Gear Score leaves it out", async () => {
    const out = await html(pages.character("eu", "torvin-ashbrook"));
    expect(out).not.toContain("Gear Score");
  });

  test("an unknown, hidden or badly spelled character is a 404", async () => {
    await mem.hide("eu", "velkara-duskmantle");
    for (const [region, slug] of [["eu", "velkara-duskmantle"], ["eu", "nobody-here"], ["kr", "torvin-ashbrook"], ["eu", "Torvin-Ashbrook"], ["eu", "torvin"]]) {
      await expect(pages.character(region!, slug!)).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  test("storage out of reach says so instead of throwing, still crediting Blizzard", async () => {
    holder.store = broken();
    const out = await html(pages.character("eu", "velkara-duskmantle"));
    expect(out).toContain(STORAGE_UNREACHABLE);
    expect(out).toContain(BLIZZARD_CREDIT);
    expect(out).toContain("Read time unrecorded");
  });

  test("an accented name has a page, by its encoded address or its plain one", async () => {
    mem.putCharacter(armoryCharacter({ slug: "élodie-brún", name: "Élodie", surname: "Brún", itemLevel: 50 }));
    for (const segment of ["%C3%A9lodie-br%C3%BAn", "élodie-brún"]) {
      const out = await html(pages.character("eu", segment));
      expect(out).toContain("Élodie Brún");
      expect(out).toContain('href="/armory/hide?region=eu&amp;name=%C3%89lodie&amp;surname=Br%C3%BAn"');
    }
    expect(await html(pages.board("item-level"))).toContain('href="/armory/eu/%C3%A9lodie-br%C3%BAn"');
  });
});

describe("the guild page", () => {
  test("lists the roster by rank, links stored members and says Unknown for an id it does not know", async () => {
    const out = await html(pages.guild("eu", "ember-wardens"));
    expect(out).toContain("Ember Wardens");
    // The header says the faction, the region and ruleset and the roster size apart (the guild home's header).
    expect(out).toMatch(/>Horde<\/span> guild/);
    expect(out).toMatch(/>EU<\/span>Normal/);
    expect(out).toContain("3 members");
    expect(out).toContain("2026-10-01");
    expect(out).toContain('href="/armory/eu/velkara-duskmantle"');
    expect(out).not.toContain('href="/armory/eu/brannoc-tide"');
    expect(out.indexOf("Brannoc")).toBeLessThan(out.indexOf("Velkara"));
    expect(out).toContain("text-class-hunter");
    expect(out).toContain(">Unknown<");
    expect(out).toContain("57.41");
    expect(out).toContain("Read 2026-11-09 09:00 UTC");
  });

  test("a hidden member leaves the roster; an unknown guild is a 404; storage out of reach says so", async () => {
    await mem.hide("eu", "velkara-duskmantle");
    expect(await html(pages.guild("eu", "ember-wardens"))).not.toContain("Velkara");
    await expect(pages.guild("eu", "no-guild")).rejects.toThrow("NEXT_NOT_FOUND");
    holder.store = broken();
    const out = await html(pages.guild("eu", "ember-wardens"));
    expect(out).toContain(STORAGE_UNREACHABLE);
    expect(out).toContain(BLIZZARD_CREDIT);
    expect(out).toContain("Read time unrecorded");
  });

  test("a member stored without names shows the names its slug gives, and the roster stands", async () => {
    const guild = { region: "eu", slug: "ember-wardens", guild_id: 77, name: "Ember Wardens", faction: "Horde", ruleset_id: 2, ruleset: "Normal",
      member_count: 2, created_at: null, fetched_at: "2026-11-09T09:00:00+00:00", checked_at: "2026-11-09T09:00:00+00:00" };
    const roster = [
      { character_slug: "brannoc-tide", name: null, surname: null, level: 41, class_id: 1, race_id: 2, rank: 2, item_level: null, gear_score: null, stored: false },
      { character_slug: "velkara-duskmantle", name: "Velkara", surname: null, level: 60, class_id: 3, race_id: 8, rank: 1, item_level: 57.41, gear_score: null, stored: true },
    ];
    holder.store = createCloudArmoryStore((async (path: string) => (path === "rpc/armory_guild" ? [guild] : path === "rpc/armory_roster" ? roster : [])) as never);
    const out = await html(pages.guild("eu", "ember-wardens"));
    expect(out).not.toContain(STORAGE_UNREACHABLE);
    expect(out).toContain(">Brannoc Tide<");
    expect(out).toContain('href="/armory/eu/velkara-duskmantle"');
    expect(out).toContain(">Velkara Duskmantle<");
  });

  test("a single-word guild slug has a page", async () => {
    mem.putGuild(armoryGuild({ slug: "wardens", name: "Wardens" }), []);
    expect(await html(pages.guild("eu", "wardens"))).toContain("Wardens");
  });
});

describe("the boards", () => {
  test("rank characters with links, filter by ruleset and region, and refuse an unknown metric or filter", async () => {
    const out = await html(pages.board("item-level"));
    expect(out.indexOf("Torvin")).toBeLessThan(out.indexOf("Velkara"));
    expect(out).toContain('href="/armory/eu/torvin-ashbrook"');
    expect(out).toContain('href="/armory/rankings/item-level?ruleset=15"');
    expect(out).toContain('href="/armory/rankings/honorable-kills"');
    expect(out).toContain("Read 2026-11-09 11:30 UTC");
    expect(await html(pages.board("gear-score"))).not.toContain("Torvin");
    expect(await html(pages.board("item-level", { region: "us" }))).toContain("No character with this number here yet.");
    await expect(pages.board("dps")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(pages.board("item-level", { ruleset: "4" })).rejects.toThrow("NEXT_NOT_FOUND");
    // A play history board says who it can rank yet; a gear board does not.
    expect(await html(pages.board("fish-caught"))).toContain("ranked once their play history has been read");
    expect(await html(pages.board("item-level"))).not.toContain("play history");
    holder.store = broken();
    expect(await html(pages.board("item-level"))).toContain(STORAGE_UNREACHABLE);
  });

  test("with no region chosen US and EU stand side by side, each ranked on its own, so the bigger region never hides the other", async () => {
    mem.putCharacter(armoryCharacter({ region: "us", slug: "maren-holt", name: "Maren", surname: "Holt", class: "Mage", classId: 8, itemLevel: 40, fetchedAt: "2026-11-09T08:00:00.000Z" }));
    const spy = vi.spyOn(mem, "boardFiltered");
    const out = await html(pages.board("item-level", { class: "mage" }));
    expect(spy).toHaveBeenCalledWith("item_level", "us", null, "Mage", null, 100);
    expect(spy).toHaveBeenCalledWith("item_level", "eu", null, "Mage", null, 100);
    const us = out.slice(out.indexOf('aria-labelledby="board-us"'), out.indexOf('aria-labelledby="board-eu"'));
    expect(us).toContain('href="/armory/us/maren-holt"');
    expect(us).toMatch(/<span[^>]*>1<\/span><a href="\/armory\/us\/maren-holt" class="[^"]*text-class-mage/);
    // Each column opens its region's full table, the other filters kept.
    expect(us).toContain('href="/armory/rankings/item-level?region=us&amp;class=mage"');
    expect(out).toContain("No character with this number here yet.");
    expect(out).toContain("US and EU");
    // One region chosen: the one table with level, race and realm, as before.
    const eu = await html(pages.board("item-level", { region: "eu" }));
    expect(eu).not.toContain('aria-labelledby="board-us"');
    expect(eu).not.toContain("maren-holt");
  });
});

describe("the hub", () => {
  test("counts by region and ruleset, links the boards and the forms, and sends searches to Players and Guilds", async () => {
    const out = await html(pages.hub());
    expect(out).toContain('href="/armory/rankings/item-level"');
    expect(out).toContain('href="/armory/rankings/gear-score"');
    expect(out).toContain('href="/armory/rankings/honorable-kills"');
    expect(out).toContain('href="/armory/hide"');
    expect(out).toContain('href="/armory/submit"');
    expect(out).toContain('href="/players"');
    expect(out).toContain('href="/guilds"');
    expect(out).not.toContain('role="search"');
    expect(out).toContain("Read 2026-11-09 11:30 UTC");
    holder.store = broken();
    expect(await html(pages.hub())).toContain(STORAGE_UNREACHABLE);
  });

  test("an old search address redirects to the one search box: characters to /players, guilds to /guilds", async () => {
    await expect(pages.hub({ q: " Velkara Dusk " })).rejects.toThrow("NEXT_REDIRECT 308 /players?q=Velkara%20Dusk");
    await expect(pages.hub({ guild: "emb" })).rejects.toThrow("NEXT_REDIRECT 308 /guilds?q=emb");
    await expect(pages.hub({ q: "Élo" })).rejects.toThrow("NEXT_REDIRECT 308 /players?q=%C3%89lo");
  });
});

test("the forms keep their fields, confirm, and say what went wrong", async () => {
  const hide = await html(pages.hide({ region: "us", name: "Velkara", surname: "Duskmantle" }));
  expect(hide).toContain('action="/armory/hide/send"');
  expect(hide).toContain('value="Velkara"');
  expect(hide).toContain("not read it from Blizzard again");
  expect(hide).toContain('pattern="[\\p{L}\\p{M}]{2,24}"');
  expect(await html(pages.hide({ done: "1" }))).toContain("Done. That character is hidden");
  expect(await html(pages.hide({ error: "storage" }))).toContain("We could not save that");
  const submit = await html(pages.submit({ done: "1" }));
  expect(submit).toContain('action="/armory/submit/send"');
  expect(submit).toContain("The character is queued");
  expect(await html(pages.submit({ done: "0" }))).toContain("Nothing to add");
  // Storage out of reach still draws the forms, with the read time unrecorded.
  holder.store = broken();
  expect(await html(pages.hide())).toContain("Read time unrecorded");
});

test("classification filters reach storage, preserve each other in links and link guilds", async () => {
  const spy = vi.spyOn(mem, "boardFiltered");
  const out = await html(pages.board("gear-score", { region: "eu", ruleset: "2", class: "hunter", faction: "horde" }));
  expect(spy).toHaveBeenCalledWith("gear_score", "eu", 2, "Hunter", "Horde", 100);
  expect(out).toContain('href="/armory/eu/guilds/ember-wardens"');
  expect(out).toContain('class=hunter&amp;faction=horde');
  expect(out).toContain('class=mage&amp;faction=horde');
  expect(out).toContain('aria-label="Gear Score: 61.2.');
  expect(out).toContain('Read Nov 9, 2026');
  expect(out).toContain('aria-describedby=');
  expect(out).toContain('text-class-hunter');
  await expect(pages.board("gear-score", { class: "invented" })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(pages.board("gear-score", { faction: "invented" })).rejects.toThrow("NEXT_NOT_FOUND");
});

test("a character page shows its dungeons and raids where the dungeon progress line was, linked to the full checklist", async () => {
  const out = await html(pages.character("eu", "velkara-duskmantle"));
  const section = out.split('aria-labelledby="dungeons-raids"')[1]?.split("</section>")[0] ?? "";
  expect(section).toContain("Dungeons &amp; raids");
  expect(section).toContain('href="#progress"');
  // No storage in this test: no synced history is unknown, never 0 cleared.
  expect(section).toContain("No boss kills are synced for this character");
  expect(out.indexOf('aria-labelledby="dungeons-raids"')).toBeLessThan(out.indexOf('id="progress"'));
});
