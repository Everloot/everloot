import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { edgeDegraded } from "@/lib/cf-edge-cache";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus, loadCompletion: async () => ({ state: null, dataAsOf: null, unreachable: true }) },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import DatabasePage from "./(hub)/page";
import DropsPage from "./drops/page";

const loot = (install: string, npc: number, items: { itemId: number; count: number }[], n: number) => ({
  kind: "loot", eventId: `${install}:${npc}:${n}`, installId: install, capturedAt: "2026-10-09T00:00:00.000Z",
  sourceNpcId: npc, sourceEvidence: "loot-api", items,
});
const html = async (page: () => Promise<ReactNode>) => renderToStaticMarkup(await page());

beforeEach(() => store.loadCorpus.mockReset());

test("unreadable storage reads unrecorded, never zero", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const drops = await html(() => DropsPage({}));
  expect(drops).toContain("Storage unreachable");
  expect(drops).not.toContain("0 windows");
  expect(drops).not.toContain("<table");
  const db = await html(DatabasePage);
  expect(db).toContain("unrecorded");
  expect(db).not.toMatch(/>0<\/div>/);
  // Marked for the edge cache, so this render is kept a minute rather than the page's hour.
  expect(edgeDegraded(db)).toBe(true);
});

test("the database page is search first: the search, its scopes and a text index of every category, no prose", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-09T00:00:00.000Z" });
  const db = await html(DatabasePage);
  expect(db).toMatch(/<form[^>]*action="\/search"[^>]*method="get"/);
  for (const scope of ["", "item", "npc", "quest", "object"]) expect(db).toMatch(new RegExp(`<input type="radio"[^>]*name="in"[^>]*value="${scope}"`));
  expect(db).toContain('href="/database/items/weapons/one-handed-swords"');
  expect(db).toContain('href="/database/npcs"');
  expect(db).not.toContain("data-source-line");
  expect(db).not.toContain('aria-label="Breadcrumb"');
});

test("an empty readable corpus says nothing is public yet, with the empty state and no bare zero", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-09T00:00:00.000Z" });
  const drops = await html(() => DropsPage({}));
  expect(drops).not.toContain("0 windows");
  expect(drops).toContain("data-empty-state");
  expect(drops).toContain("No public frequencies yet");
  expect(await html(DatabasePage)).not.toContain(">0<");
});

test("with loot windows recorded, the drops page counts them beside its title", async () => {
  store.loadCorpus.mockResolvedValue({
    uploads: 3,
    records: [loot("install-aaa", 42, [], 1), loot("install-bbb", 42, [], 1), loot("install-ccc", 42, [], 1)],
    dataAsOf: "2026-10-09T00:00:00.000Z",
  });
  const drops = await html(() => DropsPage({}));
  expect(drops).toContain("3 loot windows · ");
  expect(drops).toMatch(/>1<\/span> public frequency/);
});

test("three installs with empty windows publish a measured zero; two installs publish nothing", async () => {
  store.loadCorpus.mockResolvedValue({
    uploads: 5,
    records: [
      loot("install-aaa", 42, [], 1), loot("install-bbb", 42, [], 1), loot("install-ccc", 42, [], 1),
      loot("install-aaa", 77, [{ itemId: 9, count: 1 }], 1), loot("install-bbb", 77, [{ itemId: 9, count: 1 }], 1),
    ],
  });
  const drops = await html(() => DropsPage({}));
  expect(drops).toContain("No items observed");
  expect(drops).toContain("NPC 42");
  expect(drops).not.toContain("NPC 77");
  expect(drops).not.toContain("Item 9");
});
