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
  expect(npc).toContain("verified by 2 players");
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
  expect(npc).toContain("verified by 2 players");
  expect(npc).toContain("66.7%");
  const item = await html(Item(props("750")));
  expect(text(item)).toContain("verified by 2 players");
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
