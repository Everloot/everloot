import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { zoneByMapId } from "@/lib/zones";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ push: () => {} }) }));

import ItemPage from "./page";

// The relation tabs carry what an item database lists beside each row, from data the site already has: where a
// vendor stands (its zone, once 3 installs measured it there) and a recipe's skill levels and reagents (game files).

const AT = "2026-10-10T00:00:00.000Z";
const INSTALLS = ["a", "b", "c"].map((i) => `install-${i}`);
let n = 0;
const vendor = (installId: string, vendorNpcId: number, itemId: number) => ({ kind: "vendor", installId, eventId: `v:${n++}`, capturedAt: AT, vendorNpcId, items: [{ itemId, priceCopper: 25 }] });
const sighting = (installId: string, npcId: number, mapId: number) => ({ kind: "npc_sighting", installId, eventId: `s:${n++}`, capturedAt: AT, npcId, mapId, x: 0.5, y: 0.5, positionKind: "interaction" });
const loot = (installId: string, npcId: number, itemId: number) => ({ kind: "loot", sourceEvidence: "loot-api", installId, eventId: `l:${n++}`, capturedAt: AT, sourceNpcId: npcId, items: [{ itemId, count: 1 }] });
const render = async (id: string) => renderToStaticMarkup(await ItemPage({ params: Promise.resolve({ id }) }));
/** One tab's panel, by the tab id the page gives it. */
const panel = (html: string, tab: string) => html.match(new RegExp(`id="[^"]*-panel-${tab}"[\\s\\S]*?</table>`))?.[0] ?? "";

/** A header or cell holding just this text, through the table's own wrapping spans. */
const th = (text: string) => new RegExp(`<th[^>]*>(?:<[^>]*>)*${text}(?:<[^>]*>)*</th>`);
const td = (text: string) => new RegExp(`<td[^>]*>(?:<[^>]*>)*${text}(?:<[^>]*>)*</td>`);

beforeEach(() => store.loadCorpus.mockReset());

const ELWYNN = 1429;

test("Sold by names the zone each vendor stands in, once 3 installs measured it there", async () => {
  expect(zoneByMapId(ELWYNN)?.name).toBe("Elwynn Forest");
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: AT,
    records: [...INSTALLS.map((i) => vendor(i, 1247, 159)), ...INSTALLS.map((i) => sighting(i, 1247, ELWYNN))],
  });
  const sold = panel(await render("159"), "sold-by");
  expect(sold).toMatch(th("Zone"));
  expect(sold).toContain("Elwynn Forest");
});

test("a vendor whose zone fewer than 3 installs measured shows no zone", async () => {
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: AT,
    records: [...INSTALLS.map((i) => vendor(i, 1247, 159)), sighting("install-a", 1247, ELWYNN)],
  });
  const sold = panel(await render("159"), "sold-by");
  expect(sold).not.toContain("Elwynn Forest");
  expect(sold).not.toMatch(th("Zone"));
});

test("Get it from leads with a vendor, a sure source, before a drop", async () => {
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: AT,
    records: [...INSTALLS.map((i) => loot(i, 299, 159)), ...INSTALLS.map((i) => vendor(i, 1247, 159))],
  });
  const html = await render("159");
  const getFrom = html.match(/Get it from<\/dt>[\s\S]*?<\/dd>/)?.[0] ?? "";
  expect(getFrom).toContain('href="/database/vendors/1247');
  expect(getFrom.indexOf("/database/vendors/1247")).toBeLessThan(getFrom.indexOf("/database/npcs/299"));
});

test("Created by gives the recipe's reagents and where it turns yellow and grey, from the game files", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, dataAsOf: AT, records: [] });
  // Rough Sharpening Stone (2862): spell 2660, one Rough Stone (2835), yellow at 15, grey at 55 (client-recipes.json).
  const created = panel(await render("2862"), "created-by");
  expect(created).toMatch(th("Reagents"));
  expect(created).toContain('href="/database/items/2835"');
  expect(created).toMatch(th("Yellow"));
  expect(created).toMatch(td("15"));
  expect(created).toMatch(th("Grey"));
  expect(created).toMatch(td("55"));
});

test("Used in gives each recipe's skill levels too", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, dataAsOf: AT, records: [] });
  // Rough Stone (2835) is the reagent of spell 2660, yellow at 15 and grey at 55.
  const used = panel(await render("2835"), "used-in");
  expect(used).toMatch(th("Yellow"));
  expect(used).toMatch(td("15"));
});
