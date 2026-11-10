import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { buildLoreRelease } from "@/test/lore-release";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

let release = "";
beforeAll(async () => { release = await buildLoreRelease(); });
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.restoreAllMocks(); namesRead.pending = null; siteSearch.names = undefined; });

const siteSearch = vi.hoisted(() => ({ groups: [] as unknown[], names: undefined as unknown }));
const namesRead = vi.hoisted(() => ({ pending: null as Promise<unknown> | null }));
vi.mock("@/lib/site-search", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/site-search")>()), siteSearch: async (_q: string, options: { names?: unknown }) => { siteSearch.names = options.names; await options.names; return siteSearch.groups; } }));
vi.mock("@/lib/shown-item-names", () => ({ loadShownNames: async () => ({
  facts: { rates: [], names: [], npcs: [], unreachable: false }, agreed: new Map(), matched: null,
  named: { has: () => false }, showsTip: () => false,
}) }));
vi.mock("@/lib/shown-search-names", () => ({ loadShownSearchNames: () => namesRead.pending ?? Promise.resolve({ items: new Map(), npcs: new Map(), quests: new Map() }) }));
const icons = vi.hoisted(() => ({ asked: [] as number[][], map: new Map<number, string>() }));
vi.mock("@/lib/item-icons", () => ({ shownItemIcons: async (ids: number[]) => { icons.asked.push(ids); return icons.map; } }));
// The Characters and Guilds groups load in the browser; here a marker shows where they would sit, and the fallback.
vi.mock("./PeopleResults", () => ({ default: ({ q, empty }: { q: string; empty?: ReactNode }) => <div data-people={q}>{empty}</div> }));

async function render(query: Record<string, string>, path = release) {
  vi.stubEnv("KB_SNAPSHOT_PATH", path);
  const { default: SearchPage } = await import("./page");
  return renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve(query) }));
}

/** The full lore list, which `in=lore` opens from the overview's lore group. */
const renderLore = (query: Record<string, string>, path = release) => render({ in: "lore", ...query }, path);

test("the page starts search without waiting for its independent name loader", async () => {
  let finish!: (value: unknown) => void;
  namesRead.pending = new Promise((resolve) => { finish = resolve; });
  const { default: SearchPage } = await import("./page");
  const answer = SearchPage({ searchParams: Promise.resolve({ q: "Linen Cloth" }) });
  await Promise.resolve();
  const passedPendingNames = siteSearch.names === namesRead.pending;
  finish({ items: new Map(), npcs: new Map(), quests: new Map(), objects: new Map() });
  await answer;
  expect(passedPendingNames).toBe(true);
});

test("without a query it shows the form and no results", async () => {
  const html = await render({});
  expect(html).toContain('name="q"');
  expect(html).toContain('action="/search"');
  expect(html).not.toContain("data-entry-list");
  expect(html).not.toContain('href="/lore/');
  expect(html).toContain("Search Everloot");
});

test("without a query it says what a search finds, with each list and four queries to try; a query replaces that with its results", async () => {
  const html = await render({});
  expect(html).toContain('id="search-start"');
  expect(html).toContain("What you can search");
  // Every kind links its own list, by the name the result groups use.
  for (const [kind, href] of [["Items", "/database/items"], ["NPCs", "/database/npcs"], ["Quests", "/database/quests"], ["Zones", "/database/zones"], ["Objects", "/database/objects"], ["Lore archive", "/lore"], ["Tools", "/tools"], ["Docs", "/docs"]]) {
    expect(html, kind).toContain(`href="${href}"`);
    expect(html, kind).toContain(`>${kind}</a>`);
  }
  // The examples are the lookups /chat opens with and the field's own placeholder, each a search.
  for (const q of ["Linen Cloth", "Thrall", "Elwynn Forest", "6948"]) expect(html, q).toContain(`href="/search?q=${encodeURIComponent(q)}"`);
  expect(html).toContain('placeholder="A name or an id: Thrall, Elwynn Forest, 6948"');
  // The hint never needs a store read: the page asked nothing of the search or the icons.
  expect(icons.asked.at(-1)).toEqual([]);

  siteSearch.groups = [{ type: "npc", heading: "NPCs", results: [{ label: "Thrall", href: "/database/npcs/1", note: "id 1", exact: true }] }];
  const found = await render({ q: "thrall" });
  expect(found).not.toContain('id="search-start"');
  expect(found).not.toContain("What you can search");
  siteSearch.groups = [];
  expect(await render({ q: "zzzz" })).not.toContain("What you can search");
});

test("a query shows the groups the site search found, each under its heading, and a link to every lore result", async () => {
  siteSearch.groups = [
    { type: "npc", heading: "NPCs", results: [{ label: "Thrall", href: "/database/npcs/1", note: "id 1", exact: true }] },
    { type: "lore", heading: "Lore archive", results: [{ label: "Thrall", href: "/lore/1-thrall", exact: true }] },
  ];
  const html = await render({ q: "thrall" });
  expect(html).toContain('id="results-npc"');
  expect(html).toContain('href="/database/npcs/1"');
  expect(html.indexOf("NPCs")).toBeLessThan(html.indexOf("Lore archive"));
  expect(html).toContain('href="/search?q=thrall&amp;in=lore"');
  siteSearch.groups = [];
  const none = await render({ q: "zzzz" });
  expect(none).toContain("Nothing matches that.");
  // An empty search points at the database lists, not the lore archive.
  expect(none).toContain('href="/database/items"');
  expect(none).not.toContain("3 installs");
});

test("item hits lead with the game icon and the quality colour, and no hit carries a plain title tooltip (the hover card says it)", async () => {
  siteSearch.groups = [
    { type: "item", heading: "Items", total: 2, results: [
      { label: "Thunderfury", href: "/database/items/19019", exact: true, id: 19019, quality: 5 },
      { label: "Thunderfury's Hilt", href: "/database/items/5", exact: false, id: 5, quality: 1 },
    ] },
    { type: "lore", heading: "Lore archive", total: 1, results: [{ label: "Thunderfury", href: "/lore/2-thunderfury", note: "A sword.", exact: true }] },
  ];
  icons.asked = [];
  icons.map = new Map([[19019, "https://assets.everloot.app/b/icons/1.webp"]]);
  const html = await render({ q: "thunderfury" });
  expect(icons.asked).toEqual([[19019, 5]]);
  expect(html).toMatch(/<img src="https:\/\/assets\.everloot\.app\/b\/icons\/1\.webp"[^>]*>(<!-- -->)?<a href="\/database\/items\/19019" class="text-q-legendary/);
  // An item without an icon uses the game's question mark and its quality border.
  expect(html).toMatch(/<img[^>]*134400\.webp[^>]*border-q-common[^>]*>(<!-- -->)?<a href="\/database\/items\/5"/);
  expect(html).toContain("border-q-legendary");
  expect(html.indexOf('id="results-item"')).toBeLessThan(html.indexOf('id="results-lore"'));
  expect(html).not.toMatch(/<a [^>]*title=/);
  icons.map = new Map();
  siteSearch.groups = [];
});

const manyResults = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Potion ${i}`, href: `/database/items/${i + 1}`, exact: false, id: i + 1, quality: 1 }));

test("a scoped search that found more than it lists says how many it shows and links to the full database list", async () => {
  siteSearch.groups = [{ type: "item", heading: "Items", total: 222, results: manyResults(50) }];
  const html = await render({ q: "potion & elixir", in: "item" });
  expect(html).toContain("Showing 50 of 222");
  expect(html).toContain('href="/database/items?q=potion%20%26%20elixir"');
  siteSearch.groups = [{ type: "quest", heading: "Quests", total: 1221, results: manyResults(50) }];
  expect(await render({ q: "the", in: "quest" })).toContain('href="/database/quests?q=the"');
  siteSearch.groups = [{ type: "npc", heading: "NPCs", total: 318, results: manyResults(50) }];
  expect(await render({ q: "cloth", in: "npc" })).toContain('href="/database/npcs?q=cloth"');
  siteSearch.groups = [];
});

test("a scoped search that lists every match, or has no database list to open, adds no footer", async () => {
  siteSearch.groups = [{ type: "item", heading: "Items", total: 3, results: manyResults(3) }];
  expect(await render({ q: "potion", in: "item" })).not.toContain("Showing");
  siteSearch.groups = [{ type: "object", heading: "Objects", total: 2, results: manyResults(1) }];
  const objects = await render({ q: "chest", in: "object" });
  expect(objects).not.toContain("Showing");
  expect(objects).not.toContain("/database/objects");
  siteSearch.groups = [];
});

test("the overview keeps its All-N link into the scoped search, not the database list", async () => {
  siteSearch.groups = [{ type: "item", heading: "Items", total: 222, results: manyResults(8) }];
  const html = await render({ q: "potion" });
  expect(html).toContain('href="/search?q=potion&amp;in=item"');
  expect(html).toContain("All 222 items");
  expect(html).not.toContain("Showing");
  expect(html).not.toContain('href="/database/items?q=');
  siteSearch.groups = [];
});

test("characters and guilds join the overview only with their switch on, never in the page's own HTML", async () => {
  siteSearch.groups = [
    { type: "npc", heading: "NPCs", total: 1, results: [{ label: "Thrall", href: "/database/npcs/1", exact: true }] },
    { type: "lore", heading: "Lore archive", total: 1, results: [{ label: "Thrall", href: "/lore/1-thrall", exact: true }] },
    { type: "tool", heading: "Tools", total: 1, results: [{ label: "Thrall tool", href: "/tools/x", exact: false }] },
  ];
  expect(await render({ q: "thrall" })).not.toContain("data-people");
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  const players = await render({ q: "thrall" });
  expect(players).toContain('data-people="thrall"');
  // After the database groups, before the lore archive and tools.
  expect(players.indexOf('id="results-npc"')).toBeLessThan(players.indexOf("data-people"));
  expect(players.indexOf("data-people")).toBeLessThan(players.indexOf('id="results-lore"'));
  vi.unstubAllEnvs();
  vi.stubEnv("EVERLOOT_GUILDS", "1");
  expect(await render({ q: "thrall" })).toContain('data-people="thrall"');
  // A scoped search lists one database type only.
  expect(await render({ q: "thrall", in: "npc" })).not.toContain("data-people");
  siteSearch.groups = [];
});

test("text that cannot start a character or guild name asks for neither", async () => {
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  // Digits are never in a character name.
  expect(await render({ q: "6948" })).not.toContain("data-people");
  vi.stubEnv("EVERLOOT_GUILDS", "1");
  expect(await render({ q: "t" })).not.toContain("data-people");
  // A guild name may be digits, but text with no letter is an id lookup.
  expect(await render({ q: "6948" })).not.toContain("data-people");
});

test("with no database match the character lookup still runs, and the empty line is its fallback", async () => {
  siteSearch.groups = [];
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  const html = await render({ q: "zuljinna" });
  expect(html).toMatch(/<div data-people="zuljinna"><p[^>]*>Nothing matches that\./);
});

test("the search is a plain GET form, so it works without JavaScript", async () => {
  const html = await render({ q: "thrall" });
  expect(html).toMatch(/<form[^>]*action="\/search"[^>]*method="get"/);
  expect(html).toContain('value="thrall"');
});

test("a query lists 20 hits linking to lore pages, with a next link", async () => {
  const html = await renderLore({ q: "grommash" });
  expect(html.match(/href="\/lore\/1\d\d-zone-\d+"/g)).toHaveLength(20);
  expect(html).toContain('href="/search?q=grommash&amp;in=lore&amp;page=2"');
  expect(html).toContain("lore · 2023");
});

test("the links this page gave out before (page=, type=) still open the lore list", async () => {
  expect((await render({ q: "grommash", page: "1" })).match(/href="\/lore\/1\d\d-zone-\d+"/g)).toHaveLength(20);
});

test("the last page has no next link; a page past the end says nothing matched", async () => {
  expect(await render({ q: "grommash", page: "2" })).not.toContain("page=3");
  const past = await render({ q: "grommash", page: "3" });
  expect(past).toContain("No more results");
  expect(past).not.toContain("No lore page matches that.");
  expect(past).toContain('href="/search?q=grommash&amp;in=lore"');
  expect(past).not.toContain("page=4");
});

test("page 0 and a non-numeric page behave as page 1", async () => {
  for (const page of ["0", "abc", "-4", "1e300"]) {
    expect(await render({ q: "grommash", page })).toContain("page=2");
  }
});

test("page numbers beyond the cap or beyond 64 bits render no hits, never a crash", async () => {
  for (const page of ["1000000000000000000", "51"]) {
    const html = await render({ q: "grommash", page });
    expect(html).toContain("No more results");
    expect(html).not.toContain("Next");
  }
});

test("no hits offers the wiki's own search for the encoded query", async () => {
  const html = await renderLore({ q: "zzzz notfound" });
  expect(html).toContain("No lore page matches that.");
  expect(html).toContain('href="https://warcraft.wiki.gg/index.php?search=zzzz%20notfound"');
});

test("the page is never indexed and canonicalises to /search", async () => {
  vi.stubEnv("KB_SNAPSHOT_PATH", release);
  const { generateMetadata } = await import("./page");
  const metadata = await generateMetadata({ searchParams: Promise.resolve({ q: "Thrall" }) });
  expect(metadata.robots).toMatchObject({ index: false, follow: true });
  expect(metadata.alternates).toMatchObject({ canonical: "/search" });
});

test("an unavailable release renders the unavailable copy", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await renderLore({ q: "thrall" }, join(tmpdir(), "missing.sqlite"))).toContain("Lore archive unavailable");
});

test("type chips filter the results and keep the query; an unknown type behaves as All", async () => {
  const zones = await render({ q: "grommash", type: "zone" });
  expect(zones).toContain('href="/search?q=grommash&amp;in=lore&amp;type=npc"');
  expect(zones).toContain('href="/search?q=grommash&amp;in=lore"');
  expect(zones.match(/href="\/lore\/1\d\d-zone-\d+"/g)).toHaveLength(20);
  const npcs = await render({ q: "grommash", type: "npc" });
  expect(npcs).toContain("No lore page matches that.");
  const mounts = await render({ q: "grommash", type: "mounts" });
  expect(mounts.match(/href="\/lore\/1\d\d-zone-\d+"/g)).toHaveLength(20);
});

test("type chips are hidden for a release without type data", async () => {
  const html = await renderLore({ q: "grommash" }, await buildLoreRelease({ typed: false }));
  expect(html).not.toContain("type=npc");
});

test("a repeated parameter answers with its first value, never a crash", async () => {
  const html = await render({ q: ["grommash", "thrall"], page: ["2", "9"] } as unknown as Record<string, string>);
  expect(html).toContain('href="/search?q=grommash&amp;in=lore"');
  expect(html).not.toContain("page=3");
});
