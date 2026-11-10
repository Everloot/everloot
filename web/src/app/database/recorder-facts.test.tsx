import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { buildLoreRelease } from "@/test/lore-release";

/**
 * Facts from Polestar Recorder rows on the database pages: rank and level, loot windows counted but not in the
 * rates, minimap pins, confirmed dungeon entrances and their bosses. Each under the 3-install rule, with no source
 * named on the page.
 */

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

const at = "2026-10-10T00:00:00.000Z";
const voters = ["1", "2", "3"].map((c) => `ps-${c.repeat(16)}-${String.fromCharCode(96 + Number(c)).repeat(16)}`);
const rows = (ids: string[]) => ids.flatMap((installId, i) => [
  { kind: "npc_sighting", installId, eventId: `ps:1:${i}:npc_sighting`, capturedAt: at, npcId: 61, name: "Thuros Lightfingers", mapId: 1429, x: 70 + i / 10, y: 79.2, level: 11, rank: "rare_elite", positionKind: "vignette" },
  { kind: "loot", installId, eventId: `ps:1:${i}:loot`, capturedAt: at, sourceNpcId: 61, items: [{ itemId: 2230, count: 1 }] },
  { kind: "loot", installId, eventId: `ps:2:${i}:loot`, capturedAt: at, sourceObjectId: 2843, items: [{ itemId: 2230, count: 1 }] },
  { kind: "object_sighting", installId, eventId: `ps:1:${i}:object_sighting`, capturedAt: at, objectId: 2843, name: "Battered Chest", mapId: 1436, x: 30.1, y: 50.2 },
  { kind: "instance_entrance", installId, eventId: `ps:1:${i}:instance_entrance`, capturedAt: at, instanceMapId: 36, name: "Deadmines", instanceType: "party", mapId: 1436, x: 42.5, y: 71.6 },
  { kind: "encounter", installId, eventId: `ps:1:${i}:encounter`, capturedAt: at, encounterId: 1144, name: "Edwin VanCleef", instanceMapId: 36, success: true, npcIds: [639] },
]);
const corpus = (records: unknown[]) => ({ uploads: 3, records, dataAsOf: at });
const props = (id: string) => ({ params: Promise.resolve({ id }) });
const zone = (segment: string) => ({ params: Promise.resolve({ zone: segment }) });
const html = async (el: Promise<ReactNode>) => renderToStaticMarkup(await el);

let release = "";
beforeAll(async () => { release = await buildLoreRelease(); });
beforeEach(() => { store.loadCorpus.mockReset(); vi.stubEnv("KB_SNAPSHOT_PATH", release); });
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function pages() {
  const [{ default: Npc }, { default: Item }, { default: Obj }, { default: Zone }] = await Promise.all([
    import("./npcs/[id]/page"), import("./items/[id]/page"), import("./objects/[id]/page"), import("./zones/[zone]/page"),
  ]);
  return { Npc, Item, Obj, Zone };
}

test("an NPC page shows the agreed rank and level, a vignette pin, and the reported windows outside the rates", async () => {
  store.loadCorpus.mockResolvedValue(corpus(rows(voters)));
  const { Npc } = await pages();
  const page = await html(Npc(props("61")));
  expect(page).toContain("Rare elite");
  expect(page).toMatch(/Level[\s\S]*?11/);
  expect(page).toContain("70.1, 79.2");
  expect(page).toContain("3 more loot windows reported, not yet in the rates.");
  expect(page).toContain("Nobody has looted this NPC in Forever yet. It shows once 3 installs report it.");
  expect(page).not.toContain("Polestar");
});

test("the item and object pages count the windows, and the object page pins the chest; nothing is a rate", async () => {
  store.loadCorpus.mockResolvedValue(corpus(rows(voters)));
  const { Item, Obj } = await pages();
  const item = await html(Item(props("2230")));
  expect(item).toContain("6 more loot windows with this item reported, not yet in the rates.");
  expect(item).not.toContain("%");
  const object = await html(Obj(props("2843")));
  expect(object).toContain("Battered Chest");
  expect(object).toContain("3 more loot windows reported, not yet in the rates.");
  expect(object).toContain("30.1, 50.2");
  expect(object).not.toContain("Polestar");
});

test("a zone page confirms the game files' entrance, lists its boss and the treasure", async () => {
  store.loadCorpus.mockResolvedValue(corpus(rows(voters)));
  const { Zone } = await pages();
  const page = await html(Zone(zone("1436-westfall")));
  expect(page).toContain("Confirmed by 3 installs");
  expect(page).toContain("Edwin VanCleef (3 kills)");
  expect(page).toContain('href="/database/objects/2843"');
  expect(page).toContain("Battered Chest");
  // The game files place the Deadmines: the players' entrance confirms it, it adds no second row.
  expect(page.match(/>Deadmines</g) ?? []).toHaveLength(1);
});

test("two voters leave every one of these out", async () => {
  store.loadCorpus.mockResolvedValue(corpus(rows(voters.slice(0, 2))));
  const { Npc, Obj, Zone } = await pages();
  const npc = await html(Npc(props("61")));
  expect(npc).not.toContain("Rare elite");
  expect(npc).not.toContain("70.1, 79.2");
  expect(npc).toContain("2 more loot windows reported, not yet in the rates.");
  expect(await html(Obj(props("2843")))).not.toContain("30.1, 50.2");
  const westfall = await html(Zone(zone("1436-westfall")));
  expect(westfall).not.toContain("Confirmed by");
  expect(westfall).not.toContain("Edwin VanCleef");
  expect(westfall).toContain("No treasure has a confirmed position here yet.");
});
