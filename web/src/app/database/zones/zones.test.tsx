import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { edgeDegraded } from "@/lib/cf-edge-cache";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
vi.mock("@/lib/zone-lore", () => ({
  zoneLore: (name: string) => name === "Westfall"
    ? { name, text: "Westfall is a farming zone.", href: "/lore/1-westfall", sourceUrl: "https://example.test/Westfall", licence: "CC BY-SA 4.0" }
    : null,
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));

import ZonesPage, { generateMetadata as zonesMetadata } from "./page";
import ZonePage, { generateMetadata } from "./[zone]/page";
import { EntityRelations } from "@/components/EntityRelations";
import type { Edge } from "../../../../../kb/src/edges";

const sighting = (installId: string, npcId: number, name: string, mapId: number, x: number, y: number) => ({
  kind: "npc_sighting", installId, eventId: `e:${installId}:${npcId}`, capturedAt: "2026-10-10T00:00:00.000Z",
  npcId, name, mapId, x, y, positionKind: "npc",
});
const three = (npcId: number, name: string, mapId: number, x: number, y: number) => ["a", "b", "c"].map((i) => sighting(`install-${i}`, npcId, name, mapId, x, y));
const corpus = (records: unknown[]) => ({ uploads: 3, records, dataAsOf: "2026-10-10T00:00:00.000Z" });
const html = async (el: Promise<ReactNode>) => renderToStaticMarkup(await el);
const props = (zone: string) => ({ params: Promise.resolve({ zone }) });

beforeEach(() => store.loadCorpus.mockReset());
// The fixture wiki has a published zone page for Westfall; the committed one keeps it a draft, which gets no link.
beforeAll(() => { vi.stubEnv("WIKI_DIR", fileURLToPath(new URL("../../../test/wiki", import.meta.url))); });
afterAll(() => { vi.unstubAllEnvs(); });

test("the index groups released zones by continent and links each one; held-back zones are left out", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three(100, "Guard Orin", 1436, 40, 50)));
  const page = await html(ZonesPage({}));
  expect(page).toContain("Eastern Kingdoms");
  expect(page).toContain("Kalimdor");
  expect(page).toContain('href="/database/zones/1436-westfall"');
  expect(page).toContain('href="/database/zones/1411-durotar"');
  for (const held of ["Mount Hyjal", "Riverglades", "Shen&#x27;dralas"]) expect(page).not.toContain(held);
  expect((await zonesMetadata({})).alternates?.canonical).toBe("/database/zones");
});

test("the index is a database list: data width, zones A to Z, a dash for a count nobody reported, no all-zero column", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three(100, "Guard Orin", 1436, 40, 50)));
  const page = await html(ZonesPage({}));
  expect(page).toContain('data-container="data"');
  expect(page.indexOf(">Duskwood<")).toBeLessThan(page.indexOf(">Elwynn Forest<"));
  expect(page.indexOf(">Elwynn Forest<")).toBeLessThan(page.indexOf(">Westfall<"));
  // Westfall's one NPC is a 1; the other zones' NPC cells are dashes, never 0. Nobody reported a vendor or a quest anywhere.
  expect(page).not.toMatch(/tabular-nums[^"]*">0</);
  for (const header of [">Vendors<", ">Quests<"]) expect(page).not.toContain(header);
  expect(page).toContain(">NPCs<");
});

test("a zone page shows its confirmed NPCs, its lore, and the map link; the name is not enough for an indexed page", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three(100, "Guard Orin", 1436, 40, 50)));
  const page = await html(ZonePage(props("1436-westfall")));
  expect(page).toContain("Westfall");
  expect(page).toContain('href="/database/npcs/100"');
  expect(page).toContain("Guard Orin");
  expect(page).toContain("Westfall is a farming zone.");
  expect(page).toContain('href="/lore/1-westfall"');
  expect(page).toContain('href="/map?zone=1436"');
  expect(page).toContain('data-badge="files"');
  expect((await generateMetadata(props("1436-westfall"))).robots).toMatchObject({ index: true });
});

test("a zone with two installs and no entrance is noindex and says what is missing", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three(100, "Guard Orin", 1450, 40, 50).slice(0, 2)));
  const page = await html(ZonePage(props("1450-moonglade")));
  expect(page).toContain("No NPC has a confirmed position here yet");
  expect(page).not.toContain("Guard Orin");
  expect((await generateMetadata(props("1450-moonglade"))).robots).toMatchObject({ index: false });
});

test("another slug redirects to the canonical address; a bad or held-back zone is a 404", async () => {
  store.loadCorpus.mockResolvedValue(corpus([]));
  await expect(html(ZonePage(props("1436")))).rejects.toThrow("REDIRECT /database/zones/1436-westfall");
  await expect(html(ZonePage(props("1436-old-name")))).rejects.toThrow("REDIRECT /database/zones/1436-westfall");
  await expect(html(ZonePage(props("2482-mount-hyjal")))).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(html(ZonePage(props("westfall")))).rejects.toThrow("NEXT_NOT_FOUND");
  expect((await generateMetadata(props("2482-mount-hyjal"))).robots).toMatchObject({ index: false });
});

test("storage down reads unavailable, never an empty list, and stays out of the index", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const page = await html(ZonePage(props("1436-westfall")));
  expect(page).not.toContain("No NPC has a confirmed position");
  expect(edgeDegraded(page)).toBe(true);
  expect((await generateMetadata(props("1436-westfall"))).robots).toMatchObject({ index: false });
});

test("a relation to a released zone links the zone page; a held-back zone gets no link", () => {
  const seen = (toId: number): Edge => ({ fromKind: "npc", fromId: 100, rel: "located_in", toKind: "zone", toId, evidence: "observed", build: null, installs: 3, firstSeen: null, lastSeen: null });
  const out = renderToStaticMarkup(<EntityRelations kind="npc" id={100} observed={[seen(1436), seen(2482)]} client={[]} />);
  expect(out).toContain('href="/database/zones/1436-westfall"');
  expect(out).toContain(">Westfall<");
  expect(out).not.toContain("/map?zone=");
  expect(out).not.toContain("Hyjal");
  expect(out).toContain("zone 2482");
});

test("a zone with nothing confirmed says so once, above the lists, and a zone with a confirmed NPC does not", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three(100, "Guard Orin", 1436, 40, 50).slice(0, 2)));
  const empty = await html(ZonePage(props("1450-moonglade")));
  expect(empty).toContain("Players have not confirmed anything in Moonglade yet.");
  expect(empty).toContain("A fact appears when 3 installs agree on it");
  store.loadCorpus.mockResolvedValue(corpus(three(100, "Guard Orin", 1436, 40, 50)));
  expect(await html(ZonePage(props("1436-westfall")))).not.toContain("Players have not confirmed anything");
});

test("an empty zone page makes one addon call; its empty lists are single muted lines with none", async () => {
  store.loadCorpus.mockResolvedValue(corpus([]));
  const page = await html(ZonePage(props("1429-elwynn-forest")));
  expect(page.match(/href="\/addon"/g)).toHaveLength(1);
  // The notice, then one line for each of the six lists.
  expect(page.match(/data-empty-state/g)).toHaveLength(7);
  expect(page).toContain("No NPC has a confirmed position here yet.");
});

test("the zone index says a dash is unrecorded, not none, and says so plainly when no zone has anything", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three(100, "Guard Orin", 1436, 40, 50)));
  const some = await html(ZonesPage({}));
  expect(some).toContain("A dash means nobody has confirmed anything of that kind in the zone yet. It does not mean there is none.");
  store.loadCorpus.mockResolvedValue(corpus([]));
  const none = await html(ZonesPage({}));
  expect(none).toContain("Players have not confirmed anything in any zone yet");
  expect(none).not.toContain("A dash means");
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const down = await html(ZonesPage({}));
  expect(down).not.toContain("Players have not confirmed anything in any zone yet");
  expect(edgeDegraded(down)).toBe(true);
  expect(edgeDegraded(none)).toBe(false);
});

// Items players looted from sources with a confirmed pin in the zone.
const loot = (installId: string, source: { npc?: number; obj?: number }, items: number[], place: Record<string, unknown> = {}) => ({
  kind: "loot", sourceEvidence: "loot-api", installId, eventId: `loot:${installId}:${source.npc ?? ""}:${source.obj ?? ""}:${items.join(",")}`,
  capturedAt: "2026-10-10T00:00:00.000Z", ...(source.npc ? { sourceNpcId: source.npc } : {}), ...(source.obj ? { sourceObjectId: source.obj } : {}),
  items: items.map((itemId) => ({ itemId, count: 1 })), ...place,
});
const installs = ["install-a", "install-b", "install-c"];
const minimap = (objectId: number, name: string, mapId: number) => installs.map((installId) => ({
  kind: "object_sighting", installId, eventId: `obj:${installId}:${objectId}`, capturedAt: "2026-10-10T00:00:00.000Z", objectId, name, mapId, x: 30.1, y: 50.2,
}));

test("a zone with items lists what 3 installs looted from its confirmed NPCs and objects, with sources, frequency and the method", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    ...three(100, "Guard Orin", 1436, 40, 50),
    loot("install-a", { npc: 100 }, [750, 2589]), loot("install-b", { npc: 100 }, [750]), loot("install-c", { npc: 100 }, [750]),
    ...minimap(77, "Battered Chest", 1436),
    ...installs.map((i) => loot(i, { obj: 77 }, [4496])),
  ]));
  const page = await html(ZonePage(props("1436-westfall")));
  expect(page).toContain(">Items<");
  expect(page).toContain('href="/database/items/750"');
  expect(page).toContain('href="/database/items/2589"');
  expect(page).toContain('href="/database/items/4496"');
  expect(page).toContain('href="/database/npcs/100"');
  expect(page).toContain('href="/database/objects/77"');
  // Item 750 is in all 3 of the NPC's windows, 2589 in 1 of 3; the method is shown under the table.
  expect(page).toContain("100.0%");
  expect(page).toContain("33.3%");
  expect(page).toContain("Observed frequency is the loot windows holding the item");
  expect(page).not.toContain("No item has an agreed drop");
});

test("a source fewer than 3 installs looted adds no item, and an unpinned source adds none either", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    ...three(100, "Guard Orin", 1436, 40, 50),
    ...installs.slice(0, 2).map((i) => loot(i, { npc: 100 }, [750])),
    // NPC 200 has 3 installs of loot but no confirmed pin anywhere.
    ...installs.map((i) => loot(i, { npc: 200 }, [2589])),
  ]));
  const page = await html(ZonePage(props("1436-westfall")));
  expect(page).not.toContain('href="/database/items/750"');
  expect(page).not.toContain('href="/database/items/2589"');
  expect(page).toContain("No item has an agreed drop from a confirmed NPC or object here yet. A rate needs loot windows from 3 installs.");
});

test("herbs gathered at a spot 3 installs placed are items found here too, and link the herbalism page", async () => {
  const at = { mapId: 1411, x: 50, y: 50 };
  store.loadCorpus.mockResolvedValue(corpus(installs.map((i) => loot(i, { obj: 1618 }, [2447], { ...at, gatherKind: "herb", sourceObjectName: "Peacebloom" }))));
  const page = await html(ZonePage(props("1411-durotar")));
  expect(page).toContain('href="/database/items/2447"');
  expect(page).toContain('href="/database/objects/1618"');
  expect(page).toContain('href="/tools/professions/herbalism#gather"');
  expect(page).not.toContain('href="/tools/professions/mining#gather"');
});

test("an empty zone says what a rate needs and links coverage, but no farming, gathering or wiki page it has nothing for", async () => {
  store.loadCorpus.mockResolvedValue(corpus([]));
  const page = await html(ZonePage(props("1411-durotar")));
  expect(page).toContain("No item has an agreed drop from a confirmed NPC or object here yet. A rate needs loot windows from 3 installs.");
  expect(page).toContain('href="/database/coverage/1411-durotar"');
  expect(page).not.toContain("Farming and gathering");
  expect(page).not.toContain("/tools/farming-routes");
  expect(page).not.toContain("/tools/professions/");
  expect(page).not.toContain('href="/wiki/');
});

test("the header links the coverage page and the published wiki page, and farming where a mob's loot is public", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    ...three(100, "Guard Orin", 1436, 40, 50),
    ...installs.map((i) => loot(i, { npc: 100 }, [750])),
  ]));
  const page = await html(ZonePage(props("1436-westfall")));
  expect(page).toContain('href="/database/coverage/1436-westfall"');
  expect(page).toContain('href="/wiki/test-zone"');
  expect(page).toContain("Farming and gathering");
  expect(page).toContain('href="/tools/farming-routes"');
});

test("storage down shows no Items tab, no empty items copy and no farming links, but still the coverage link", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const page = await html(ZonePage(props("1436-westfall")));
  expect(page).not.toContain(">Items<");
  expect(page).not.toContain("No item has an agreed drop");
  expect(page).not.toContain("Farming and gathering");
  expect(page).toContain('href="/database/coverage/1436-westfall"');
});
