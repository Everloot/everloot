import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMemoryPlayerStore, type PlayerStore } from "@/lib/player-store";
import { armoryCharacter } from "@/lib/armory.fixture";
import { createMemoryArmoryStore, type ArmoryStore, type MemoryArmoryStore } from "@/lib/armory-store";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("next/cache", () => ({ unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn, revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const holder = vi.hoisted(() => ({ store: null as PlayerStore | null, armory: null as ArmoryStore | null }));
vi.mock("@/lib/player-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/player-store")>()), playerStore: () => holder.store }));
vi.mock("@/lib/armory-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/armory-store")>()), armoryStore: () => holder.armory }));

const player = { name: "Thrallina", realm: "Forever Pioneer", race: "Scourge", class: "SHAMAN", level: 24, guild: "Night Watch", seen: "2026-10-20" };

let armory: MemoryArmoryStore;
beforeEach(async () => {
  holder.store = createMemoryPlayerStore();
  await holder.store.upsert([player]);
  armory = createMemoryArmoryStore(() => new Date("2026-11-10T00:00:00Z"));
  holder.armory = armory;
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

const on = () => vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");

test("with the switch off the search and the hide form are 404s and the store is never asked", async () => {
  const spy = vi.spyOn(holder.store!, "search");
  const { default: Search } = await import("./page");
  const { default: OptOut } = await import("./opt-out/page");
  await expect(Search({ searchParams: Promise.resolve({ q: "thr" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(OptOut({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(spy).not.toHaveBeenCalled();
});

describe("the old character address", () => {
  const go = async (path: string, method: "GET" | "HEAD" = "GET") => {
    const route = await import("./[ruleset]/[realm]/[name]/route");
    return route[method](new Request(`https://everloot.app${path}`, { method }));
  };

  test("answers a temporary 307, kept an hour at most, with the character's one page, switch on or off, and reads nothing", async () => {
    const get = vi.spyOn(holder.store!, "get");
    for (const value of ["1", ""]) {
      vi.stubEnv("EVERLOOT_PLAYER_PAGES", value);
      const res = await go("/players/forever/forever-pioneer/thrallina");
      expect(res.status).toBe(307);
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
      expect(res.headers.get("location")).toBe("https://everloot.app/characters/forever/forever-pioneer/thrallina");
    }
    const head = await go("/players/forever/forever-pioneer/thrallina", "HEAD");
    expect(head.status).toBe(307);
    expect(head.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(get).not.toHaveBeenCalled();
  });

  test("keeps the encoded segments exactly as they were sent, and the query", async () => {
    for (const path of [
      "/players/forever/mal'ganis/thrallina",
      "/players/forever/%C3%A9b%C3%A8ne%2Ftwo/%C3%B8rn",
      "/players/forever/Forever-Pioneer/THRALLINA",
      "/players/forever/forever%20pioneer/thrallina",
    ]) {
      const location = (await go(path)).headers.get("location");
      expect(location).toBe(`https://everloot.app${path.replace("/players/", "/characters/")}`);
    }
    expect((await go("/players/forever/forever-pioneer/thrallina?utm_source=x")).headers.get("location"))
      .toBe("https://everloot.app/characters/forever/forever-pioneer/thrallina?utm_source=x");
  });
});

test("a search result page always stays out of search engines; the bare search page follows the index switch", async () => {
  on();
  const { generateMetadata: searchMetadata } = await import("./page");
  expect(await searchMetadata({ searchParams: Promise.resolve({}) })).toMatchObject({ robots: { index: false } });
  vi.stubEnv("EVERLOOT_PLAYER_PAGES_INDEX", "1");
  expect(await searchMetadata({ searchParams: Promise.resolve({ q: "thr" }) })).toMatchObject({ robots: { index: false } });
  expect(await searchMetadata({ searchParams: Promise.resolve({}) })).toMatchObject({ robots: { index: true } });
  for (const params of [{ class: "HUNTER" }, { page: "2" }, { sort: "level" }, { q: "" }]) {
    expect(await searchMetadata({ searchParams: Promise.resolve(params) })).toMatchObject({ robots: { index: false } });
  }
});

describe("player directory", () => {
  beforeEach(() => { on(); vi.stubEnv("EVERLOOT_ARMORY", "1"); });
  const page = async (params: Record<string, string | string[]> = {}) => {
    const { default: Players } = await import("./page");
    return renderToStaticMarkup(await Players({ searchParams: Promise.resolve(params) }));
  };

  test("without a name lists profiles by gear, with gear columns and hide forms", async () => {
    armory.putCharacter(armoryCharacter());
    armory.putCharacter(armoryCharacter({ slug: "arla-quill", name: "Arla", surname: "Quill", gearScore: 1 }));
    const seen = vi.spyOn(holder.store!, "search");
    const html = await page();
    expect(html.indexOf('href="/armory/eu/velkara-duskmantle"')).toBeLessThan(html.indexOf('href="/armory/eu/arla-quill"'));
    for (const text of ["2 Blizzard profiles", "Gear score", "Item level", "Last read", "61.2", "57.41", "/armory/hide?region=eu", "/players/opt-out", "Blizzard profile hide form"]) expect(html).toContain(text);
    for (const name of ["q", "class", "race", "faction", "region", "ruleset", "min", "max", "guild", "sort"]) expect(html).toContain(`name="${name}"`);
    expect(seen).not.toHaveBeenCalled();
  });

  test("parses filters for the store and keeps all of them in paging links", async () => {
    const directory = vi.spyOn(armory, "directory").mockResolvedValue({ rows: [armoryCharacter()], total: 60 });
    const html = await page({ q: ["Vel", "other"], class: "HUNTER", race: "Troll", faction: "Horde", region: "eu", ruleset: "2", min: "40", max: "60", guild: "Ember", sort: "item-level", page: "2" });
    expect(directory).toHaveBeenCalledWith(expect.objectContaining({ prefix: "vel", class: "Hunter", race: "Troll", faction: "Horde", region: "eu", rulesetId: 2, minLevel: 40, maxLevel: 60, guildPrefix: "Ember", sort: "item_level", limit: 25, offset: 25 }));
    expect(html).toContain("Previous");
    expect(html).toContain("Next");
    expect(html).toContain("60 Blizzard profiles");
    expect(html).toContain("guild=Ember&amp;sort=item-level&amp;page=3");
    expect(html).toContain("class=HUNTER&amp;race=Troll&amp;faction=Horde&amp;region=eu&amp;ruleset=2&amp;min=40&amp;max=60");
    // Submitting filters resets the page because the form has no page control.
    expect(html).not.toContain('name="page"');
  });

  test("pages 25 profiles at a time and a page beyond the end keeps Previous and total", async () => {
    for (let i = 0; i < 26; i++) armory.putCharacter(armoryCharacter({ slug: `quill-${i}`, gearScore: i }));
    const first = await page();
    expect(first.match(/href="\/armory\/eu\/quill-/g)).toHaveLength(25);
    expect(first).toContain("Next");
    const last = await page({ page: "2" });
    expect(last.match(/href="\/armory\/eu\/quill-/g)).toHaveLength(1);
    expect(last).toContain("Previous");
    expect(last).not.toContain(">Next<");
    const past = await page({ page: "3" });
    expect(past).toContain("26 Blizzard profiles");
    expect(past).toContain("No profiles on this page");
    expect(past).toContain("Previous");
  });

  test("one letter filters Blizzard profiles; no addon request until two letters", async () => {
    armory.putCharacter(armoryCharacter());
    const search = vi.spyOn(holder.store!, "search");
    expect(await page({ q: "v" })).toContain('href="/armory/eu/velkara-duskmantle"');
    expect(search).not.toHaveBeenCalled();
  });

  test("missing migration keeps name search, and storage failure is reported even with no name", async () => {
    armory.putCharacter(armoryCharacter());
    const directory = vi.spyOn(armory, "directory").mockResolvedValue(null);
    const html = await page({ q: "vel" });
    expect(html).toContain("once the database update is applied");
    expect(html).toContain('href="/armory/eu/velkara-duskmantle"');
    directory.mockRejectedValue(new Error("down"));
    const down = await page();
    expect(down).toContain(STORAGE_UNREACHABLE);
    expect(down).not.toContain("once the database update is applied");
  });
});

test("search finds a name prefix, links each result and offers to hide it", async () => {
  on();
  const { default: Search } = await import("./page");
  const html = renderToStaticMarkup(await Search({ searchParams: Promise.resolve({ q: "thr" }) }));
  expect(html).toContain('href="/characters/forever/forever-pioneer/thrallina"');
  expect(html).toContain("Level 24 Undead Shaman");
  expect(html).toContain("/players/opt-out?realm=Forever%20Pioneer");
  expect(html).toContain('action="/players"');
  expect(html).toContain('role="search"');
  expect(html).toMatch(/text-class-shaman">Shaman</);
  expect(html).toContain("Night Watch");
  expect(html.match(/<table /g)).toHaveLength(1);
});

test("a one-letter or malformed search never reaches the store", async () => {
  on();
  const search = vi.spyOn(holder.store!, "search");
  const { default: Search } = await import("./page");
  for (const q of ["t", "th%", "a b", "x1"]) {
    const html = renderToStaticMarkup(await Search({ searchParams: Promise.resolve({ q }) }));
    expect(html).toContain("Type 2 to 12 letters");
  }
  expect(search).not.toHaveBeenCalled();
});

test("the hide form posts without JavaScript and fills in the character from the link", async () => {
  on();
  const { default: OptOut } = await import("./opt-out/page");
  const html = renderToStaticMarkup(await OptOut({ searchParams: Promise.resolve({ name: "Thrallina", realm: "Forever Pioneer" }) }));
  expect(html).toContain('action="/api/players/opt-out"');
  expect(html).toContain('method="post"');
  expect(html).toContain('value="Thrallina"');
  expect(html).toContain("do not need an account");
});

describe("one list from the addon and the armory", () => {
  const search = async (q: string) => {
    const { default: Search } = await import("./page");
    return renderToStaticMarkup(await Search({ searchParams: Promise.resolve({ q }) }));
  };
  const both = () => { on(); vi.stubEnv("EVERLOOT_ARMORY", "1"); };

  test("each row says where it came from, and a character in both is one row linking the Blizzard profile", async () => {
    both();
    // An invented character the addon saw on an EU realm and the armory read in the EU, both in one guild.
    await holder.store!.upsert([{ name: "Velkara", realm: "EU1 Realm 2 Normal", race: "Troll", class: "HUNTER", level: 58, guild: "Ember Wardens", seen: "2026-11-08" }]);
    armory.putCharacter(armoryCharacter());
    armory.putCharacter(armoryCharacter({ slug: "thrandor-vale", name: "Thrandor", surname: "Vale", guildName: null, guildSlug: null }));
    const joined = await search("vel");
    expect(joined.match(/href="\/armory\/eu\/velkara-duskmantle"/g)).toHaveLength(1);
    expect(joined).not.toContain('href="/characters/forever/eu1-realm-2-normal/velkara"');
    expect(joined).toContain("Seen by the addon");
    expect(joined).toContain("Blizzard profile");
    expect(joined).toContain("2026-11-08");
    expect(joined).toContain("1 character matching");
    // Two sources, two characters: each row its own page and chip.
    const apart = await search("thr");
    expect(apart).toContain('href="/characters/forever/forever-pioneer/thrallina"');
    expect(apart).toContain('href="/armory/eu/thrandor-vale"');
    expect(apart).toContain("2 characters matching");
    expect(apart.match(/role="search"/g)).toHaveLength(1);
  });

  test("the armory's search rules carry over: a surname, a full name and accents find the character", async () => {
    vi.stubEnv("EVERLOOT_ARMORY", "1");
    armory.putCharacter(armoryCharacter());
    for (const q of ["dusk", "Velkara Duskmantle", " velkara  dusk "]) expect(await search(q)).toContain('href="/armory/eu/velkara-duskmantle"');
    armory.putCharacter(armoryCharacter({ slug: "élodie-brún", name: "Élodie", surname: "Brún" }));
    expect(await search("Élo")).toContain('href="/armory/eu/%C3%A9lodie-br%C3%BAn"');
    expect(await search("v1")).toContain("Type 1 to 24 letters");
  });

  test("with only the armory on the page answers, and the addon's store is never asked", async () => {
    vi.stubEnv("EVERLOOT_ARMORY", "1");
    const players = vi.spyOn(holder.store!, "search");
    armory.putCharacter(armoryCharacter());
    const html = await search("vel");
    expect(html).toContain('href="/armory/eu/velkara-duskmantle"');
    expect(html).not.toContain("Seen by the addon<");
    expect(players).not.toHaveBeenCalled();
  });

  test("a hidden armory character is not listed", async () => {
    both();
    armory.putCharacter(armoryCharacter());
    await armory.hide("eu", "velkara-duskmantle");
    expect(await search("velkara")).not.toContain("/armory/eu/velkara-duskmantle");
  });

  test("a full name the armory has not read links the site search, which asks Blizzard for it, instead of asking here", async () => {
    both();
    const lookups = vi.spyOn(armory, "lookupRegions");
    const html = await search("Morwen Ashgrove");
    expect(html).toContain('href="/search?q=Morwen%20Ashgrove"');
    expect(lookups).not.toHaveBeenCalled();
    // One word is a prefix, not a name Blizzard could be asked for.
    expect(await search("Morwen")).not.toContain("/search?q=");
  });

  test("a store out of reach says so; the other source still answers", async () => {
    both();
    holder.armory = new Proxy({} as ArmoryStore, { get: () => async () => { throw new Error("down"); } });
    const html = await search("thr");
    expect(html).toContain(STORAGE_UNREACHABLE);
    expect(html).toContain('href="/characters/forever/forever-pioneer/thrallina"');
  });
});
