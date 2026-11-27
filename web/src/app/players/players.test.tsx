import { readFileSync } from "node:fs";
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
const assets = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/game-assets")>()), loadSiteAssets: async () => assets.value }));

const player = { name: "Thrallina", realm: "Forever Pioneer", race: "Scourge", class: "SHAMAN", level: 24, guild: "Night Watch", seen: "2026-10-20" };

let armory: MemoryArmoryStore;
beforeEach(async () => {
  holder.store = createMemoryPlayerStore();
  await holder.store.upsert([player]);
  armory = createMemoryArmoryStore(() => new Date("2026-11-10T00:00:00Z"));
  holder.armory = armory;
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); assets.value = null; });

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

  test("without a name lists profiles by gear: names in class colour, guild and sort links, menus in the URL", async () => {
    armory.putCharacter(armoryCharacter());
    armory.putCharacter(armoryCharacter({ slug: "arla-quill", name: "Arla", surname: "Quill", gearScore: 1, class: "Mage", race: "Gnome", guildName: null }));
    const seen = vi.spyOn(holder.store!, "search");
    const html = await page();
    const table = html.slice(html.indexOf('id="player-results"'));
    expect(table.indexOf('href="/armory/eu/velkara-duskmantle"')).toBeLessThan(table.indexOf('href="/armory/eu/arla-quill"'));
    expect(table).toMatch(/href="\/armory\/eu\/velkara-duskmantle" class="[^"]*text-class-hunter/);
    expect(table).toMatch(/href="\/armory\/eu\/arla-quill" class="[^"]*text-class-mage/);
    for (const text of ["Blizzard profiles", "Gear score", "Item level", "Last read", "61.2", "57.41", "Troll Hunter", "/armory/hide?region=eu", "/players/opt-out", "Blizzard profile hide form"]) expect(html).toContain(text);
    // The guild cell lists that guild's members here; the sorted column says so and every other header is a sort link.
    expect(table).toContain('href="/players?guild=Ember+Wardens"');
    expect(table).toContain('aria-sort="descending"');
    for (const sort of ["name", "level", "item-level", "last-read"]) expect(table).toContain(`href="/players?sort=${sort}"`);
    for (const key of ["class", "race", "faction", "region", "ruleset", "level", "sort"]) expect(html).toContain(`data-filter="${key}"`);
    expect(html).toContain('href="/players?class=HUNTER"');
    expect(html).toContain('href="/players?min=60&amp;max=60"');
    for (const name of ["q", "guild"]) expect(html).toContain(`name="${name}"`);
    expect(seen).not.toHaveBeenCalled();
  });

  test("a row reads like a tracker's: class icon and colour on the name, race on its own, region as a chip, one short class per row", async () => {
    assets.value = { classes: new Map([["hunter", { name: "Hunter", icon: "https://assets.test/icons/hunter.webp" }], ["mage", { name: "Mage", icon: "https://bad.test/x.webp)}</style><script>" }]]), professions: new Map() };
    armory.putCharacter(armoryCharacter());
    armory.putCharacter(armoryCharacter({ slug: "arla-quill", name: "Arla", surname: "Quill", gearScore: 1, class: "Mage", race: "Gnome" }));
    const html = await page();
    const table = html.slice(html.indexOf('id="player-results"'));
    // One rule per class in one style block; a URL that could break out of it is left out, and that class draws no icon.
    expect(html).toContain('.ci-hunter{background-image:url("https://assets.test/icons/hunter.webp")}');
    expect(html).not.toContain("bad.test");
    expect(table).toContain('<i class="ci ci-hunter" role="img" aria-label="Hunter" title="Hunter"></i><a href="/armory/eu/velkara-duskmantle" class="text-class-hunter dir-name">');
    expect(table).toMatch(/<a href="\/armory\/eu\/arla-quill" class="text-class-mage dir-name">/);
    expect(table).not.toContain("ci-mage");
    // The hide link sits after the name with a dot between them (it read "Velkara Duskmantle Hide", as if part of the
    // name). The dot is the link class's, in globals.css, so a row's markup stays as light as before.
    expect(table).toMatch(/dir-name">Velkara Duskmantle<\/a> <a href="\/armory\/hide\?[^"]*" class="dir-hide">Hide<\/a>/);
    expect(readFileSync(new URL("../globals.css", import.meta.url), "utf8")).toMatch(/\.dir-hide::before \{\s*content: "·";/);
    // Race is its own column; the class is the colour and the icon, and the phone line still says it in words.
    expect(table).toMatch(/<th[^>]*><span[^>]*>Race<\/span><\/th>/);
    expect(table).toMatch(/<td class="dt-td dt-nowrap dt-fold">Troll<\/td>/);
    expect(table).toContain("Level 60 Troll Hunter");
    expect(table).toContain('data-region="eu"');
    expect(table).toContain('<tr class="dt-tr">');
    expect(table).toContain('class="dt-meta"');
  });

  test("a full page of 50 profiles stays light: under 820 bytes of markup a row (1,059 before; 780 before the Class column)", async () => {
    for (let i = 0; i < 50; i++) armory.putCharacter(armoryCharacter({ slug: `quill-${i}`, name: "Quill", surname: `Venn${i}`, gearScore: i }));
    const html = await page({ sort: "level" });
    const body = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
    expect(body.match(/<tr /g)).toHaveLength(50);
    expect(body.length / 50).toBeLessThan(820);
  });

  test("QA round 2: Region and Class columns, a dash for an empty item level and gear score, and a note on Gear Score", async () => {
    armory.putCharacter(armoryCharacter());
    armory.putCharacter(armoryCharacter({ slug: "arla-quill", name: "Arla", surname: "Quill", level: 1, itemLevel: 0, gearScore: 0, class: "Mage", race: "Gnome" }));
    const html = await page();
    const table = html.slice(html.indexOf('id="player-results"'));
    expect(table).toMatch(/<th[^>]*><span[^>]*>Region<\/span><\/th>/);
    expect(table).not.toMatch(/>Realm<\/span><\/th>/);
    expect(table).toMatch(/<th[^>]*><span[^>]*>Class<\/span><\/th>/);
    expect(table).toMatch(/<td class="dt-td dt-nowrap dt-fold">Mage<\/td>/);
    const arla = table.slice(table.indexOf("arla-quill"), table.indexOf("</tr>", table.indexOf("arla-quill")));
    expect(arla.match(/<td class="dt-td dt-num dt-fold">—<\/td>/g)).toHaveLength(2);
    expect(arla).not.toContain("GS 0");
    expect(arla).not.toContain("ilvl 0");
    // QA round 4: the number is Everloot's own, not the GearScore addon's.
    expect(html).toContain("Gear Score here is Everloot&#x27;s, not the GearScore addon&#x27;s number.");
  });

  test("QA round 7: an item level and Gear Score that read the same are said once, and a hint above the list says why they match", async () => {
    armory.putCharacter(armoryCharacter());
    armory.putCharacter(armoryCharacter({ slug: "arla-quill", name: "Arla", surname: "Quill", itemLevel: 62, gearScore: 62 }));
    const html = await page();
    const table = html.slice(html.indexOf('id="player-results"'));
    const arla = table.slice(table.indexOf("arla-quill"), table.indexOf("</tr>", table.indexOf("arla-quill")));
    // QA round 8: the phrase never breaks across lines on a phone.
    expect(arla).toContain("ilvl and GS 62");
    expect(arla).not.toContain("GS 62 · ilvl 62");
    const velkara = table.slice(table.indexOf("velkara-duskmantle"), table.indexOf("</tr>", table.indexOf("velkara-duskmantle")));
    expect(velkara).toContain("ilvl 57.41 · GS 61.2");
    // Above the table, where the two columns first show, not under 50 rows.
    const hint = table.indexOf("weighs the same item levels by slot");
    expect(hint).toBeGreaterThan(0);
    expect(hint).toBeLessThan(table.indexOf("<table"));
  });

  test("the sort menu names the chosen order once", async () => {
    const menu = (html: string) => html.slice(html.indexOf('data-filter="sort"'), html.indexOf("</summary>", html.indexOf('data-filter="sort"')));
    const chosen = menu(await page({ sort: "level" }));
    expect(chosen).toMatch(/>Sort(?:<!-- -->)?: (?:<!-- -->)?<span class="text-fg">Level<\/span>/);
    expect(chosen).not.toContain("Level: ");
    expect(menu(await page())).toMatch(/>Sort: Gear score/);
  });

  test("parses filters for the store and keeps all of them in paging and menu links", async () => {
    const directory = vi.spyOn(armory, "directory").mockResolvedValue({ rows: [armoryCharacter()], total: 160 });
    const html = await page({ q: ["Vel", "other"], class: "HUNTER", race: "Troll", faction: "Horde", region: "eu", ruleset: "2", min: "40", max: "60", guild: "Ember", sort: "item-level", page: "2" });
    expect(directory).toHaveBeenCalledWith(expect.objectContaining({ prefix: "vel", class: "Hunter", race: "Troll", faction: "Horde", region: "eu", rulesetId: 2, minLevel: 40, maxLevel: 60, guildPrefix: "Ember", sort: "item_level", limit: 50, offset: 50 }));
    // The numbered pager: back to page 1 (no page in the address) and on to page 3, every filter kept.
    expect(html).toMatch(/<a href="\/players\?q=Vel&amp;[^"]*sort=item-level"[^>]*>‹<\/a>/);
    expect(html).toMatch(/<a href="\/players\?q=Vel&amp;[^"]*sort=item-level&amp;page=3"[^>]*>›<\/a>/);
    expect(html).toContain(">160<");
    expect(html).toContain("guild=Ember&amp;sort=item-level&amp;page=3");
    expect(html).toContain("class=HUNTER&amp;race=Troll&amp;faction=Horde&amp;region=eu&amp;ruleset=2&amp;min=40&amp;max=60");
    // A custom range is its own choice in the level menu; the name and guild boxes keep the menu filters.
    expect(html).toContain("40–60");
    expect(html).toContain('type="hidden" name="class" value="HUNTER"');
    expect(html).toContain("Clear filters");
    // Searching resets the page because the form has no page field.
    expect(html).not.toContain('name="page"');
  });

  test("pages 50 profiles at a time by default, 25 or 100 from ?per=, and a page beyond the end keeps the total", async () => {
    for (let i = 0; i < 51; i++) armory.putCharacter(armoryCharacter({ slug: `quill-${i}`, gearScore: i }));
    const rows = (html: string) => html.slice(html.indexOf('id="player-results"'), html.indexOf('id="players-recent"') >>> 0).match(/href="\/armory\/eu\/quill-[^"]*" class/g) ?? [];
    const first = await page();
    expect(rows(first)).toHaveLength(50);
    expect(first).toMatch(/<a href="\/players\?page=2"[^>]*>›<\/a>/);
    expect(first).toContain('href="/players?per=100"');
    expect(rows(await page({ page: "2" }))).toHaveLength(1);
    expect(rows(await page({ per: "25" }))).toHaveLength(25);
    const past = await page({ page: "3" });
    expect(past).toContain(">51<");
    expect(past).toContain("No profiles on this page");
  });

  test("with no name or filter the page offers the latest reads and the best item level of each class, linking the boards", async () => {
    armory.putCharacter(armoryCharacter());
    armory.putCharacter(armoryCharacter({ slug: "arla-quill", name: "Arla", surname: "Quill", class: "Mage", itemLevel: 50, fetchedAt: "2026-11-09T12:00:00.000Z" }));
    armory.putCharacter(armoryCharacter({ slug: "brin-mire", name: "Brin", surname: "Mire", class: "Mage", itemLevel: 40, fetchedAt: "2026-11-09T11:00:00.000Z" }));
    armory.putCharacter(armoryCharacter({ slug: "hidden-one", name: "Hidda", surname: "One", class: "Warrior", itemLevel: 99, fetchedAt: "2026-11-09T13:00:00.000Z" }));
    await armory.hide("eu", "hidden-one");
    const html = await page();
    const recent = html.slice(html.indexOf('id="players-recent"'), html.indexOf('id="players-best"'));
    expect(recent.indexOf("/armory/eu/arla-quill")).toBeLessThan(recent.indexOf("/armory/eu/brin-mire"));
    expect(recent.indexOf("/armory/eu/brin-mire")).toBeLessThan(recent.indexOf("/armory/eu/velkara-duskmantle"));
    const best = html.slice(html.indexOf('id="players-best"'));
    expect(best).toContain('href="/armory/eu/arla-quill"');
    expect(best).not.toContain("/armory/eu/brin-mire");
    expect(best).toContain('href="/armory/rankings/item-level?class=mage"');
    expect(best).toContain('href="/armory/rankings/item-level"');
    expect(html).not.toContain("hidden-one");
    expect(html).not.toContain("Hidda");
    // A name or a filter narrows the page to the list.
    for (const params of [{ q: "vel" }, { class: "MAGE" }, { page: "2" }] as Record<string, string>[]) {
      const narrowed = await page(params);
      expect(narrowed).not.toContain('id="players-recent"');
      expect(narrowed).not.toContain('id="players-best"');
    }
  });

  // A screen reader's landmark list names each region; the results table's scroll box is the region named for the
  // list, so the section around it must not take the same name.
  test("the results' regions each have a name of their own", async () => {
    armory.putCharacter(armoryCharacter());
    const html = await page();
    const ids = new Map([...html.matchAll(/<h2 id="([^"]+)"[^>]*>(.*?)<\/h2>/g)].map((m) => [m[1], m[2]]));
    const names = [
      ...[...html.matchAll(/<section aria-labelledby="([^"]+)"/g)].map((m) => ids.get(m[1])),
      ...[...html.matchAll(/role="region" aria-label="([^"]+)"/g)].map((m) => m[1]),
    ];
    expect(names).toContain("Blizzard profiles");
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  test("an empty answer says why and offers the one thing to do", async () => {
    const none = await page({ class: "MAGE" });
    expect(none).toContain("No character matches these filters yet.");
    expect(none).toContain("data-empty-state");
    expect(none).toContain('href="/players"');
    const empty = await page();
    expect(empty).toContain("No Blizzard profile has been read yet.");
    expect(empty).toContain('href="/armory/submit"');
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
  expect(html).toMatch(/text-class-shaman[^"]*">Thrallina</);
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

describe("QA round 1: the directory's races, labels and phone line", () => {
  beforeEach(() => { on(); vi.stubEnv("EVERLOOT_ARMORY", "1"); });
  const page = async (params: Record<string, string> = {}) => {
    const { default: Players } = await import("./page");
    return renderToStaticMarkup(await Players({ searchParams: Promise.resolve(params) }));
  };
  const results = (html: string) => html.slice(html.indexOf('id="player-results"'), html.indexOf('id="players-recent"') >>> 0);

  test("the race menu offers the two Skyborne races as Blizzard stores them, and each filter finds its characters", async () => {
    armory.putCharacter(armoryCharacter({ slug: "gang-jubaster", name: "Gang", surname: "Jubaster", race: "Windshaper Skyborne", raceId: 96, class: "Rogue" }));
    armory.putCharacter(armoryCharacter({ slug: "sora-vel", name: "Sora", surname: "Vel", race: "High Order Skyborne", raceId: 95, class: "Mage", faction: "Alliance" }));
    const html = await page();
    expect(html).toContain('href="/players?race=Windshaper+Skyborne"');
    expect(html).toContain('href="/players?race=High+Order+Skyborne"');
    expect(html).not.toContain('href="/players?race=Skyborne"');
    const horde = results(await page({ race: "Windshaper Skyborne" }));
    expect(horde).toContain('href="/armory/eu/gang-jubaster"');
    expect(horde).not.toContain("sora-vel");
    expect(results(await page({ race: "high order skyborne" }))).toContain('href="/armory/eu/sora-vel"');
  });

  test("a disbanded guild, no guild and unread gear say so in words", async () => {
    armory.putCharacter(armoryCharacter({ slug: "old-oath", name: "Old", surname: "Oath", guildName: "DELETED", guildSlug: null }));
    armory.putCharacter(armoryCharacter({ slug: "lone-wolf", name: "Lone", surname: "Wolf", guildName: null, guildSlug: null, itemLevel: null, gearScore: null }));
    const html = results(await page());
    expect(html).toContain("Guild disbanded");
    expect(html).not.toContain(">DELETED<");
    expect(html).toContain("No guild");
    expect(html).not.toContain("None seen");
    expect(html).toContain("Gear not read yet");
    expect(html).not.toContain(">Not read<");
  });

  test("the phone line names the guild too", async () => {
    armory.putCharacter(armoryCharacter());
    expect(results(await page())).toMatch(/class="dt-meta">[^<]*Ember Wardens/);
  });
});
