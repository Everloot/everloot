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

/** The order the guild page's later reads start in. */
const started = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/progression", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/progression")>();
  return { ...real, loadGuildProgression: (...a: Parameters<typeof real.loadGuildProgression>) => { started.push("progression"); return real.loadGuildProgression(...a); } };
});
vi.mock("@/lib/guild-merge", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/guild-merge")>();
  return { ...real, addonGuildOf: (...a: Parameters<typeof real.addonGuildOf>) => { started.push("addon"); return real.addonGuildOf(...a); } };
});
vi.mock("@/lib/guild-profile-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/guild-profile-store")>()),
  guildProfileStore: () => ({ profile: async () => { started.push("profile"); return null; }, access: async () => null }),
}));

let mem: MemoryArmoryStore;
beforeEach(() => {
  started.length = 0;
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
/** A character-sheet tab as it loads when opened. */
const openTab = async (region: string, slug: string, tab: string) =>
  renderToStaticMarkup(<>{await (await import("./[region]/[slug]/tab-action")).characterTab(region, slug, tab)}</>);
/** The roster section alone: the top five above it names members too. */
const roster = (out: string) => out.slice(out.indexOf('aria-labelledby="armory-roster"'));

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
    expect(out).toMatch(/Last read<\/dt><dd[^>]*><time dateTime="2026-11-09T10:00:00.000Z" title="Read 2026-11-09 10:00 UTC"/);
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

  test("a rank shared with others says how many, and a rank read without a tie count reads as before", async () => {
    // Torvin (the store's other EU Normal character) on Velkara's item level: both are #1, each tied with the other.
    mem.putCharacter(armoryCharacter({ slug: "torvin-ashbrook", name: "Torvin", surname: "Ashbrook", itemLevel: armoryCharacter().itemLevel }));
    const tied = await html(pages.character("eu", "velkara-duskmantle"));
    expect(tied).toContain("#1 (tied with 1) of 2");
    // The rank badges above the gear use the same words.
    const badges = tied.slice(tied.indexOf("data-rank-badges"), tied.indexOf("data-paper-doll"));
    expect(badges).toMatch(/>EU Normal · Item level #1 \(tied with 1\) of 2</);
    // Before the database counts ties, the store gives no tied field and the rank reads "#n of N".
    vi.spyOn(mem, "rank").mockResolvedValueOnce([{ metric: "item_level", rank: 1, of: 2 }]);
    const out = await html(pages.character("eu", "velkara-duskmantle"));
    expect(out).toContain("#1 of 2");
    expect(out).not.toContain("tied with");
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
    // The item level, Gear Score and ranks moved up to the facts strip and the rank badges; the summary keeps the rest.
    for (const text of ["Average item level", "58", "4,512", "412"]) expect(summary).toContain(text);
    for (const text of ["57.41", "Gear Score", "#2 of 2"]) expect(summary).not.toContain(text);
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

  test("the dungeons and raids slot sits below the gear sheet and above the tabs, one muted line when nothing is synced", async () => {
    const out = await html(pages.character("eu", "velkara-duskmantle"));
    const at = (s: string) => out.indexOf(s);
    expect(out).toContain('data-slot="dungeon-raid-progress"');
    expect(at('data-equipment-slot="RANGED"')).toBeLessThan(at('data-slot="dungeon-raid-progress"'));
    expect(at('data-slot="dungeon-raid-progress"')).toBeLessThan(at('role="tablist"'));
    const slot = out.slice(at('data-slot="dungeon-raid-progress"'), at('role="tablist"'));
    // No heading, no explainer paragraph: one line and its link to every instance.
    expect(slot).not.toContain("data-dungeons-raids");
    expect(slot).not.toContain("<h2");
    expect(slot.match(/<\/p>/g) ?? []).toHaveLength(1);
    expect(slot).toContain('href="#progress"');
  });

  describe("the first screen", () => {
    const at = "2026-11-09T10:00:00.000Z";
    const detailed = () => armoryCharacter({ details: {
      revision: 1,
      talents: { asOf: at, trees: [
        { name: "Beast Mastery", points: 20, talents: [] }, { name: "Marksmanship", points: 31, talents: [] }, { name: "Survival", points: 0, talents: [] },
      ] },
      professions: { asOf: at, rows: [{ name: "Leatherworking", rank: 265, max: 300 }, { name: "Skinning", rank: 300, max: 300 }] },
      achievements: { asOf: at, rows: [
        { id: 6, name: "Level 10", completedAt: "2026-10-01T12:00:00.000Z" }, { id: 7, name: "Level 20", completedAt: "2026-10-05T12:00:00.000Z" },
        { id: 8, name: "Level 30", completedAt: "2026-10-09T12:00:00.000Z" },
      ] },
      quests: { asOf: at, completed: [788, 789, 804, 805] },
    } });
    beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-12T11:00:00Z") }); });
    afterEach(() => { vi.useRealTimers(); });

    test("the page uses the data width, so the sheet fills a wide screen", async () => {
      expect(await html(pages.character("eu", "velkara-duskmantle"))).toContain('data-container="data"');
    });

    test("two button shapes in the header: a small pill to update and a text link to Blizzard, no box chip", async () => {
      const out = await html(pages.character("eu", "velkara-duskmantle"));
      expect(out).toMatch(/<button type="submit" class="btn btn-sm">Update character<\/button>/);
      expect(out).toMatch(/<a href="https:\/\/worldofwarcraft\.blizzard\.com\/forever\/eu\/armory\/character\/velkara-duskmantle" class="[^"]*underline[^"]*">Blizzard armory<\/a>/);
      expect(out).not.toContain("Blizzard profile");
      expect(out).not.toContain("btn-secondary");
    });

    test("a facts strip under the header: item level, Gear Score, kills, achievements, quests and how long ago it was read", async () => {
      mem.putCharacter(detailed());
      const out = await html(pages.character("eu", "velkara-duskmantle"));
      const strip = out.slice(out.indexOf("data-character-facts"), out.indexOf("data-paper-doll"));
      expect(out.indexOf("data-character-facts")).toBeGreaterThan(-1);
      // The text between the tags of each <dd>, read rather than stripped.
      const textOf = (markup: string) => [...`>${markup}<`.matchAll(/>([^<]*)</g)].map((t) => t[1]).join("");
      const pairs = [...strip.matchAll(/<dt[^>]*>([^<]+)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map((m) => [m[1], textOf(m[2])]);
      expect(pairs).toEqual([
        ["Item level", "57.41"], ["Gear Score", "61.2"], ["Honorable kills", "1,234"],
        ["Achievements", "3"], ["Quests completed", "4"], ["Last read", "3 days ago"],
      ]);
      // The exact read time stays one hover away.
      expect(strip).toContain('title="Read 2026-11-09 10:00 UTC"');
    });

    test("a fact the read did not bring is left out of the strip, never shown as 0", async () => {
      mem.putCharacter(armoryCharacter({ gearScore: null, honorableKills: null }));
      const out = await html(pages.character("eu", "velkara-duskmantle"));
      const strip = out.slice(out.indexOf("data-character-facts"), out.indexOf("data-paper-doll"));
      for (const absent of ["Gear Score", "Honorable kills", "Achievements", "Quests completed"]) expect(strip).not.toContain(absent);
      expect(strip).toContain("Item level");
    });

    test("ranks are badges with their scope, each linking its board, above the gear", async () => {
      const out = await html(pages.character("eu", "velkara-duskmantle"));
      const badges = out.slice(out.indexOf("data-rank-badges"), out.indexOf("data-paper-doll"));
      expect(out.indexOf("data-rank-badges")).toBeGreaterThan(-1);
      expect(badges).toContain('href="/armory/rankings/item-level?ruleset=2&amp;region=eu"');
      expect(badges).toMatch(/data-badge="neutral"[^>]*>EU Normal · Item level #2 of 2</);
    });

    test("spec cards, the largest tree first and brightest, then profession bars, all before the gear", async () => {
      mem.putCharacter(detailed());
      const out = await html(pages.character("eu", "velkara-duskmantle"));
      const overview = out.slice(out.indexOf("data-character-overview"), out.indexOf("data-paper-doll"));
      expect(out.indexOf("data-character-overview")).toBeGreaterThan(-1);
      const cards = [...overview.matchAll(/data-spec-card="([^"]+)"[^>]*><p class="([^"]*)"/g)].map((m) => [m[1], m[2].includes("text-fg-2") ? "fg-2" : "fg"]);
      expect(cards).toEqual([["Marksmanship", "fg"], ["Beast Mastery", "fg-2"], ["Survival", "fg-2"]]);
      expect(overview).toContain("31 points");
      expect(overview).toContain('href="#talents"');
      expect(overview).toContain("265 / 300");
      expect(overview).toMatch(/<progress[^>]*value="265" max="300"/);
      // The Talents tab is still the one that opens (the default tab waits on an owner decision).
      expect(out).toMatch(/aria-selected="true"[^>]*>Talents</);
    });

    test("the credit line sits under the facts strip, not in a band of its own below the header", async () => {
      mem.putCharacter(detailed());
      const out = await html(pages.character("eu", "velkara-duskmantle"));
      const credit = out.indexOf("data-armory-credit");
      expect(credit).toBeGreaterThan(out.indexOf("data-character-facts"));
      expect(credit).toBeLessThan(out.indexOf("data-character-overview"));
      expect(out).toContain(BLIZZARD_CREDIT);
    });

    test("the overview stacks: spec cards as a compact row, then the professions in a two-column grid", async () => {
      mem.putCharacter(detailed());
      const out = await html(pages.character("eu", "velkara-duskmantle"));
      const overview = out.slice(out.indexOf("data-character-overview"), out.indexOf("data-paper-doll"));
      expect(overview).toMatch(/data-character-overview="stacked"/);
      expect(overview).not.toContain("lg:grid-cols-2");
      expect(overview).toMatch(/<ul data-profession-grid="" class="[^"]*sm:grid-cols-2/);
    });

    test("synced kills still get the full dungeons and raids list", async () => {
      const { DungeonRaidSlot } = await import("./[region]/[slug]/sheet");
      const data = { synced: true, summary: { cleared: 1, total: 20 }, instances: [{
        id: 36, name: "The Deadmines", group: "Dungeons" as const, killed: 2, total: 8, cleared: false, lastKillDay: "2026-11-01", firstClearDay: null,
        bosses: [{ id: 1, name: "Rhahk'Zor", killed: true, kills: 1, firstKillDay: "2026-11-01", lastKillDay: "2026-11-01" }],
      }] } as unknown as Parameters<typeof DungeonRaidSlot>[0]["data"];
      const out = renderToStaticMarkup(<DungeonRaidSlot data={data} href="#progress" />);
      expect(out).toContain("data-dungeons-raids");
      expect(out).toContain("The Deadmines");
      expect(renderToStaticMarkup(<DungeonRaidSlot data={{ synced: true, summary: null, instances: [] }} href="#progress" />)).not.toContain("data-dungeons-raids");
    });

    test("a character without talent or profession reads has no overview row", async () => {
      const out = await html(pages.character("eu", "velkara-duskmantle"));
      expect(out).not.toContain("data-character-overview");
    });
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
    const tab = await openTab("eu", "velkara-duskmantle", "history");
    expect(tab).toContain("Fish caught");
    expect(tab).toContain('href="/armory/rankings/fish-caught?ruleset=2&amp;region=eu"');
  });

  describe("tabs other than Talents load when opened", () => {
    const at = "2026-11-09T10:00:00.000Z";
    beforeEach(() => {
      mem.putCharacter(armoryCharacter({ details: {
        revision: 1,
        talents: { asOf: at, trees: [{ name: "Marksmanship", points: 31, talents: [{ name: "Trueshot Aura", rank: 1 }] }] },
        achievements: { asOf: at, rows: [{ id: 6, name: "Level 10", completedAt: "2026-10-01T12:00:00.000Z" }] },
        reputations: { asOf: at, rows: [{ id: 530, name: "Darkspear Trolls", standing: "Exalted", tier: 7 }] },
      } }));
    });

    test("the page draws the Talents panel and a loading line in every other, never their content", async () => {
      const out = await html(pages.character("eu", "velkara-duskmantle"));
      const panel = (id: string) => out.slice(out.indexOf(`data-tab-panel="${id}"`)).split('role="tabpanel"')[0];
      expect(panel("talents")).toContain("Trueshot Aura");
      expect(panel("talents")).not.toContain("data-tab-loading");
      for (const id of ["stats", "pvp", "achievements", "professions", "reputations", "quests", "history", "progress"]) {
        expect(panel(id)).toContain(`data-tab-loading="${id}"`);
      }
      expect(out).not.toContain("Darkspear Trolls");
      expect(out).not.toContain('href="/database/achievements/6"');
      expect(out).not.toContain("data-progression-instance");
    });

    test("an opened tab holds what the page used to draw in it", async () => {
      expect(await openTab("eu", "velkara-duskmantle", "reputations")).toContain("Darkspear Trolls");
      expect(await openTab("eu", "velkara-duskmantle", "achievements")).toContain('href="/database/achievements/6"');
      expect(await openTab("eu", "velkara-duskmantle", "progress")).toContain("data-progression-instance");
      const pvp = await openTab("eu", "velkara-duskmantle", "pvp");
      expect(pvp).toContain("1,234");
      expect(pvp).toContain('href="/armory/rankings/honorable-kills?ruleset=2&amp;region=eu"');
      expect(await openTab("eu", "velkara-duskmantle", "quests")).toContain('data-empty-tab="quests"');
    });

    test("a tab reads the character again, so one hidden after the page loaded shows nothing of it", async () => {
      await html(pages.character("eu", "velkara-duskmantle"));
      await mem.hide("eu", "velkara-duskmantle");
      const tab = await openTab("eu", "velkara-duskmantle", "reputations");
      expect(tab).toContain("no longer on Everloot");
      expect(tab).not.toContain("Darkspear Trolls");
    });

    test("an unknown tab, the switch off, or storage out of reach gives no content", async () => {
      expect(await openTab("eu", "velkara-duskmantle", "gold")).toBe("");
      holder.store = broken();
      expect(await openTab("eu", "velkara-duskmantle", "reputations")).toContain("did not answer");
      vi.stubEnv("EVERLOOT_ARMORY", "0");
      expect(await openTab("eu", "velkara-duskmantle", "reputations")).toBe("");
    });

    test("the page asks the store for the character and its ranks once each", async () => {
      const character = vi.spyOn(mem, "character");
      const rank = vi.spyOn(mem, "rank");
      await html(pages.character("eu", "velkara-duskmantle"));
      expect(character).toHaveBeenCalledTimes(1);
      expect(rank).toHaveBeenCalledTimes(1);
    });

    test("the ranks read starts with the character read, not after it", async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const read = mem.character.bind(mem);
      const character = vi.spyOn(mem, "character").mockImplementation(async (region, slug) => { await gate; return read(region, slug); });
      const rank = vi.spyOn(mem, "rank");
      const search = vi.spyOn(mem, "search");
      vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
      const page = html(pages.character("eu", "velkara-duskmantle"));
      await vi.waitFor(() => expect(character).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 0));
      expect(rank).toHaveBeenCalledTimes(1);
      // The addon-sighting search asks by the first name, which the address carries in lower case.
      expect(search).toHaveBeenCalledTimes(1);
      expect(search.mock.calls[0]![0].toLowerCase()).toBe("velkara");
      release();
      expect(await page).toContain("Velkara");
      expect(rank).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledTimes(1);
    });

    test("a character whose address does not start with its name is still searched for by its name", async () => {
      mem.putCharacter(armoryCharacter({ slug: "odd-address", name: "Mirela", surname: "Vane" }));
      vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
      const search = vi.spyOn(mem, "search");
      await html(pages.character("eu", "odd-address"));
      expect(search.mock.calls.map((c) => c[0].toLowerCase())).toContain("mirela");
    });
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
  test("the profile read starts with the guild read, and progression beside the addon guild search", async () => {
    const read = mem.guild.bind(mem);
    vi.spyOn(mem, "guild").mockImplementation(async (region, slug) => { started.push("guild"); return read(region, slug); });
    await html(pages.guild("eu", "ember-wardens"));
    expect(started.indexOf("profile")).toBeLessThan(started.indexOf("guild"));
    expect(started).toContain("addon");
    expect(started.indexOf("progression")).toBeGreaterThan(-1);
    expect(started.indexOf("progression")).toBeLessThan(started.indexOf("addon"));
    expect(started.indexOf("profile")).toBeGreaterThan(-1);
    expect(started.indexOf("profile")).toBeLessThan(started.indexOf("addon"));
  });

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
    expect(roster(out).indexOf("Brannoc")).toBeLessThan(roster(out).indexOf("Velkara"));
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
  const line = out.split('data-slot="dungeon-raid-progress"')[1]?.split("</p>")[0] ?? "";
  expect(line).toContain("Dungeons &amp; raids");
  expect(line).toContain('href="#progress"');
  // No storage in this test: no synced history is unknown, never 0 cleared.
  expect(line).toContain("no boss kills are synced for this character");
  expect(out.indexOf('data-slot="dungeon-raid-progress"')).toBeLessThan(out.indexOf('id="progress"'));
});
