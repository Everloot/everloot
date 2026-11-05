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
  const item = text(await html(Item(props("750"))));
  expect(item).toContain("50.0%");
  expect(item).toContain("2026-10-10 to 2026-10-14");
  expect(item).toContain("out of the loot windows opened on the source");
});

test("short of 3 installs, the quick facts count the installs that reported so far, and show no name or rate", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    loot("install-aaaa", 40, [750], "2026-10-10T08:00:00.000Z"),
    loot("install-bbbb", 40, [750], "2026-10-11T08:00:00.000Z"),
    { kind: "npc_sighting", positionKind: "npc", installId: "install-aaaa", npcId: 40, name: "Synthetic Boar", mapId: 1429, x: 40, y: 50, capturedAt: "2026-10-10T08:00:00.000Z" },
    { kind: "item_seen", installId: "install-bbbb", itemId: 750, name: "Synthetic Tusk", capturedAt: "2026-10-11T08:00:00.000Z" },
  ]));
  const { Npc, Item } = await pages();
  const npc = text(await html(Npc(props("40"))));
  expect(npc).toMatch(/Reported name 1 of 3 /);
  expect(npc).toMatch(/Drops 2 of 3 /);
  expect(npc).not.toContain("Synthetic Boar");
  const item = text(await html(Item(props("750"))));
  expect(item).toMatch(/Reported name 1 of 3 /);
  expect(item).not.toContain("Synthetic Tusk");
});

test("two installs: the pages say what is missing, and no rate or source is shown", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    loot("install-aaaa", 40, [750], "2026-10-10T08:00:00.000Z"),
    loot("install-bbbb", 40, [750], "2026-10-11T08:00:00.000Z"),
    loot("install-bbbb", 40, [], "2026-10-11T09:00:00.000Z"),
  ]));
  const { Npc, Item } = await pages();
  const npc = text(await html(Npc(props("40"))));
  expect(npc).toContain("3 loot windows from 2 installs, dated 2026-10-10 to 2026-10-11. A rate needs windows from 3 installs: 1 more.");
  expect(npc).not.toContain("%");
  const item = await html(Item(props("750")));
  expect(text(item)).toContain("2 loot windows with this item from 2 installs, on sources fewer than 3 installs have looted.");
  expect(item).not.toContain("/database/npcs/40");
  expect(item).not.toContain("%");
});
