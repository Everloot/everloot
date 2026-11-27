import { beforeEach, expect, test, vi } from "vitest";

// The corpus readers and the names file, fed in: facts name item 10 (agreed) and drop item 20 publicly, 30 privately.
const reads = vi.hoisted(() => ({
  facts: { unreachable: false, rates: [{ itemId: 20, public: true }, { itemId: 30, public: false }], names: [{ itemId: 10, name: "Linen Cloth" }], npcs: [] } as Record<string, unknown>,
  seen: { seen: new Set([10, 20, 40]), from: new Map([[20, ["drop"]], [40, ["vendor"]]]), unreachable: false } as Record<string, unknown>,
  names: { names: new Map([[50, { name: "Wiki Item" }]]) } as unknown,
  reported: { reported: new Map([[20, { shown: [{ fact: "strength", value: 7, reporters: 3, build: "1.60.1.70862", lastSeen: null }], contested: [] }]]), unreachable: false } as Record<string, unknown>,
  cloud: null as unknown,
  /** The corpus each reader was handed, if any. */
  passed: [] as unknown[],
}));
vi.mock("./rollup-compute", () => ({
  loadItemFacts: async (read?: unknown) => { reads.passed.push(read); return reads.facts; },
  loadAllReportedItemFacts: async (read?: unknown) => { reads.passed.push(read); return reads.reported; },
  loadReportedItemFacts: async () => { throw new Error("a card with a stored view must not read the aggregates"); },
}));
vi.mock("./item-seen", () => ({ loadItemSeen: async (read?: unknown) => { reads.passed.push(read); return reads.seen; } }));
vi.mock("@kb/item-page", () => ({ agreedItemNames: (f: { names: { itemId: number; name: string }[] }) => new Map(f.names.map((n) => [n.itemId, n.name])) }));
vi.mock("./game-assets", () => ({ PRIVATE_UNREACHABLE: Symbol.for("unreachable"), loadItemNames: async () => reads.names }));

import { itemListIndex, loadCardFacts, loadListNames, loadListSeen } from "./item-view";
import { CLIENT_TAXONOMY, categoryNamedEnough, developmentLeftovers, listItems, MIN_NAMED_SHARE, sortItems } from "./items";
import { PER_PAGE } from "@/app/database/list-parts";
import { buildItemView, forgetItemView, ITEM_VIEW_KEY, loadItemView, parseItemView, writeItemView } from "./item-view-store";
import { loadShownNames } from "./shown-item-names";
import { uploadStore } from "./upload-store";
import { filterItems } from "@kb/item-taxonomy";

const CLOUD = { r2AccountId: "acct", r2AccessKeyId: "id", r2SecretAccessKey: "secret", r2Bucket: "everloot-uploads", supabaseUrl: "https://db.test", supabaseServiceKey: "service" };
const AT = new Date("2026-11-06T12:00:00Z");

beforeEach(() => { forgetItemView(); reads.cloud = null; vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const useCloud = () => { for (const [k, v] of Object.entries({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "everloot-uploads" })) vi.stubEnv(k, v); };

test("the view holds exactly what the pages computed: agreed names, public drops, seen items and their sources", async () => {
  expect(await buildItemView("2026-11-06T11:50:00Z", AT)).toEqual({
    version: 1, generatedAt: AT.toISOString(), dataAsOf: "2026-11-06T11:50:00Z",
    agreed: [[10, "Linen Cloth"]], dropped: [20], seen: [10, 20, 40], from: [[20, ["drop"]], [40, ["vendor"]]],
    reported: [[20, { shown: [{ fact: "strength", value: 7, reporters: 3, build: "1.60.1.70862", lastSeen: null }], contested: [] }]],
  });
  reads.facts = { ...reads.facts, unreachable: true };
  await expect(buildItemView(null, AT)).rejects.toThrow(/unreachable/);
  reads.facts = { ...reads.facts, unreachable: false };
});

test("the cron writes it after a change or when it is missing, and an idle run with the file reads only a HEAD", async () => {
  const view = await buildItemView(null, AT);
  const calls: Request[] = [];
  const answer = (head: number) => vi.fn(async (req: Request) => { calls.push(req); return new Response(null, { status: req.method === "HEAD" ? head : 200, headers: { "x-amz-meta-data-as-of": "none" } }); });
  expect(await writeItemView({ added: 0, dataAsOf: null }, { cloud: CLOUD, fetch: answer(200) as unknown as typeof fetch, build: async () => view })).toEqual({ written: false });
  expect(calls.map((c) => c.method)).toEqual(["HEAD"]);
  calls.length = 0;
  expect(await writeItemView({ added: 0, dataAsOf: null }, { cloud: CLOUD, fetch: answer(404) as unknown as typeof fetch, build: async () => view })).toEqual({ written: true, items: 3 });
  expect(calls.map((c) => c.method)).toEqual(["HEAD", "PUT"]);
  calls.length = 0;
  expect(await writeItemView({ added: 2, dataAsOf: null }, { cloud: CLOUD, fetch: answer(200) as unknown as typeof fetch, build: async () => view })).toEqual({ written: true, items: 3 });
  expect(calls.map((c) => c.method)).toEqual(["PUT"]);
  expect(calls[0]!.url).toBe(`https://acct.r2.cloudflarestorage.com/everloot-uploads/${ITEM_VIEW_KEY}`);
  expect(JSON.parse(await calls[0]!.text())).toEqual(view);
  await expect(writeItemView({ added: 1, dataAsOf: null }, { cloud: null })).rejects.toThrow(/cloud/);
});

test("the cron's view is worked out from the corpus it reads, never from stored aggregates the same run has not written yet", async () => {
  const corpus = { uploads: 3, records: [], dataAsOf: "2026-11-06T11:50:00Z" };
  const load = vi.spyOn(uploadStore, "loadCorpus").mockResolvedValue(corpus);
  reads.passed = [];
  const put = vi.fn(async () => new Response(null, { status: 200 }));
  expect(await writeItemView({ added: 1, dataAsOf: corpus.dataAsOf }, { cloud: CLOUD, fetch: put as unknown as typeof fetch })).toEqual({ written: true, items: 3 });
  expect(load).toHaveBeenCalledOnce();
  expect(reads.passed).toEqual([corpus, corpus, corpus]);
  load.mockRestore();
});

test("a file of an unknown shape is no view", async () => {
  const view = await buildItemView(null, AT);
  expect(parseItemView(view)).toEqual(view);
  const { reported: _reported, ...older } = view;
  expect(parseItemView(older)).toEqual(older);
  for (const bad of [null, {}, { ...view, version: 2 }, { ...view, seen: ["x"] }, { ...view, from: [[1, ["teleport"]]] }, { ...view, agreed: [[1]] },
    { ...view, reported: [[1, { shown: [{ fact: "luck", value: 1, reporters: 3, build: "b", lastSeen: null }], contested: [] }]] }, { ...view, reported: [[1, { shown: [] }]] }]) {
    expect(parseItemView(bad)).toBeNull();
  }
});

test("a page reads the file once per instance for five minutes, and asks again after a minute when there was none", async () => {
  const view = await buildItemView(null, AT);
  const fetch = vi.fn(async () => new Response(JSON.stringify(view), { status: 200 }));
  let now = 0;
  const read = await loadItemView({ cloud: CLOUD, fetch: fetch as unknown as typeof globalThis.fetch, now: () => now });
  expect(read?.agreed.get(10)).toBe("Linen Cloth");
  now = 4 * 60_000;
  await loadItemView({ cloud: CLOUD, fetch: fetch as unknown as typeof globalThis.fetch, now: () => now });
  expect(fetch).toHaveBeenCalledTimes(1);
  forgetItemView();
  const missing = vi.fn(async () => new Response(null, { status: 404 }));
  now = 0;
  expect(await loadItemView({ cloud: CLOUD, fetch: missing as unknown as typeof globalThis.fetch, now: () => now })).toBeNull();
  now = 30_000;
  await loadItemView({ cloud: CLOUD, fetch: missing as unknown as typeof globalThis.fetch, now: () => now });
  expect(missing).toHaveBeenCalledTimes(1);
  now = 61_000;
  await loadItemView({ cloud: CLOUD, fetch: missing as unknown as typeof globalThis.fetch, now: () => now });
  expect(missing).toHaveBeenCalledTimes(2);
});

test("the file is read as one-byte text: a name with a character above U+00FF reads the same, without res.text()", async () => {
  const view = { ...await buildItemView(null, AT), agreed: [[10, "Linen Cloth"], [11, "Aln’dor “Ward” — Ørn"]] as [number, string][] };
  const fetch = vi.fn(async () => {
    const res = new Response(JSON.stringify(view), { status: 200 });
    // Two bytes a character for the whole file if any one is above U+00FF; asciiJsonText reads the body instead.
    res.text = () => Promise.reject(new Error("read through asciiJsonText"));
    return res;
  });
  const read = await loadItemView({ cloud: CLOUD, fetch: fetch as unknown as typeof globalThis.fetch, now: () => 0 });
  expect(read?.agreed.get(11)).toBe("Aln’dor “Ward” — Ørn");
  expect(read?.view).toEqual(parseItemView(view));
});

test("the stored names and seen items answer exactly as the corpus path does, and without a view the pages fall back to it", async () => {
  const shown = await loadShownNames();
  const fallback = await loadListNames();
  const view = await buildItemView(null, AT);
  useCloud();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(view), { status: 200 })));
  const stored = await loadListNames();
  for (const id of [10, 20, 30, 40, 50, 60]) {
    for (const names of [fallback, stored]) {
      expect(names.showsTip(id), `showsTip ${id}`).toBe(shown.showsTip(id));
      expect(names.named.has(id), `named ${id}`).toBe(shown.named.has(id));
    }
  }
  expect(stored.agreed).toEqual(shown.agreed);
  expect("facts" in stored).toBe(false);
  const seen = await loadListSeen();
  expect([...seen.seen]).toEqual([10, 20, 40]);
  expect(seen.from.get(40)).toEqual(["vendor"]);
});

test("a hover card reads an item's reported numbers from the stored view; an item it does not list has none", async () => {
  const view = await buildItemView(null, AT);
  useCloud();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(view), { status: 200 })));
  expect((await loadCardFacts(20)).shown).toEqual([{ fact: "strength", value: 7, reporters: 3, build: "1.60.1.70862", lastSeen: null }]);
  expect(await loadCardFacts(10)).toEqual({ shown: [], contested: [], unreachable: false });
});

test("an item list's index of the names and seen items is worked out once per read of them, and again after a new read", async () => {
  const view = await buildItemView(null, AT);
  useCloud();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(view), { status: 200 })));
  const names = await loadListNames();
  // Nothing was read again: the same names, so the next list page works nothing out again.
  expect(await loadListNames()).toBe(names);
  const seen = await loadListSeen();
  const index = itemListIndex(names, seen);
  expect(itemListIndex(await loadListNames(), await loadListSeen())).toBe(index);
  // It holds what a page worked out on each view.
  const name = (id: number) => names.agreed.get(id) ?? names.matched?.names.get(id)?.name;
  expect([10, 20, 50, 60].map(index.name)).toEqual([10, 20, 50, 60].map(name));
  expect(index.leftovers).toEqual(developmentLeftovers(CLIENT_TAXONOMY.items, name));
  expect(index.unnamed).toEqual(new Set(CLIENT_TAXONOMY.items.filter((row) => !names.showsTip(row[0])).map((row) => row[0])));
  const order = sortItems(CLIENT_TAXONOMY.items, undefined, { name, seen: seen.seen });
  expect(order.every((row, i) => index.order.get(row[0]) === i)).toBe(true);
  // A new read of the view (the cron wrote a new one): new names, a new index.
  forgetItemView();
  const again = await loadListNames();
  expect(again).not.toBe(names);
  expect(itemListIndex(again, await loadListSeen())).not.toBe(index);
});

test("a list in the index's order has the same rows in the same order as one sorted on the spot, for any filter", async () => {
  // Names that tie, differ only in case, are development leftovers, or are missing; some items seen.
  const words = ["Linen Cloth", "linen cloth", "Copper Bar", "Zeal", "[PH] Test Item", "Älven Ring", "Mace", undefined];
  const rows = CLIENT_TAXONOMY.items;
  const agreed = new Map(rows.filter((_, i) => i % 3 !== 2).map((row, i) => [row[0], words[(i * 7) % words.length]]).filter((e): e is [number, string] => e[1] !== undefined));
  const names = { agreed, matched: null, degraded: false, unreachable: false, named: { has: (id: number) => agreed.has(id) }, showsTip: (id: number) => agreed.has(id) || id % 5 === 0 };
  const seen = { seen: new Set(rows.filter((_, i) => i % 4 === 0).map((row) => row[0])), from: new Map(), unreachable: false };
  const index = itemListIndex(names, seen);
  const plain = { name: index.name, seen: seen.seen };
  for (const q of [{ page: 1 }, { page: 1, dev: true }, { page: 1, quality: ["epic"] }, { page: 1, q: "linen" }, { page: 1, slot: ["chest"], seen: true }, { page: 1, sort: { key: "name" as const, desc: true } }]) {
    const base = q.quality ? rows.filter((row) => row[1] === 4) : rows;
    expect(listItems(base, q, { ...plain, order: index.order }), JSON.stringify(q)).toEqual(listItems(base, q, plain));
  }
});

test("whether a plain list's page is named enough to index comes from counts alone, as the sorted list gave it", () => {
  // The answer before: sort the category's plain list (named rows first) and look at the page's rows.
  const sorted = (classId: number | undefined, subclassId: number | undefined, named: Set<number>, page: number, hidden?: Set<number>) => {
    const rows = sortItems(filterItems(CLIENT_TAXONOMY, { classId, subclassId }).filter((row) => !hidden?.has(row[0])), undefined, { name: (id) => (named.has(id) ? "" : undefined) });
    const shown = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    return shown.length > 0 && shown.filter((row) => named.has(row[0])).length / shown.length >= MIN_NAMED_SHARE;
  };
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ids = CLIENT_TAXONOMY.items.map((row) => row[0]);
  const sets = [0, 0.05, 0.3, 0.6, 1].map((share) => new Set(ids.filter(() => random() < share)));
  const hidden = new Set(ids.filter(() => random() < 0.1));
  const categories: [number | undefined, number | undefined][] = [[undefined, undefined],
    ...CLIENT_TAXONOMY.classes.map((c) => [c.id, undefined] as [number, undefined]),
    ...CLIENT_TAXONOMY.subclasses.filter((s) => s.items > 0).map((s) => [s.classId, s.id] as [number, number])];
  let checked = 0, yes = 0;
  for (const [classId, subclassId] of categories) {
    for (const named of sets) {
      for (const page of [1, 2, 3, 7, 40, 400]) {
        for (const h of [undefined, hidden]) {
          const want = sorted(classId, subclassId, named, page, h);
          expect(categoryNamedEnough(classId, subclassId, named, page, h), `${classId}/${subclassId} p${page}`).toBe(want);
          checked++; if (want) yes++;
        }
      }
    }
  }
  expect(yes).toBeGreaterThan(0);
  expect(checked - yes).toBeGreaterThan(0);
});
