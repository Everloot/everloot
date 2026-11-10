import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * The pin tables on the entity pages (where players saw an NPC stand, where a vendor stands, where a quest's
 * giver is): the Map column names the zone, the link column has a name, and each "Show on the map" link says
 * where it goes, so a reader going link by link can tell the rows apart.
 */

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus, loadCompletion: async () => ({ state: null, dataAsOf: null, unreachable: true }) },
}));
// The link with its attributes, since the label and the tooltip are what the test reads.
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ push: () => {} }) }));

import NpcPage from "./npcs/[id]/page";
import VendorPage from "./vendors/[id]/page";
import QuestPage from "./quests/[id]/page";

let n = 0;
const base = (installId: string) => ({ installId, eventId: `e${n++}`, capturedAt: "2026-10-10T00:00:00.000Z" });
const three = ["a", "b", "c"];
// Guard Thomas in Elwynn Forest (UiMap 1429), a vendor, and the giver of a quest; three installs agree on everything.
const records = [
  ...three.map((i) => ({ ...base(i), kind: "npc_sighting", positionKind: "npc", npcId: 1, name: "Guard Thomas", mapId: 1429, x: 40, y: 60, level: 25, reaction: "friendly" })),
  ...three.map((i) => ({ ...base(i), kind: "vendor", vendorNpcId: 1, items: [{ itemId: 159, priceCopper: 25 }] })),
  ...three.map((i) => ({ ...base(i), kind: "quest", questId: 176, title: "Wanted: Hogger", level: 10, giverNpcId: 1, rewardItemIds: [] })),
];
const html = async (el: Promise<ReactNode>) => renderToStaticMarkup(await el);
const props = (id: string) => ({ params: Promise.resolve({ id }) });
const HEADER = '<span class="sr-only">Map link</span>';
const LABEL = 'aria-label="Show Elwynn Forest at 40, 60 on the map"';

beforeEach(() => store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records, dataAsOf: "2026-10-10T00:00:00.000Z" }));

test("an NPC with no agreed position and a quest with no agreed level draw no name-only tooltip and no second empty state", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 1, records: records.filter((r) => r.installId === "a"), dataAsOf: "2026-10-10T00:00:00.000Z" });
  for (const page of [() => NpcPage(props("1")), () => QuestPage(props("176"))]) {
    const markup = await html(page());
    expect(markup).not.toContain("data-tooltip-frame");
    expect(markup).not.toContain("<div data-empty-state");
  }
  // The Map tab says it once, with the rule.
  const npc = await html(NpcPage(props("1")));
  expect(npc.match(/No agreed position yet\. A pin needs 3 installs at the same spot\./g)).toHaveLength(1);
});

test("an NPC's pin table names the zone, keeps the map id in a tooltip, and names its link and its link column", async () => {
  const page = await html(NpcPage(props("1")));
  expect(page).toContain('<span title="UiMap 1429">Elwynn Forest</span>');
  expect(page).toContain(HEADER);
  expect(page).toContain(LABEL);
  expect(page).toContain("40, 60");
  // The raw id is in the title only, never a cell of its own.
  expect(page).not.toMatch(/<td[^>]*>1429<\/td>/);
});

test("a vendor's places and a quest's giver link the map the same way", async () => {
  const vendor = await html(VendorPage(props("1")));
  expect(vendor).toContain('<span title="UiMap 1429">Elwynn Forest</span>');
  expect(vendor).toContain(HEADER);
  expect(vendor).toContain(LABEL);
  expect(vendor).not.toContain("Map 1429 at");
  const quest = await html(QuestPage(props("176")));
  expect(quest).toContain(HEADER);
  expect(quest).toContain(LABEL);
});
