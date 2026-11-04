import { afterEach, expect, test, vi } from "vitest";

vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCompletion: async () => ({ state: null, dataAsOf: null, unreachable: true }) },
}));

import { catalogIndex, resetCatalogIndex } from "./catalog-index";
import { achievementHref, chainHref, factionHref, loadCatalog, titleHref } from "./completion-lists";

afterEach(() => {
  resetCatalogIndex();
  vi.doUnmock("../../../kb/src/catalog-index");
  vi.resetModules();
  vi.restoreAllMocks();
});

test("every catalog answer for the four completionist kinds links a page the site's base list shows", async () => {
  const index = catalogIndex()!;
  const catalog = (await loadCatalog())!;
  const pages: Record<string, Map<number, string>> = {
    achievement: new Map(catalog.achievements.map((x) => [x.achievementId, achievementHref(x.achievementId, x.name)])),
    faction: new Map(catalog.factions.map((x) => [x.factionId, factionHref(x.factionId, x.name)])),
    title: new Map(catalog.titles.map((x) => [x.titleId, titleHref(x.titleId, x.name)])),
    quest_chain: new Map(catalog.chains.map((x) => [x.questLineId, chainHref(x.questLineId, x.name)])),
  };
  for (const [kind, listed] of Object.entries(pages)) {
    const records = index.byKind.get(kind) ?? [];
    expect(records.length, kind).toBeGreaterThan(0);
    for (const r of records) {
      expect(listed.has(Number(r.extId)), `${kind} ${r.extId} ${r.name} is not on the site's list`).toBe(true);
      expect(new URL(r.sourceUrl).pathname).toBe(listed.get(Number(r.extId)));
    }
  }
  // The files hold more factions than the site lists (hidden, internal ones); the index holds only those listed.
  expect(index.byKind.get("faction")!.length).toBe(catalog.factions.length);
});

test("a catalog that cannot be built is attempted once, said once, and leaves no index", async () => {
  const build = vi.fn(() => { throw new Error("client-titles.json: wrong shape"); });
  vi.doMock("../../../kb/src/catalog-index", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../kb/src/catalog-index")>()), buildCatalogIndex: build }));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.resetModules();
  const { catalogIndex: broken } = await import("./catalog-index");
  expect(broken()).toBeNull();
  expect(broken()).toBeNull();
  expect(broken()).toBeNull();
  expect(build).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]![0])).toContain("wrong shape");
});
