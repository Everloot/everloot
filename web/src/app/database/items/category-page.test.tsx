import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const facts = vi.hoisted(() => ({ rates: [] as unknown[], names: [] as unknown[], npcs: [] as unknown[], unreachable: false }));
vi.mock("@/lib/rollup-compute", () => ({
  loadItemFacts: async () => facts,
  loadWorldFacts: async () => ({ npcs: [], quests: [], vendors: [], unreachable: false }),
  loadCraftedItems: async () => ({ items: new Set<number>(), unreachable: false }),
  loadObservedEdges: async () => ({ edges: [], unreachable: false, dataAsOf: null }),
  loadLootTables: async () => ({ tables: { sources: new Map(), leftOut: 0 }, unreachable: false, dataAsOf: null }),
}));
vi.mock("@/lib/upload-store", () => ({ STORAGE_UNREACHABLE: "Storage unavailable" }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (href: string) => { throw new Error(`NEXT_REDIRECT ${href}`); },
  useRouter: () => ({ push: () => {} }),
}));

import ItemPage, { generateMetadata } from "./[id]/page";
import SubclassPage, { generateMetadata as subclassMetadata } from "./[id]/[subclass]/page";
import ItemsPage from "./page";
import { CLIENT_LAYER, CLIENT_TAXONOMY, ITEMS_PER_PAGE } from "@/lib/items";

const props = (id: string, search: Record<string, string> = {}) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) });
const sub = (id: string, subclass: string, search: Record<string, string> = {}) => ({ params: Promise.resolve({ id, subclass }), searchParams: Promise.resolve(search) });
const html = async (el: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await el);

const items = (search: Record<string, string> = {}) => ItemsPage({ searchParams: Promise.resolve(search) });

test("/database/items lists every item, 50 a page, with the classes (plural) in its filter bar", async () => {
  const page = await html(items());
  expect(page).toContain('href="/database/items/weapons"');
  expect(page).toContain(">Weapons<");
  expect(page.match(/<tr /g)).toHaveLength(ITEMS_PER_PAGE);
  expect(page).toContain(`>${CLIENT_TAXONOMY.items.length.toLocaleString("en-US")}</span> items`);
  // No provenance line and no visible breadcrumb on a data page; the BreadcrumbList stays for search engines.
  expect(page).not.toContain("data-source-line");
  expect(page).not.toContain('aria-label="Breadcrumb"');
  expect(page).toContain('"@type":"BreadcrumbList"');
});

test("a word in the item slot is a class page; a subclass page filters by slot and quality and pages", async () => {
  const cls = await html(ItemPage(props("armor")));
  expect(cls).toContain("<h1");
  expect(cls).toContain("Armor");
  expect(cls).toContain('href="/database/items/armor/cloth"');
  const cloth = await html(SubclassPage(sub("armor", "cloth", { slot: "chest" })));
  expect(cloth).not.toContain("data-source-line");
  expect(cloth).toContain(">Chest<");
  expect(cloth).not.toContain(">Head<\/td>");
  const chest = CLIENT_TAXONOMY.items.filter((r) => r[1] === 4 && r[2] === 1 && [5, 20].includes(r[3])).length;
  expect(cloth).toContain(`>${chest.toLocaleString("en-US")}</span> items`);
  if (chest > ITEMS_PER_PAGE) expect(cloth).toContain('href="/database/items/armor/cloth?slot=chest&amp;page=2"');
});

test("filters, sort and page live in the URL in one order; several values join with commas; unknown ones are a 404", async () => {
  const many = await html(SubclassPage(sub("armor", "cloth", { quality: "epic,rare", sort: "-id" })));
  // The quality menu offers turning each value off and others on, keeping the sort.
  expect(many).toContain('href="/database/items/armor/cloth?quality=rare&amp;sort=-id"');
  expect(many).toContain('href="/database/items/armor/cloth?quality=uncommon,rare,epic&amp;sort=-id"');
  // The sorted column says so, and its header turns the order around.
  // (Ascending by id is its own URL: the plain list opens on the named items first.)
  expect(many).toMatch(/aria-sort="descending"[^>]*>[\s\S]*?href="\/database\/items\/armor\/cloth\?quality=rare,epic&amp;sort=id"/);
  await expect(html(SubclassPage(sub("armor", "cloth", { sort: "price" })))).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(html(SubclassPage(sub("armor", "cloth", { crafted: "yes" })))).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(html(items({ skill: "basket-weaving" }))).rejects.toThrow("NEXT_NOT_FOUND");
});

test("game-file filters: crafted, reagent, set piece and profession narrow the rows; zero rows say so with removable chips", async () => {
  const crafted = await html(items({ crafted: "1", skill: "tailoring" }));
  expect(crafted).toContain("Tailoring");
  expect(crafted).toMatch(/<tr /);
  const none = await html(SubclassPage(sub("armor", "cloth", { set: "1", quality: "poor" })));
  expect(none).toContain("No items match these filters.");
  expect(none).toContain('href="/database/items/armor/cloth?quality=poor"');
  expect(none).toContain('href="/database/items/armor/cloth"');
});

test("filtered, sorted and searched views are noindex with the plain category as canonical; a later plain page is its own", async () => {
  for (const search of [{ quality: "epic" }, { sort: "name" }, { q: "robe" }, { quality: "epic", page: "2" }] as Record<string, string>[]) {
    const m = await subclassMetadata(sub("armor", "cloth", search));
    expect(m.robots).toMatchObject({ index: false, follow: true });
    expect(m.alternates?.canonical).toBe("/database/items/armor/cloth");
  }
  const second = await subclassMetadata(sub("armor", "cloth", { page: "2" }));
  expect(second.alternates?.canonical).toBe("/database/items/armor/cloth?page=2");
  expect(second.title).toMatch(/^WoW Forever Cloth \(Armor\): [\d,]+ Items – Page 2$/);
  const { generateMetadata: allMetadata } = await import("./page");
  expect((await allMetadata({ searchParams: Promise.resolve({}) })).robots).toBeUndefined();
  expect((await allMetadata({ searchParams: Promise.resolve({ seen: "1" }) })).robots).toMatchObject({ index: false });
  expect((await allMetadata({ searchParams: Promise.resolve({ page: "3" }) })).alternates?.canonical).toBe("/database/items?page=3");
});

test("category titles lead with WoW Forever and the item count; descriptions carry no build or source wording", async () => {
  const weapons = CLIENT_TAXONOMY.classes.find((c) => c.slug === "weapons")!;
  const m = await generateMetadata(props("weapons"));
  expect(m.title).toBe(`WoW Forever Weapons: All ${weapons.items.toLocaleString("en-US")} Items`);
  for (const meta of [m, await subclassMetadata(sub("trade-goods", "cloth"))]) {
    expect(String(meta.description)).toMatch(/^All [\d,]+ .+ items in WoW: Forever, with filters/);
    expect(String(meta.description)).not.toMatch(/build|game files|unconfirmed/i);
  }
});

test("the first, singular class URLs move to the plural ones for good, filters kept", async () => {
  await expect(html(ItemPage(props("weapon")))).rejects.toThrow("NEXT_REDIRECT /database/items/weapons");
  await expect(html(SubclassPage(sub("weapon", "one-handed-swords", { quality: "epic" })))).rejects.toThrow("NEXT_REDIRECT /database/items/weapons/one-handed-swords?quality=epic");
  expect((await generateMetadata(props("weapon"))).robots).toMatchObject({ index: false });
  // A class whose plural is its own name (Armor) has no old URL to move.
  await expect(html(ItemPage(props("armors")))).rejects.toThrow("NEXT_NOT_FOUND");
});

test("unknown categories and filters are a 404, not an empty page", async () => {
  await expect(html(ItemPage(props("dragons")))).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(html(SubclassPage(sub("armor", "lances")))).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(html(SubclassPage(sub("armor", "cloth", { quality: "shiny" })))).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(html(SubclassPage(sub("armor", "cloth", { page: "9999" })))).rejects.toThrow("NEXT_NOT_FOUND");
});

test("a plain category page is indexed once half the rows it shows have a name, and the named rows come first", async () => {
  // No names yet: every category page is a list of "Item N", so none is indexed.
  expect((await subclassMetadata(sub("weapons", "one-handed-swords"))).robots).toMatchObject({ index: false, follow: true });
  expect((await generateMetadata(props("weapons"))).robots).toMatchObject({ index: false, follow: true });
  const swords = CLIENT_TAXONOMY.subclasses.find((s) => s.slug === "one-handed-swords")!;
  const all = CLIENT_TAXONOMY.items.filter((r) => r[1] === swords.classId && r[2] === swords.id).map((r) => r[0]);
  expect(all.length).toBeGreaterThan(ITEMS_PER_PAGE * 2);
  // Named items from the end of the id order: they lead the plain list anyway.
  const late = all.slice(-ITEMS_PER_PAGE);
  const name = (ids: number[]) => ids.flatMap((itemId) => ["a", "b", "c"].map((installId) => ({ installId, itemId, name: `Sword ${itemId}` })));
  const half = Math.ceil(ITEMS_PER_PAGE / 2);
  try {
    facts.names = name(late.slice(0, half - 1));
    expect((await subclassMetadata(sub("weapons", "one-handed-swords"))).robots).toMatchObject({ index: false });
    facts.names = name(late.slice(0, half));
    expect((await subclassMetadata(sub("weapons", "one-handed-swords"))).robots).toMatchObject({ index: true });
    const list = await html(SubclassPage(sub("weapons", "one-handed-swords", { unnamed: "1" })));
    const firstRow = list.slice(list.indexOf("<tbody"));
    expect(firstRow.indexOf(`Sword ${late[0]}`)).toBeGreaterThan(-1);
    expect(firstRow.indexOf(`Sword ${late[0]}`)).toBeLessThan(firstRow.indexOf(`>Item ${all[0]}<`));
    // Page 2 holds no named row, so it stays out; a filter stays out whatever the names.
    expect((await subclassMetadata(sub("weapons", "one-handed-swords", { page: "2" }))).robots).toMatchObject({ index: false });
    expect((await subclassMetadata(sub("weapons", "one-handed-swords", { quality: "epic" }))).robots).toMatchObject({ index: false });
    // Enough names spill onto page 2 and index it too.
    facts.names = name(all.slice(-(ITEMS_PER_PAGE + half)));
    expect((await subclassMetadata(sub("weapons", "one-handed-swords", { page: "2" }))).robots).toMatchObject({ index: true });
    // Two installs are not an agreed name.
    facts.names = name(late.slice(0, half)).filter((row) => row.installId !== "c");
    expect((await subclassMetadata(sub("weapons", "one-handed-swords"))).robots).toMatchObject({ index: false });
  } finally {
    facts.names = [];
  }
});

test("an item page shows its category path, slot and quality; unconfirmed is a quiet marker, with no source line or build", async () => {
  const row = CLIENT_TAXONOMY.items.find((r) => r[1] === 4 && r[2] === 1 && r[4] === 4)!;
  const page = await html(ItemPage(props(String(row[0]))));
  expect(page).toContain('href="/database/items/armor"');
  expect(page).toContain('href="/database/items/armor/cloth"');
  expect(page).toContain("Epic");
  expect(page).not.toContain("data-source-line");
  expect(page).not.toMatch(/game files, unconfirmed/i);
  expect(page).not.toContain(CLIENT_LAYER.build.version);
  expect(page).toMatch(/data-unconfirmed[^>]*title="From the game files, not yet confirmed by players"/);
  // No breadcrumb on screen; the trail stays as JSON-LD.
  expect(page).not.toContain('aria-label="Breadcrumb"');
  expect(page).toContain('"@type":"BreadcrumbList"');
  expect(page).toContain('"item":"https://everloot.app/database/items/armor/cloth"');
  // Every empty relation tab is the shared one-line empty state, never a bare zero.
  expect(page).toContain("data-empty-state");
});

test("the Source column and filter: reported items show where they come from, the filter keeps its place in pager, menus and name box", async () => {
  const cloth = CLIENT_TAXONOMY.items.filter((r) => r[1] === 4 && r[2] === 1).map((r) => r[0]);
  const [dropped, plain] = cloth;
  facts.rates = [{ itemId: dropped, sourceNpcId: 5, kills: 9, drops: 3, rate: 0.33, reporters: 3, public: true }];
  try {
    const all = await html(SubclassPage(sub("armor", "cloth")));
    expect(all).toContain(">Source<");
    expect(all).toContain(">Drop</td>");
    // Only the reported item has a source; the rest of the page shows a dash.
    expect(all.match(/>Drop<\/td>/g)).toHaveLength(1);
    const only = await html(SubclassPage(sub("armor", "cloth", { src: "drop", quality: "epic" })));
    expect(only).toContain("No items match these filters.");
    expect(only).toContain('href="/database/items/armor/cloth?src=drop"');
    const hit = await html(SubclassPage(sub("armor", "cloth", { src: "drop", sort: "-seen" })));
    expect(hit).toContain(`href="/database/items/${dropped}"`);
    expect(hit.match(/<tr /g)).toHaveLength(1);
    // The source menu turns it off, the other menus and the header links keep it, and the name box carries it as a hidden field.
    expect(hit).toContain('href="/database/items/armor/cloth?sort=-seen"');
    expect(hit).toContain('href="/database/items/armor?src=drop&amp;sort=-seen"');
    // (The quality menu offers the qualities of the rows the list can show: here the reported item's.)
    expect(hit).toMatch(/href="\/database\/items\/armor\/cloth\?quality=[a-z]+&amp;src=drop&amp;sort=-seen"/);
    expect(hit).toMatch(/<input[^>]*name="src"[^>]*value="drop"|<input[^>]*value="drop"[^>]*name="src"/);
  } finally {
    facts.rates = [];
  }
});

test("development leftovers are out of a list by default, counted honestly, and one click or an id brings them back", async () => {
  const cloth = CLIENT_TAXONOMY.items.filter((r) => r[1] === 4 && r[2] === 1).map((r) => r[0]);
  const [dev, real] = cloth;
  const total = cloth.length;
  const name = (itemId: number, label: string) => ["a", "b", "c"].map((installId) => ({ installId, itemId, name: label }));
  facts.names = [...name(dev, "Deprecated Cloth Cap"), ...name(real, "Linen Cap")];
  try {
    const list = await html(SubclassPage(sub("armor", "cloth", { unnamed: "1" })));
    expect(list).toContain("Linen Cap");
    expect(list).not.toContain("Deprecated Cloth Cap");
    // The total, the title and the control all say one item is held back.
    expect(list).toContain(`>${(total - 1).toLocaleString("en-US")}</span> items`);
    expect(list).toContain("Show 1 development leftover");
    expect(list).toContain('href="/database/items/armor/cloth?dev=1&amp;unnamed=1"');
    expect(String((await subclassMetadata(sub("armor", "cloth"))).title)).toContain(`${(total - 1).toLocaleString("en-US")} Items`);
    // Asked for, the leftover is listed and the control turns around; the view is its own URL and stays out of search.
    const all = await html(SubclassPage(sub("armor", "cloth", { dev: "1", unnamed: "1" })));
    expect(all).toContain("Deprecated Cloth Cap");
    expect(all).toContain(`>${total.toLocaleString("en-US")}</span> items`);
    expect(all).toContain("Hide 1 development leftover");
    expect(all).toContain('href="/database/items/armor/cloth?unnamed=1"');
    expect(all).toContain("dev=1&amp;unnamed=1&amp;sort=");
    const m = await subclassMetadata(sub("armor", "cloth", { dev: "1", unnamed: "1" }));
    expect(m.robots).toMatchObject({ index: false });
    expect(m.alternates?.canonical).toBe("/database/items/armor/cloth");
    // Its id finds it without the switch; its name does not.
    expect(await html(SubclassPage(sub("armor", "cloth", { q: String(dev) })))).toContain("Deprecated Cloth Cap");
    expect(await html(SubclassPage(sub("armor", "cloth", { q: "cloth cap" })))).not.toContain("Deprecated Cloth Cap");
    expect(await html(SubclassPage(sub("armor", "cloth", { q: "cloth cap", dev: "1" })))).toContain("Deprecated Cloth Cap");
    // Its own page says what it is, and stays out of search.
    const page = await html(ItemPage(props(String(dev))));
    expect(page).toContain("The game files mark this as a development item");
    expect((await generateMetadata(props(String(dev)))).robots).toMatchObject({ index: false });
    expect(await html(ItemPage(props(String(real))))).not.toContain("development item");
  } finally {
    facts.names = [];
  }
});

test("items no source names are one line above the list, sort last when shown, and the unrecorded view lists them plainly", async () => {
  const cloth = CLIENT_TAXONOMY.items.filter((r) => r[1] === 4 && r[2] === 1);
  const [first, second] = cloth.map((r) => r[0]);
  const name = (itemId: number, label: string) => ["a", "b", "c"].map((installId) => ({ installId, itemId, name: label }));
  facts.names = [...name(second, "Linen Cap")];
  const total = cloth.length;
  try {
    const list = await html(SubclassPage(sub("armor", "cloth")));
    // Only the named row is listed; the line counts the rest and says when names come.
    expect(list.match(/<tr /g)).toHaveLength(1);
    expect(list).toContain("Linen Cap");
    expect(list).not.toContain(`>Item ${first}<`);
    expect(list).toContain(`${(total - 1).toLocaleString("en-US")} items the game files do not name yet.`);
    expect(list).toMatch(/Their names arrive from the addon (after launch on November 4, 2026|as players see them)\./);
    expect(list).toContain('href="/database/items/armor/cloth?unnamed=1"');
    expect(list).toContain(`>${"1"}</span> item`);
    // Expanded: the named row first, then the ids with the placeholder tile; the view is its own URL, noindex.
    const open = await html(SubclassPage(sub("armor", "cloth", { unnamed: "1" })));
    expect(open.indexOf("Linen Cap")).toBeLessThan(open.indexOf(`>Item ${first}<`));
    expect(open).toContain(`>${total.toLocaleString("en-US")}</span> items`);
    expect(open).toContain(`Hide the ${(total - 1).toLocaleString("en-US")} unnamed items`);
    expect(open).toContain(">?</span>");
    const m = await subclassMetadata(sub("armor", "cloth", { unnamed: "1" }));
    expect(m.robots).toMatchObject({ index: false });
    expect(m.alternates?.canonical).toBe("/database/items/armor/cloth");
    // An id lookup finds an unnamed item without the switch.
    expect(await html(SubclassPage(sub("armor", "cloth", { q: String(first) })))).toContain(`>Item ${first}<`);
    // The unrecorded view is what the reader asked for: plain rows, no fold line.
    const unrecorded = CLIENT_TAXONOMY.items.find((r) => r[1] === 4 && r[2] === 1 && r[4] === null && r[0] !== second);
    if (unrecorded) {
      const view = await html(SubclassPage(sub("armor", "cloth", { quality: "unrecorded" })));
      expect(view).toContain(`>Item ${unrecorded[0]}<`);
      expect(view).not.toContain("do not name yet");
    }
  } finally {
    facts.names = [];
  }
});

test("with no development names the list shows no control", async () => {
  expect(await html(SubclassPage(sub("armor", "cloth")))).not.toContain("development leftover");
});

test("the profession menu leaves out a development profession unless the leftovers are asked for", async () => {
  const plain = await html(ItemPage(props("trade-goods")));
  expect(plain).toContain("?skill=tailoring");
  expect(plain).not.toContain("Test Profession [DNT]");
  expect(await html(ItemPage(props("trade-goods", { dev: "1" })))).toContain("Test Profession [DNT]");
});
