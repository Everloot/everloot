import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BLIZZARD_CREDIT } from "@/lib/armory";
import { armoryCharacter, armoryGuild } from "@/lib/armory.fixture";
import { createMemoryArmoryStore, type ArmoryStore, type MemoryArmoryStore } from "@/lib/armory-store";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  usePathname: () => "/armory", useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams(),
}));

const holder = vi.hoisted(() => ({ store: null as ArmoryStore | null }));
vi.mock("@/lib/armory-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/armory-store")>()), armoryStore: () => holder.store }));

let mem: MemoryArmoryStore;
beforeEach(() => {
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

  test("storage out of reach says so instead of throwing", async () => {
    holder.store = broken();
    expect(await html(pages.character("eu", "velkara-duskmantle"))).toContain(STORAGE_UNREACHABLE);
  });
});

describe("the guild page", () => {
  test("lists the roster by rank, links stored members and says Unknown for an id it does not know", async () => {
    const out = await html(pages.guild("eu", "ember-wardens"));
    expect(out).toContain("Ember Wardens");
    expect(out).toContain("Horde guild · EU Normal · 3 members");
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
    expect(await html(pages.guild("eu", "ember-wardens"))).toContain(STORAGE_UNREACHABLE);
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
    holder.store = broken();
    expect(await html(pages.board("item-level"))).toContain(STORAGE_UNREACHABLE);
  });
});

describe("the hub", () => {
  test("counts by region and ruleset, links the boards, the forms and searches characters and guilds", async () => {
    const out = await html(pages.hub({ q: "vel", guild: "emb" }));
    expect(out).toContain('href="/armory/rankings/item-level"');
    expect(out).toContain('href="/armory/rankings/gear-score"');
    expect(out).toContain('href="/armory/rankings/honorable-kills"');
    expect(out).toContain('href="/armory/hide"');
    expect(out).toContain('href="/armory/submit"');
    expect(out).toContain('href="/armory/eu/velkara-duskmantle"');
    expect(out).toContain('href="/armory/eu/guilds/ember-wardens"');
    expect(out).toContain("Read 2026-11-09 11:30 UTC");
    expect(await html(pages.hub({ q: "v1" }))).toContain("Type 2 to 24 letters");
    holder.store = broken();
    expect(await html(pages.hub())).toContain(STORAGE_UNREACHABLE);
  });
});

test("the forms keep their fields, confirm, and say what went wrong", async () => {
  const hide = await html(pages.hide({ region: "us", name: "Velkara", surname: "Duskmantle" }));
  expect(hide).toContain('action="/armory/hide/send"');
  expect(hide).toContain('value="Velkara"');
  expect(hide).toContain("not read it from Blizzard again");
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
