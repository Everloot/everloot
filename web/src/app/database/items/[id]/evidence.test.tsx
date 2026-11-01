import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ push: () => {} }) }));

import ItemPage from "./page";

let n = 0;
const loot = (installId: string, npcId: number, itemId: number) => ({
  kind: "loot", sourceEvidence: "loot-api", installId, eventId: `e:${n++}`, capturedAt: "2026-10-10T00:00:00.000Z",
  sourceNpcId: npcId, items: [{ itemId, count: 1 }],
});
const render = async (id: string) => renderToStaticMarkup(await ItemPage({ params: Promise.resolve({ id }) }));

beforeEach(() => store.loadCorpus.mockReset());

test("the page says in short what players reported, and links the key to read the numbers", async () => {
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z",
    records: ["a", "b", "c"].map((i) => loot(`install-${i}`, 299, 2770)),
  });
  const page = await render("2770");
  expect(page).toContain("In short");
  expect(page).toContain("Players reported 1 drop source");
  expect(page).toContain("How to read these numbers");
  expect(page).toContain('href="/database#reading"');
  // The key lives on the database index, so an item page stays quiet about it.
  expect(page).not.toContain("Measured zero");
});

test("an item nobody reported says so rather than staying silent", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, dataAsOf: "2026-10-10T00:00:00.000Z", records: [] });
  const page = await render("2770");
  expect(page).toContain("No player has reported a drop source or a map position yet.");
  expect(page).toContain("It has no agreed name yet");
});

test("the page offers the record as text for an assistant and as JSON", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, dataAsOf: "2026-10-10T00:00:00.000Z", records: [] });
  const page = await render("2770");
  expect(page).toContain("Copy for AI");
  expect(page).toContain('href="/api/tooltip/item/2770"');
  expect(page).toContain("Raw JSON");
});

test("a development leftover sharing the icon stays out of the related items, and is not counted as unnamed", async () => {
  // Peacebloom (2447) shares icon file 133939 with 2779, 3421, 3422, 3423, 19294 and 21123.
  const seen = (itemId: number, name: string) => ["a", "b", "c"].map((i) => ({ kind: "item_seen", installId: `install-${i}`, eventId: `seen-${itemId}-${i}`, itemId, name, capturedAt: "2026-10-10T00:00:00.000Z" }));
  store.loadCorpus.mockResolvedValue({ uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z", records: [...seen(3421, "Simple Wildflowers"), ...seen(21123, "Monster - Item, Flower - White")] });
  const page = await render("2447");
  expect(page).toContain("Simple Wildflowers");
  expect(page).not.toContain("Monster - Item");
  expect(page).toContain("4 items with no name yet");
});
