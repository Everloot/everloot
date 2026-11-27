import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { armoryCharacter } from "@/lib/armory.fixture";
import { createMemoryArmoryStore, type ArmoryStore, type MemoryArmoryStore } from "@/lib/armory-store";
import { createMemoryPlayerStore, type PlayerStore } from "@/lib/player-store";
import { compareHref, compareSide } from "./sides";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  usePathname: () => "/armory/compare", useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams(),
}));

const holder = vi.hoisted(() => ({ store: null as ArmoryStore | null }));
vi.mock("@/lib/armory-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/armory-store")>()), armoryStore: () => holder.store }));
const sightings = vi.hoisted(() => ({ store: null as PlayerStore | null }));
vi.mock("@/lib/player-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/player-store")>()), playerStore: () => sightings.store }));

const VELKARA = "eu/velkara-duskmantle";
const TORVIN = "us/torvin-ashbrook";
let mem: MemoryArmoryStore;
beforeEach(() => {
  sightings.store = createMemoryPlayerStore();
  mem = createMemoryArmoryStore(() => new Date("2026-11-10T00:00:00Z"));
  mem.putCharacter(armoryCharacter({
    details: {
      revision: 1,
      talents: { asOf: "2026-11-09T10:00:00.000Z", trees: [{ name: "Beast Mastery", points: 21, talents: [] }, { name: "Marksmanship", points: 30, talents: [] }, { name: "Survival", points: 0, talents: [] }] },
      achievements: { asOf: "2026-11-09T10:00:00.000Z", rows: [{ id: 6, name: "Level 10", completedAt: "2026-10-01T00:00:00.000Z" }] },
      quests: { asOf: "2026-11-09T10:00:00.000Z", completed: [1, 2, 3] },
    },
  }));
  mem.putCharacter(armoryCharacter({
    region: "us", slug: "torvin-ashbrook", name: "Torvin", surname: "Ashbrook", class: "Warrior", classId: 1, itemLevel: 60, gearScore: null, honorableKills: 5,
    equipment: [
      { slot: "HEAD", itemId: 12640, name: "Lionheart Helm", level: 63, quality: "EPIC", inventoryType: "HEAD" },
      { slot: "MAIN_HAND", itemId: 19019, name: "Thunderfury", level: 80, quality: "LEGENDARY", inventoryType: "WEAPON" },
      { slot: "CHEST", itemId: 11726, name: "Savage Gladiator Chain", level: 63, quality: "EPIC", inventoryType: "CHEST" },
    ],
  }));
  holder.store = mem;
  vi.stubEnv("EVERLOOT_ARMORY", "1");
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

const page = async (search: Record<string, string>) =>
  renderToStaticMarkup(await (await import("./page")).default({ searchParams: Promise.resolve(search) }));
const meta = async (search: Record<string, string>) => (await import("./page")).generateMetadata({ searchParams: Promise.resolve(search) });

test("a side is region/slug: valid ones parse, anything else does not", () => {
  expect(compareSide("eu/velkara-duskmantle")).toEqual({ region: "eu", slug: "velkara-duskmantle" });
  expect(compareSide("us/%C3%A9lodie-br%C3%BAn")).toEqual({ region: "us", slug: "élodie-brún" });
  for (const bad of [undefined, "", "kr/x", "eu", "eu/", "eu/Upper-Case", "eu/a/b"]) expect(compareSide(bad), String(bad)).toBeNull();
  expect(compareHref({ region: "eu", slug: "velkara-duskmantle" }, { region: "us", slug: "torvin-ashbrook" })).toBe("/armory/compare?a=eu%2Fvelkara-duskmantle&b=us%2Ftorvin-ashbrook");
  expect(compareHref({ region: "eu", slug: "velkara-duskmantle" })).toBe("/armory/compare?a=eu%2Fvelkara-duskmantle");
});

test("two stored characters render side by side: names, every slot in pairs, the facts and the spec split", async () => {
  const out = await page({ a: VELKARA, b: TORVIN });
  expect(out).toContain("Velkara Duskmantle");
  expect(out).toContain("Torvin Ashbrook");
  expect(out).toContain('href="/armory/eu/velkara-duskmantle"');
  expect(out).toContain('href="/armory/us/torvin-ashbrook"');
  // Every slot is one pair, in the game's order.
  expect(out.match(/data-compare-slot=/g)).toHaveLength(19);
  expect(out.indexOf('data-compare-slot="HEAD"')).toBeLessThan(out.indexOf('data-compare-slot="MAIN_HAND"'));
  expect(out).toContain("Giantstalker");
  expect(out).toContain("Lionheart Helm");
  // The facts side by side; a number the read did not bring says so, never 0.
  expect(out).toMatch(/Item level(?:<[^>]*>)*\s*57\.41(?:<[^>]*>)*\s*60/);
  expect(out).toMatch(/Gear Score(?:<[^>]*>)*\s*61\.2(?:<[^>]*>)*\s*Not read/);
  expect(out).toMatch(/Quests completed(?:<[^>]*>)*\s*3(?:<[^>]*>)*\s*Not read/);
  expect(out).toMatch(/Achievements(?:<[^>]*>)*\s*1(?:<[^>]*>)*\s*Not read/);
  // The spec split in the trees' own order.
  expect(out).toContain("21 / 30 / 0");
  expect(out).toContain("Beast Mastery");
});

test("item level deltas: B against A per slot, green when higher, red when lower, none when a side is empty", async () => {
  const out = await page({ a: VELKARA, b: TORVIN });
  const slot = (key: string) => {
    const at = out.indexOf(`data-compare-slot="${key}"`);
    const next = out.indexOf("data-compare-slot=", at + 1);
    return out.slice(at, next === -1 ? undefined : next);
  };
  // Head: 66 against 63, Torvin is 3 lower.
  expect(slot("HEAD")).toMatch(/data-delta="-3"[^>]*class="[^"]*text-danger/);
  expect(slot("HEAD")).toContain("−3");
  // Main hand: 69 against 80, Torvin is 11 higher.
  expect(slot("MAIN_HAND")).toMatch(/data-delta="11"[^>]*class="[^"]*text-accent/);
  expect(slot("MAIN_HAND")).toContain("+11");
  // Chest: only Torvin wears one, so there is no number to compare.
  expect(slot("CHEST")).not.toContain("data-delta");
  expect(slot("FEET")).not.toContain("data-delta");
  // The same level is even, in neither colour.
  mem.putCharacter(armoryCharacter({ region: "us", slug: "torvin-ashbrook", name: "Torvin", surname: "Ashbrook" }));
  const even = await page({ a: VELKARA, b: TORVIN });
  expect(even).toMatch(/data-delta="0"[^>]*class="[^"]*text-muted/);
});

test("a side stored with no item levels compares on the game files' levels, each marked, and its numbers say they are computed", async () => {
  const bare = armoryCharacter();
  mem.putCharacter(armoryCharacter({ itemLevel: null, gearScore: null, equipment: bare.equipment.map((i) => ({ ...i, level: null })) }));
  vi.doMock("@/lib/equipped-item-tips", () => ({ loadEquippedItems: async () => ({ tips: new Map(), unknown: new Set(), levels: new Map([[16846, 66], [17069, 69]]) }) }));
  try {
    const out = await page({ a: VELKARA, b: TORVIN });
    expect(out).toContain('aria-label="Item level 66, from the game files"');
    // The deltas use the files' levels: head 66 against Torvin's 63.
    expect(out).toContain('data-delta="-3"');
    // (66 + 69) / 17, floored; Torvin's stored 60 is not marked.
    expect(out).toMatch(/Item level(?:<[^>]*>)*\s*7\*(?:<[^>]*>)*\s*60</);
    expect(out).toContain("* Computed on this page from the game files&#x27; item levels");
  } finally {
    vi.doUnmock("@/lib/equipped-item-tips");
  }
});

test("the rank lines of each side, in rankText's words", async () => {
  const out = await page({ a: VELKARA, b: TORVIN });
  // Each is ranked within its own region and ruleset.
  expect(out).toContain("EU Normal · Item level #1 of 1");
  expect(out).toContain("US Normal · Item level #1 of 1");
});

test("a hidden or missing side says so on its side; the other still renders", async () => {
  const out = await page({ a: VELKARA, b: "us/nobody-here" });
  expect(out).toContain("Velkara Duskmantle");
  expect(out).toMatch(/data-compare-missing="b"/);
  expect(out).toContain("No stored character at us/nobody-here");
  // The gear pairs still list A's side.
  expect(out).toContain("Giantstalker");
  await mem.hide("eu", "velkara-duskmantle");
  const hidden = await page({ a: VELKARA, b: TORVIN });
  expect(hidden).toMatch(/data-compare-missing="a"/);
  expect(hidden).toContain("Torvin Ashbrook");
  expect(hidden).not.toContain("Velkara");
});

test("both sides missing is a 404; so is the switch off", async () => {
  await expect(page({ a: "eu/nobody-here", b: "us/nobody-there" })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(page({ a: "kr/bad", b: "nonsense" })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(page({})).rejects.toThrow("NEXT_NOT_FOUND");
  vi.stubEnv("EVERLOOT_ARMORY", "");
  await expect(page({ a: VELKARA, b: TORVIN })).rejects.toThrow("NEXT_NOT_FOUND");
});

test("with one side chosen the page offers the name search for the other", async () => {
  const out = await page({ a: VELKARA });
  expect(out).toContain("Velkara Duskmantle");
  expect(out).toMatch(/<form[^>]*action="\/armory\/compare"[^>]*method="get"/);
  expect(out).toContain('name="a" value="eu/velkara-duskmantle"');
  expect(out).toContain('name="q"');
  expect(out).toContain("Compare with");
});

test("storage out of reach says so instead of throwing", async () => {
  holder.store = new Proxy({} as ArmoryStore, { get: () => async () => { throw new Error("down"); } });
  const out = await page({ a: VELKARA, b: TORVIN });
  expect(out).toContain("data-armory-credit");
  expect(out).toMatch(/role="status"/);
});

test("the page stays out of search engines and places no ad", async () => {
  for (const search of [{ a: VELKARA, b: TORVIN }, { a: "eu/nobody", b: "us/nobody" }]) {
    const m = await meta(search);
    expect(m.robots).toEqual({ index: false, follow: false });
  }
  expect((await meta({ a: VELKARA, b: TORVIN })).title).toBe("Compare Velkara Duskmantle and Torvin Ashbrook");
});

test("the character page links Compare with… from its header", async () => {
  const out = renderToStaticMarkup(await (await import("../[region]/[slug]/page")).default({ params: Promise.resolve({ region: "eu", slug: "velkara-duskmantle" }) }));
  expect(out).toContain('href="/armory/compare?a=eu%2Fvelkara-duskmantle"');
  expect(out).toContain("Compare with…");
});

test("a count of 0 shows without a rank: it would only share the last place", async () => {
  mem.putCharacter(armoryCharacter({ region: "us", slug: "torvin-ashbrook", name: "Torvin", surname: "Ashbrook", class: "Warrior", classId: 1, itemLevel: 60, gearScore: null, honorableKills: 0 }));
  const out = await page({ a: VELKARA, b: TORVIN });
  expect(out).toContain("US Normal · Item level #1 of 1");
  expect(out).not.toContain("US Normal · Honorable kills");
  expect(out).toContain("EU Normal · Honorable kills #1 of 1");
});
