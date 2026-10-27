import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  assets: null as unknown, names: [] as unknown[], tipCalls: [] as number[][], matched: null as unknown,
  levels: new Map<number, { level: number; required: number; binding: number }>(),
  progress: [] as { fact: "armor"; reporters: number; build: string }[],
}));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => state.assets,
  loadItemNames: async () => state.matched,
  loadItemTips: async (_assets: unknown, ids: readonly number[]) => {
    state.tipCalls.push([...ids]);
    return new Map(ids.map((id) => [id, { name: `Game name ${id}`, color: "#fff", quality: "Common", icon: `https://assets.example.test/b/icons/i${id}.webp`, lines: [], partial: false, why: [], label: "found in game files, unconfirmed · build 1.60.1.70450", level: 0, required: 0, binding: 0, ...state.levels.get(id) }]));
  },
}));
vi.mock("@/lib/rollup-compute", () => ({
  loadItemFacts: async () => ({ rates: [], names: state.names, npcs: [], unreachable: false }),
  loadWorldFacts: async () => ({ npcs: [], quests: [], vendors: [], unreachable: false }),
  loadInstanceFacts: async () => ({ entrances: [], encounters: [], sightings: [], unreachable: false, dataAsOf: null }),
  loadCraftedItems: async () => ({ items: new Set<number>(), unreachable: false }),
  loadObservedEdges: async () => ({ edges: [], unreachable: false, dataAsOf: null }),
  loadLootTables: async () => ({ tables: { sources: new Map(), leftOut: 0 }, unreachable: false, dataAsOf: null }),
  loadReportedItemFacts: async () => ({ shown: [], contested: [], progress: state.progress, unreachable: false }),
}));
vi.mock("@/lib/upload-store", () => ({ STORAGE_UNREACHABLE: "Storage unavailable", uploadStore: { loadCompletion: async () => ({ state: null, dataAsOf: null, unreachable: true }) } }));
vi.mock("next/link", () => ({ default: ({ href, children, style, title }: { href: string; children: ReactNode; style?: object; title?: string }) => <a href={href} title={title} style={style}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ push: () => {} }) }));

import ItemPage, { generateMetadata } from "./[id]/page";
import SubclassPage, { generateMetadata as subclassMetadata } from "./[id]/[subclass]/page";
import { NAME_TITLE } from "./category-page";
import { CREDIT } from "@/lib/talents/assets";
import { CLIENT_EDGES } from "@/lib/edges";
import { CLIENT_TAXONOMY, ITEMS_PER_PAGE, NAME_SOURCE } from "@/lib/items";
import sitemap from "@/app/sitemap";

const BASE = "https://assets.example.test/b";
const made = CLIENT_EDGES.find((e) => e.rel === "created_by")!;
const assets = {
  base: BASE, version: "1.60.1.70450", label: "found in game files, unconfirmed",
  classes: new Map(), professions: new Map(), maps: [], familyIcons: new Map(),
  spellIcons: new Map([[made.toId, `${BASE}/icons/spell.webp`]]),
};
const html = async (el: Promise<ReactNode>) => renderToStaticMarkup(await el);
const props = (id: string) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
const agreed = (itemId: number) => ["a", "b", "c"].map((installId) => ({ installId, itemId, name: `Agreed ${itemId}` }));

beforeEach(() => { state.assets = null; state.names = []; state.tipCalls = []; state.matched = null; state.levels = new Map(); state.progress = []; });

test("a below-threshold item fact shows report progress even without a game-file tooltip", async () => {
  state.progress = [{ fact: "armor", reporters: 1, build: "1.60.1.70450" }];
  const page = await html(ItemPage(props(String(made.fromId))));
  expect(page).toContain("Armor: 1 of 3 installs reported");
  expect(page).toContain("Not yet confirmed");
  expect(state.tipCalls).toEqual([]);
});

test("an unreported item: the creating spell's icon, but no game file tooltip; the credit is the site footer's", async () => {
  state.assets = assets;
  const page = await html(ItemPage(props(String(made.fromId))));
  expect(page).toContain(`${BASE}/icons/spell.webp`);
  expect(page).not.toContain(CREDIT);
  expect(page).not.toContain(`i${made.fromId}.webp`);
  expect(state.tipCalls).toEqual([]);
});

test("without the manifest there is no icon and no credit", async () => {
  const page = await html(ItemPage(props(String(made.fromId))));
  expect(page).not.toContain("<img");
  expect(page).not.toContain(CREDIT);
});

test("a category list asks for game file names and icons only for items players reported", async () => {
  state.assets = assets;
  const cloth = CLIENT_TAXONOMY.items.filter((r) => r[1] === 4 && r[2] === 1).slice(0, 3).map((r) => r[0]);
  state.names = agreed(cloth[1]);
  const page = await html(SubclassPage({ params: Promise.resolve({ id: "armor", subclass: "cloth" }), searchParams: Promise.resolve({}) }));
  expect(state.tipCalls).toEqual([[cloth[1]]]);
  expect(page).toContain(`i${cloth[1]}.webp`);
  expect(page).not.toContain(`i${cloth[0]}.webp`);
  // The players' agreed name wins over the game file name.
  expect(page).toContain(`Agreed ${cloth[1]}`);
  // The credit is the site footer's now (density spec, 2026-10-20), not a line on the list.
  expect(page).not.toContain(CREDIT);
});

/** Names the game files and the Warcraft Wiki agree on, as loadItemNames gives them, for the given ids. */
const matchedNames = (ids: number[]) => ({
  version: "1.60.1.70450",
  wiki: { name: "Warcraft Wiki (Internet Archive dump, 2023-11-13)", url: "https://warcraft.wiki.gg" },
  names: new Map(ids.map((id) => [id, { name: `Wiki name ${id}`, color: "#a335ee", wikiPage: `https://warcraft.wiki.gg/wiki/Wiki_${id}` }])),
});
const clothIds = () => CLIENT_TAXONOMY.items.filter((r) => r[1] === 4 && r[2] === 1).map((r) => r[0]);
const cloth = () => SubclassPage({ params: Promise.resolve({ id: "armor", subclass: "cloth" }), searchParams: Promise.resolve({}) });

test("a category row shows a name the game files and the wiki agree on, in its quality colour, its source in the hover card and in words for a screen reader, no printed label", async () => {
  state.assets = assets;
  const ids = clothIds();
  state.matched = matchedNames([ids[0]]);
  state.names = agreed(ids[1]);
  const page = await html(cloth());
  expect(page).toContain(`Wiki name ${ids[0]}`);
  expect(page).toContain("color:#a335ee");
  // The source is in the link's hover card (/database/card), not a plain title that would double it.
  expect(page).not.toContain(`title="${NAME_TITLE.wiki}"`);
  // The screen reader words follow the link: its anchor text is the name alone.
  expect(page).toContain(`>Wiki name ${ids[0]}</a><span class="sr-only"> (name from the warcraft wiki)</span>`);
  expect(page).not.toMatch(/<a [^>]*>[^<]*<span class="sr-only">/);
  // Players' names keep first place and say so; every other row stays "Item N" with none.
  expect(page).toContain(`Agreed ${ids[1]}`);
  expect(page).not.toContain(`title="${NAME_TITLE.players}"`);
  expect(page).toContain(`>Agreed ${ids[1]}</a><span class="sr-only"> (name confirmed by players)</span>`);
  expect(page).not.toContain(`>Item ${ids[2]}<`);
  expect(page).toContain("do not name yet");
  // No source line, no wiki link and no credit line on the list (density spec, 2026-10-20).
  expect(page).not.toContain(NAME_SOURCE.wiki);
  expect(page).not.toContain(NAME_SOURCE.players);
  expect(page).not.toContain("warcraft.wiki.gg/wiki/");
  // Tooltip facts are asked for the matched item and the reported one only.
  expect(state.tipCalls).toEqual([[ids[0], ids[1]]]);
  expect(await html(SubclassPage({ params: Promise.resolve({ id: "armor", subclass: "cloth" }), searchParams: Promise.resolve({ unnamed: "1" }) }))).toContain(`>Item ${ids[2]}<`);
});

test("a name from the game files alone shows with the unconfirmed marker", async () => {
  state.assets = assets;
  const ids = clothIds();
  state.matched = { ...matchedNames([]), names: new Map([[ids[0], { name: `File name ${ids[0]}`, color: "#a335ee", wikiPage: null, source: "files" }]]) };
  const page = await html(cloth());
  expect(page).toContain(`File name ${ids[0]}`);
  expect(page).toContain('data-badge="files"');
  expect(page).not.toContain(`>File name ${ids[0]}</a><span class="sr-only">`);
});

test("without the names file a category shows Item N and no wiki credit", async () => {
  const page = await html(cloth());
  expect(page).not.toContain(NAME_TITLE.wiki);
  expect(page).not.toContain("Warcraft Wiki contributors");
});

test("wiki-matched names count toward the half a category needs to be indexed and listed in the sitemap", async () => {
  const ids = clothIds();
  const half = Math.ceil(Math.min(ids.length, ITEMS_PER_PAGE) / 2);
  state.matched = matchedNames(ids.slice(0, half - 1));
  expect((await subclassMetadata({ params: Promise.resolve({ id: "armor", subclass: "cloth" }), searchParams: Promise.resolve({}) })).robots).toMatchObject({ index: false });
  expect((await sitemap()).map((e) => new URL(e.url).pathname)).not.toContain("/database/items/armor/cloth");
  // One player-agreed name makes up the half with the matched ones.
  state.names = agreed(ids[half - 1]);
  expect((await subclassMetadata({ params: Promise.resolve({ id: "armor", subclass: "cloth" }), searchParams: Promise.resolve({}) })).robots).toMatchObject({ index: true });
  expect((await sitemap()).map((e) => new URL(e.url).pathname)).toContain("/database/items/armor/cloth");
});

test("an item page with a matched name shows it with its icon and tooltip facts, marked unconfirmed, and is indexed; credits are the footer's", async () => {
  state.assets = assets;
  const id = clothIds()[0];
  state.matched = matchedNames([id]);
  const page = await html(ItemPage(props(String(id))));
  expect(page).toContain(`Wiki name ${id}</h1>`);
  expect(page).toMatch(new RegExp(`data-unconfirmed[^>]*>(?:<[^>]+>)*?<img[^>]*i${id}\\.webp`));
  // The tooltip card, as for an item players reported (DATA_POLICY, item names: facts follow the name).
  expect(page).toMatch(new RegExp(`data-tooltip-frame[^>]*>[\\s\\S]*Game name ${id}`));
  // No source line on the page: the Warcraft Wiki and Blizzard credits are in the site footer and /methodology#credits.
  expect(page).not.toContain(NAME_SOURCE.wiki);
  expect(page).not.toContain(CREDIT);
  expect(page).not.toMatch(/game files, unconfirmed/i);
  expect(state.tipCalls).toEqual([[id]]);
  const meta = await generateMetadata(props(String(id)));
  expect(meta.title).toBe(`Wiki name ${id} – WoW Forever item`);
  // A description of the page, not of where the name comes from (no provenance in the search snippet).
  expect(meta.description).toMatch(new RegExp(`^Wiki name ${id} is a [a-z]+ Armor item \\(Cloth\\) in WoW: Forever\\.`));
  expect(String(meta.description).replace(`Wiki name ${id}`, "")).not.toMatch(/wiki|game files|build|confirmed/i);
  expect(meta.robots).toMatchObject({ index: true });
  // An item with no name from any source stays "Item N", with no tooltip facts, and out of search.
  const other = clothIds()[1];
  state.tipCalls = [];
  const plain = await html(ItemPage(props(String(other))));
  expect(plain).toContain(`Item ${other}</h1>`);
  expect(plain).not.toContain("Game name");
  expect(state.tipCalls).toEqual([]);
  expect((await generateMetadata(props(String(other)))).robots).toMatchObject({ index: false });
});

test("item level and required level columns, from the tooltip facts of items players reported or the name rule names", async () => {
  state.assets = assets;
  const ids = clothIds();
  state.matched = matchedNames([ids[0]]);
  state.names = agreed(ids[1]);
  for (const id of ids.slice(0, 3)) state.levels.set(id, { level: 17, required: 12, binding: 2 });
  const page = await html(cloth());
  expect(page).toContain(">Item level<");
  expect(page).toContain(">Req. level<");
  // Two rows show their levels; the third has facts in the files but neither a reported item nor a matched name.
  expect(page.match(/>17<\/td>/g)).toHaveLength(2);
  expect(page.match(/>12<\/td>/g)).toHaveLength(2);
  expect(state.tipCalls.flat()).not.toContain(ids[2]);
});

/** The cloth list with these filters: the ids of its rows, in order, and its markup. */
async function clothRows(search: Record<string, string>) {
  const page = await html(SubclassPage({ params: Promise.resolve({ id: "armor", subclass: "cloth" }), searchParams: Promise.resolve(search) }));
  return { page, rows: [...page.matchAll(/<tr[^>]*>[\s\S]*?href="\/database\/items\/(\d+)"/g)].map((m) => Number(m[1])) };
}

test("level and binding filters match only items whose facts show; unknown values never match, whatever the files hold", async () => {
  state.assets = assets;
  const ids = clothIds();
  state.matched = matchedNames(ids.slice(0, 3));
  state.names = agreed(ids[3]);
  state.levels = new Map([
    [ids[0], { level: 15, required: 10, binding: 2 }],
    [ids[1], { level: 25, required: 20, binding: 1 }],
    [ids[2], { level: 15, required: 0, binding: 0 }],
    [ids[3], { level: 18, required: 12, binding: 2 }],
    // In the files, but nobody reported it and the wiki does not name it: never read, never matched.
    [ids[4], { level: 15, required: 10, binding: 2 }],
  ]);
  const ilvl = await clothRows({ ilvl: "11-20" });
  expect(ilvl.rows).toEqual([ids[0], ids[2], ids[3]]);
  // The filter reads the facts of every row that may show them, and only those.
  expect(state.tipCalls).toEqual([ids.slice(0, 4)]);
  // No required level is no value: it does not match a required level range.
  expect((await clothRows({ req: "1-10" })).rows).toEqual([ids[0]]);
  expect((await clothRows({ bind: "none" })).rows).toEqual([ids[2]]);
  expect((await clothRows({ bind: "equip", req: "11-20" })).rows).toEqual([ids[3]]);
  // The filter is on in its menu and removable as a chip when nothing matches.
  const none = await clothRows({ ilvl: "81-999" });
  expect(none.rows).toEqual([]);
  expect(none.page).toContain("Item level 81+");
  expect(none.page).toContain('href="/database/items/armor/cloth"');
});

test("sorting by item level or required level puts known values first, low to high or back, ties by id", async () => {
  state.assets = assets;
  const ids = clothIds();
  state.matched = matchedNames(ids.slice(0, 3));
  state.levels = new Map([[ids[0], { level: 15, required: 10, binding: 2 }], [ids[1], { level: 25, required: 0, binding: 1 }], [ids[2], { level: 15, required: 5, binding: 0 }]]);
  expect((await clothRows({ sort: "-ilvl", unnamed: "1" })).rows.slice(0, 4)).toEqual([ids[1], ids[0], ids[2], ids[3]]);
  expect((await clothRows({ sort: "ilvl", unnamed: "1" })).rows.slice(0, 4)).toEqual([ids[0], ids[2], ids[1], ids[3]]);
  // Item 1's "no required level" sorts with the unknown rows, by id.
  expect((await clothRows({ sort: "req", unnamed: "1" })).rows.slice(0, 3)).toEqual([ids[2], ids[0], ids[1]]);
});

test("the pager and the other filters' links keep the level and binding filters", async () => {
  state.assets = assets;
  const ids = clothIds();
  state.matched = matchedNames(ids);
  for (const id of ids) state.levels.set(id, { level: 15, required: 10, binding: 2 });
  const { page, rows } = await clothRows({ ilvl: "11-20", bind: "equip" });
  expect(rows).toHaveLength(ITEMS_PER_PAGE);
  expect(page).toContain('href="/database/items/armor/cloth?ilvl=11-20&amp;bind=equip&amp;page=2"');
  expect(page).toContain('href="/database/items/armor/cloth?quality=poor&amp;ilvl=11-20&amp;bind=equip"');
  // The name box keeps them as hidden fields.
  expect(page).toContain('name="ilvl" value="11-20"');
  expect(page).toContain('name="bind" value="equip"');
});
