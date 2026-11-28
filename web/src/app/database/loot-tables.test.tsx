import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { buildLoreRelease } from "@/test/lore-release";

/** The NPC loot table and the item-source table: every number with its windows, installs and dates. */

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
  useRouter: () => ({ push: () => {} }),
}));

let n = 0;
const loot = (installId: string, npcId: number, itemIds: number[], capturedAt: string) => ({
  kind: "loot", sourceEvidence: "loot-api", installId, eventId: `ev-${n++}`, capturedAt, sourceNpcId: npcId,
  items: itemIds.map((itemId) => ({ itemId, count: 1 })),
});
const corpus = (records: unknown[]) => ({ uploads: 3, records, dataAsOf: "2026-10-21T00:00:00.000Z" });
const props = (id: string) => ({ params: Promise.resolve({ id }) });
const html = async (el: Promise<ReactNode>) => renderToStaticMarkup(await el);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

let release = "";
beforeAll(async () => { release = await buildLoreRelease(); });
beforeEach(() => { store.loadCorpus.mockReset(); vi.stubEnv("KB_SNAPSHOT_PATH", release); });
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function pages() {
  const [{ default: Npc }, { default: Item }] = await Promise.all([import("./npcs/[id]/page"), import("./items/[id]/page")]);
  return { Npc, Item };
}

test("three installs: the NPC and item tables give the rate with its denominator, dates and method", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    loot("install-aaaa", 40, [750], "2026-10-10T08:00:00.000Z"),
    loot("install-bbbb", 40, [], "2026-10-12T08:00:00.000Z"),
    loot("install-cccc", 40, [750], "2026-10-14T08:00:00.000Z"),
    loot("install-cccc", 40, [], "2026-10-14T09:00:00.000Z"),
  ]));
  const { Npc, Item } = await pages();
  const npc = text(await html(Npc(props("40"))));
  expect(npc).toContain("50.0%");
  expect(npc).toContain("Out of 4 loot windows from 3 installs, dated 2026-10-10 to 2026-10-14.");
  expect(npc).toContain("Data as of 2026-10-21.");
  const markup = await html(Item(props("750")));
  const item = text(markup);
  expect(item).toContain("50.0%");
  expect(item).toContain("2026-10-10 to 2026-10-14");
  expect(item).toContain("out of the loot windows opened on the source");
  // Where to get it is in the quick facts, above the tabs: the NPC it drops from, linked.
  const getFrom = markup.split(">Get it from</dt>")[1]?.split("</dd>")[0] ?? "";
  expect(getFrom).toContain('href="/database/npcs/40"');
});

test("no source: the quick facts have no Get it from row, and In short says nobody reported one", async () => {
  store.loadCorpus.mockResolvedValue(corpus([]));
  const { Item } = await pages();
  const markup = await html(Item(props("750")));
  expect(markup).not.toContain("Get it from");
  expect(text(markup)).toContain("No player has reported a drop source");
});

test("partial drops show their tier while heading names keep their threshold", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    loot("install-aaaa", 40, [750], "2026-10-10T08:00:00.000Z"),
    loot("install-bbbb", 40, [750], "2026-10-11T08:00:00.000Z"),
    { kind: "npc_sighting", positionKind: "npc", installId: "install-aaaa", npcId: 40, name: "Synthetic Boar", mapId: 1429, x: 40, y: 50, capturedAt: "2026-10-10T08:00:00.000Z" },
    { kind: "item_seen", installId: "install-bbbb", itemId: 750, name: "Synthetic Tusk", capturedAt: "2026-10-11T08:00:00.000Z" },
  ]));
  const { Npc, Item } = await pages();
  const npc = text(await html(Npc(props("40"))));
  expect(npc).toMatch(/Reported name 1 of 3 /);
  expect(npc).toContain("verified by 2 installs");
  expect(npc).not.toContain("Synthetic Boar");
  const item = text(await html(Item(props("750"))));
  expect(item).toMatch(/Reported name 1 of 3 /);
  expect(item).not.toContain("Synthetic Tusk");
});

test("two installs: the pages show the rate and source with a verified label", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    loot("install-aaaa", 40, [750], "2026-10-10T08:00:00.000Z"),
    loot("install-bbbb", 40, [750], "2026-10-11T08:00:00.000Z"),
    loot("install-bbbb", 40, [], "2026-10-11T09:00:00.000Z"),
  ]));
  const { Npc, Item } = await pages();
  const npc = text(await html(Npc(props("40"))));
  expect(npc).toContain("verified by 2 installs");
  expect(npc).toContain("66.7%");
  const item = await html(Item(props("750")));
  expect(text(item)).toContain("verified by 2 installs");
  expect(item).toContain("/database/npcs/40");
  expect(item).toContain("66.7%");
});

test("NPC and item-source rows show a 95% range and mark only samples with few windows", async () => {
  const { NpcLootPanel, ItemSourcesPanel } = await import("./loot-tables");
  const base = { sourceNpcId: 40, itemId: 750, first: null, last: null };
  for (const [withItem, windows, installs, expected, few] of [
    [3, 4, 3, "75.0% (30.1%–95.4%)", true],
    [750, 1000, 5, "75.0% (72.2%–77.6%)", false],
  ] as const) {
    const row = { ...base, withItem, windows, installs, rate: withItem / windows };
    const table = { npcId: 40, state: "rated" as const, span: { windows, installs, first: null, last: null }, rows: [row], missingInstalls: 0 };
    for (const panel of [
      <NpcLootPanel key="npc" table={table} title="Creature" item={() => "Item"} dataAsOf={null} />,
      <ItemSourcesPanel key="item" sources={{ rows: [row], short: null }} title="Item" source={() => "Creature"} dataAsOf={null} />,
    ]) {
      const markup = text(renderToStaticMarkup(panel));
      expect(markup).toContain(expected);
      expect(markup.includes("few windows")).toBe(few);
    }
  }
});


test("the few-windows label stops at the minimum window count even when other settling criteria fail", async () => {
  const { rateWithRange } = await import("./loot-tables");
  expect(rateWithRange(1, 49, 3)).toContain("few windows");
  expect(rateWithRange(1, 50, 3)).not.toContain("few windows");
  expect(rateWithRange(0, 0, 3)).toBe("Not recorded");
});

const sourceRow = (npcId: number, withItem: number, windows: number) =>
  ({ sourceNpcId: npcId, itemId: 750, withItem, windows, installs: 3, rate: withItem / windows, first: null, last: null });
const sourceIds = (markup: string) => [...markup.matchAll(/data-source="(\d+)"/g)].map((m) => Number(m[1]));
const sourceCell = (r: { sourceNpcId?: number }) => <span data-source={r.sourceNpcId}>Creature {r.sourceNpcId}</span>;

test("Dropped by sorts by drop chance, then by windows with it", async () => {
  const { ItemSourcesPanel } = await import("./loot-tables");
  const rows = [sourceRow(1, 10, 100), sourceRow(2, 5, 10), sourceRow(3, 20, 200), sourceRow(4, 1, 50)];
  const markup = renderToStaticMarkup(<ItemSourcesPanel sources={{ rows, short: null }} title="Item" source={sourceCell} dataAsOf={null} />);
  // 50%, then the two 10% rows by count (20 before 10), then 2%.
  expect(sourceIds(markup)).toEqual([2, 3, 1, 4]);
});

test("Dropped by gains a Zone column only where some source has an agreed zone", async () => {
  const { ItemSourcesPanel } = await import("./loot-tables");
  const rows = [sourceRow(1, 1, 2), sourceRow(2, 1, 4)];
  const zone = (r: { sourceNpcId?: number }) => (r.sourceNpcId === 1 ? <a href="/database/zones/12">Elwynn Forest</a> : null);
  const withZone = renderToStaticMarkup(<ItemSourcesPanel sources={{ rows, short: null }} title="Item" source={sourceCell} zone={zone} dataAsOf={null} />);
  expect(withZone).toMatch(/<th[^>]*>(?:<[^>]*>)*Zone/);
  expect(withZone).toContain('href="/database/zones/12"');
  const none = renderToStaticMarkup(<ItemSourcesPanel sources={{ rows, short: null }} title="Item" source={sourceCell} zone={() => null} dataAsOf={null} />);
  expect(none).not.toMatch(/<th[^>]*>(?:<[^>]*>)*Zone/);
});

test("a long Dropped by list shows 25 rows with a server-rendered pager and a Show all link", async () => {
  const { ItemSourcesPanel, LOOT_PER_PAGE } = await import("./loot-tables");
  expect(LOOT_PER_PAGE).toBe(25);
  const rows = Array.from({ length: 77 }, (_, i) => sourceRow(i + 1, 1, i + 2));
  const href = (p: number | "all") => `/database/items/750?drops=${p}#dropped-by`;
  const first = renderToStaticMarkup(<ItemSourcesPanel sources={{ rows, short: null }} title="Item" source={sourceCell} dataAsOf={null} pages={{ page: 1, href }} />);
  expect(sourceIds(first)).toHaveLength(25);
  expect(sourceIds(first)[0]).toBe(1);
  expect(first).toContain("1–25");
  expect(first).toContain('href="/database/items/750?drops=2#dropped-by"');
  expect(first).toMatch(/href="\/database\/items\/750\?drops=all#dropped-by"[^>]*>Show all 77</);
  const last = renderToStaticMarkup(<ItemSourcesPanel sources={{ rows, short: null }} title="Item" source={sourceCell} dataAsOf={null} pages={{ page: 4, href }} />);
  expect(sourceIds(last)).toHaveLength(2);
  const all = renderToStaticMarkup(<ItemSourcesPanel sources={{ rows, short: null }} title="Item" source={sourceCell} dataAsOf={null} pages={{ page: "all", href }} />);
  expect(sourceIds(all)).toHaveLength(77);
  expect(all).not.toContain("Show all");
  expect(all).toMatch(/href="\/database\/items\/750\?drops=1#dropped-by"[^>]*>Show 25 per page</);
  // 25 rows or fewer: no pager.
  const short = renderToStaticMarkup(<ItemSourcesPanel sources={{ rows: rows.slice(0, 25), short: null }} title="Item" source={sourceCell} dataAsOf={null} pages={{ page: 1, href }} />);
  expect(short).not.toContain("Show all");
  expect(short).not.toContain("1–25");
});

test("the NPC loot table pages the same way", async () => {
  const { NpcLootPanel } = await import("./loot-tables");
  const rows = Array.from({ length: 30 }, (_, i) => ({ ...sourceRow(40, 1, 4), itemId: 1000 + i }));
  const table = { npcId: 40, state: "rated" as const, span: { windows: 4, installs: 3, first: null, last: null }, rows, missingInstalls: 0 };
  const href = (p: number | "all") => `/database/npcs/40?drops=${p}#drops`;
  const markup = renderToStaticMarkup(<NpcLootPanel table={table} title="Creature" item={(id) => <span data-item={id} />} dataAsOf={null} pages={{ page: 2, href }} />);
  expect([...markup.matchAll(/data-item="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([1025, 1026, 1027, 1028, 1029]);
  expect(markup).toContain("26–30");
});

test("the drops page parameter: a page number, all, or the first page for anything else", async () => {
  const { lootPage } = await import("./loot-tables");
  expect(lootPage(undefined)).toBe(1);
  expect(lootPage("3")).toBe(3);
  expect(lootPage("all")).toBe("all");
  for (const bad of ["0", "-1", "x", "1.5", ["2"], "99999999999"]) expect(lootPage(bad)).toBe(1);
});

test("an item page reads ?drops= for its Dropped by pages", async () => {
  // 26 creatures each looted once by one install: 26 source rows, one past the first page.
  store.loadCorpus.mockResolvedValue(corpus(Array.from({ length: 26 }, (_, i) => loot("install-aaaa", 100 + i, [750], "2026-10-10T08:00:00.000Z"))));
  const { Item } = await pages();
  const page = (drops?: string) => html(Item({ params: Promise.resolve({ id: "750" }), searchParams: Promise.resolve(drops ? { drops } : {}) }));
  const first = await page();
  expect(first).toContain('href="/database/items/750?drops=2#dropped-by"');
  expect(first).toContain("Show all 26");
  const second = await page("2");
  expect(second).toContain("26–26");
});

test("an NPC that drops one item says 1 item in its quick facts, not 1 items", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    loot("install-aaaa", 40, [750], "2026-10-10T08:00:00.000Z"),
    loot("install-bbbb", 40, [750], "2026-10-12T08:00:00.000Z"),
    loot("install-cccc", 40, [750], "2026-10-14T08:00:00.000Z"),
  ]));
  const { Npc } = await pages();
  const markup = await html(Npc(props("40")));
  const drops = markup.split(">Drops</dt>")[1]?.split("</dd>")[0] ?? "";
  expect(drops).toMatch(/>1 item$/);
  expect(markup).not.toContain("1 items");
});
