import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { HomeFact } from "@/lib/home-live";
import type { SiteAssets } from "@/lib/game-assets";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus, loadCompletion: async () => ({ state: null, dataAsOf: null, unreachable: true }) },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/cache", () => ({ unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn, revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// A hub a later lane might add, with no count of its own.
vi.mock("@/lib/database-hubs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/database-hubs")>();
  return { ...real, DATABASE_HUBS: [...real.DATABASE_HUBS, { href: "/database/example", label: "Example hub", source: "players" as const }] };
});
const live = vi.hoisted(() => ({ newest: [] as HomeFact[] | null, assets: null as SiteAssets | null }));
vi.mock("@/lib/home-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/home-live")>()),
  loadHomeNewest: async () => live.newest,
}));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => live.assets,
}));

const quests = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/world-lists", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/world-lists")>();
  return { ...real, publicQuests: (facts: Parameters<typeof real.publicQuests>[0]) => (quests.count ? Array.from({ length: quests.count }, () => ({})) : real.publicQuests(facts)) };
});

import { DATABASE_HUBS } from "@/lib/database-hubs";
import { DATABASE_GROUPS } from "@/lib/database-home";
import { instanceRows } from "@/lib/instances";
import { CLIENT_LAYER } from "@kb/client-layer-file";
import DatabasePage from "./(hub)/page";

beforeEach(() => {
  store.loadCorpus.mockReset();
  store.loadCorpus.mockResolvedValue({ uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z", records: [] });
  live.newest = [];
  live.assets = null;
  quests.count = 0;
});

const render = async () => renderToStaticMarkup(await DatabasePage());

/** The markup inside the page's link to `href`. */
const row = (page: string, href: string) => new RegExp(`<a href="${href}"[^>]*>(.*?)</a>`).exec(page)?.[1];

/** The markup of the section opened by the h2 `heading`, up to its close. */
const section = (page: string, heading: string) => {
  const h = page.search(new RegExp(`<h2[^>]*>${heading}</h2>`));
  expect(h, heading).toBeGreaterThan(-1);
  const start = page.lastIndexOf("<section", h);
  return page.slice(start, page.indexOf("</section>", h));
};

test("the page has one H1, Database, ahead of the search and the grid", async () => {
  const page = await render();
  expect(page.match(/<h1[ >]/g)).toHaveLength(1);
  expect(/<h1[^>]*>Database<\/h1>/.test(page)).toBe(true);
  expect(page.indexOf("<h1")).toBeLessThan(page.indexOf('id="database-search"'));
  expect(page.indexOf('id="database-search"')).toBeLessThan(page.search(/<h2[^>]*>World<\/h2>/));
});

test("the meta line names the game build the files were read from, and the data-as-of line", async () => {
  const page = await render();
  const meta = /<header data-page-header[^>]*>.*?<\/header>/.exec(page)?.[0] ?? "";
  expect(meta).toContain(`game build ${CLIENT_LAYER.build.version}`);
  expect(meta).toContain("last upload");
});

test("the entity types sit in three groups, World, Items and gear, Character, each card with its one-line note", async () => {
  const page = await render();
  const want = {
    World: ["zones", "instances", "bosses", "npcs", "objects", "vendors", "quests"],
    "Items and gear": ["items", "item-sets", "mounts", "pets", "toys", "currencies"],
    Character: ["spells", "achievements", "titles", "factions", "holidays", "pet-families"],
  };
  for (const [heading, hrefs] of Object.entries(want)) {
    const s = section(page, heading);
    for (const h of hrefs) expect(s, `${heading} ${h}`).toContain(`<a href="/database/${h}"`);
  }
  const character = section(page, "Character");
  expect(character).toContain('<a href="/classes"');
  expect(character).toContain('<a href="/tools/talents"');
  for (const g of DATABASE_GROUPS) for (const c of g.cards) expect(row(page, c.href), c.href).toContain(c.note.replaceAll("'", "&#x27;"));
});

test("each card keeps its count from the same source: instances from the game files, the players' lists with the empty meter", async () => {
  const page = await render();
  expect(row(page, "/database/instances")).toMatch(new RegExp(`>${instanceRows().size} in game files<`));
  expect(row(page, "/database/npcs")).toContain('data-agreement="0"');
});

test("a card whose list counts more than the card says what its number counts: quests confirmed, instances in the files", async () => {
  quests.count = 543;
  const page = await render();
  // The quest list also lists the quests only the game files or the wiki title; the card counts the confirmed ones.
  expect(row(page, "/database/quests")).toMatch(/>543 confirmed</);
  // The instance list adds the ones only players saw; the card counts the files' entrances.
  expect(row(page, "/database/instances")).toMatch(new RegExp(`>${instanceRows().size} in game files<`));
});

test("with storage down the instance card is still counted from the game files, never as zero", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const page = await render();
  expect(row(page, "/database/instances")).toContain(`>${instanceRows().size} in game files<`);
});

test("every hub in the list is linked: a hub no card names sits under More lists with its label", async () => {
  const page = await render();
  for (const hub of DATABASE_HUBS) expect(page, hub.href).toContain(`<a href="${hub.href}"`);
  const more = section(page, "More lists");
  for (const href of ["/database/quest-chains", "/database/terrain", "/database/drops", "/database/coverage", "/database/download", "/database/example"]) {
    const label = DATABASE_HUBS.find((h) => h.href === href)!.label;
    expect(more, href).toContain(label);
  }
  expect(page).not.toContain('href="/tools/guild-board"');
});

test("a hub with no count of its own is linked without one, not with a blank or a zero", async () => {
  const page = await render();
  expect(row(page, "/database/example")).toBe('<span class="min-w-0 truncate">Example hub</span>');
});

test("each card draws its icon from the asset manifest, and none when the manifest lacks it", async () => {
  live.assets = {
    poi: new Map([["dungeon", "https://assets.test/poi/Dungeon.webp"]]),
    professions: new Map(), petIcons: new Map([[40, "https://assets.test/icons/2.webp"], [39, "https://assets.test/icons/1.webp"]]),
    currencyIcons: new Map(), spellIcons: new Map(), achievementIcons: new Map(), familyIcons: new Map(),
    classes: new Map(), races: new Map(), factions: new Map(),
  } as unknown as SiteAssets;
  const page = await render();
  expect(row(page, "/database/instances")).toContain('src="https://assets.test/poi/Dungeon.webp"');
  expect(row(page, "/database/pets")).toContain('src="https://assets.test/icons/1.webp"');
  expect(row(page, "/database/zones")).not.toContain("<img");
});

test("Recently confirmed shows the newest public facts with a link to all of them", async () => {
  live.newest = [{ kind: "npc", id: 448, name: "Hogger", path: "/database/npcs/448", publicAt: "2026-11-24T10:00:00.000Z" }];
  const page = await render();
  const strip = section(page, "Recently confirmed");
  expect(strip).toContain('<a href="/database/npcs/448">Hogger</a>');
  expect(strip).toContain('<a href="/database/recent">');
  live.newest = null;
  expect(section(await render(), "Recently confirmed")).toContain("could not be read just now");
});

test("a class whose only subclass repeats its own name lists no subclass under it", async () => {
  const page = await render();
  expect(page).toContain('<a href="/database/items/quest"');
  expect(page).not.toContain('<a href="/database/items/quest/quest"');
});

test("each item class is one line with its count; its types wait behind a closed Disclosure", async () => {
  const page = await render();
  const start = page.indexOf('<a href="/database/items/armor">Armor</a>');
  expect(start).toBeGreaterThan(-1);
  const armor = page.slice(start, page.indexOf("</section>", start));
  expect(armor).toMatch(/^<a href="\/database\/items\/armor">Armor<\/a><span[^>]*>[\d,]+<\/span><\/h3>/);
  expect(armor).toContain("<details data-disclosure");
  expect(armor).not.toMatch(/<details[^>]* open/);
  expect(armor).toMatch(/<h3[^>]*>[^<]*Cloth[^<]* and \d+ more<\/h3>/);
  expect(armor).toContain('<a href="/database/items/armor/cloth"');
});

test("before launch the World group says when recording starts; after launch it says a row fills at 3 installs, with the addon link", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, dataAsOf: null, records: [] });
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    expect(section(await render(), "World")).toContain("The addon starts recording when the game launches on November 4, 2026.");
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    const after = section(await render(), "World");
    expect(after).not.toContain("The addon starts recording");
    expect(after).toContain("3 installs agree");
    expect(after).toContain('<a href="/addon"');
  } finally {
    vi.useRealTimers();
  }
});
