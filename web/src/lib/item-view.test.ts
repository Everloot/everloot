import { beforeEach, expect, test, vi } from "vitest";

// The corpus readers and the names file, fed in: facts name item 10 (agreed) and drop item 20 publicly, 30 privately.
const reads = vi.hoisted(() => ({
  facts: { unreachable: false, rates: [{ itemId: 20, public: true }, { itemId: 30, public: false }], names: [{ itemId: 10, name: "Linen Cloth" }], npcs: [] } as Record<string, unknown>,
  seen: { seen: new Set([10, 20, 40]), from: new Map([[20, ["drop"]], [40, ["vendor"]]]), unreachable: false } as Record<string, unknown>,
  names: { names: new Map([[50, { name: "Wiki Item" }]]) } as unknown,
  cloud: null as unknown,
  /** The corpus each reader was handed, if any. */
  passed: [] as unknown[],
}));
vi.mock("./rollup-compute", () => ({ loadItemFacts: async (read?: unknown) => { reads.passed.push(read); return reads.facts; } }));
vi.mock("./item-seen", () => ({ loadItemSeen: async (read?: unknown) => { reads.passed.push(read); return reads.seen; } }));
vi.mock("../../../kb/src/item-page", () => ({ agreedItemNames: (f: { names: { itemId: number; name: string }[] }) => new Map(f.names.map((n) => [n.itemId, n.name])) }));
vi.mock("./game-assets", () => ({ PRIVATE_UNREACHABLE: Symbol.for("unreachable"), loadItemNames: async () => reads.names }));

import { loadListNames, loadListSeen } from "./item-view";
import { buildItemView, forgetItemView, ITEM_VIEW_KEY, loadItemView, parseItemView, writeItemView } from "./item-view-store";
import { loadShownNames } from "./shown-item-names";
import { uploadStore } from "./upload-store";

const CLOUD = { r2AccountId: "acct", r2AccessKeyId: "id", r2SecretAccessKey: "secret", r2Bucket: "everloot-uploads", supabaseUrl: "https://db.test", supabaseServiceKey: "service" };
const AT = new Date("2026-11-06T12:00:00Z");

beforeEach(() => { forgetItemView(); reads.cloud = null; vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const useCloud = () => { for (const [k, v] of Object.entries({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "everloot-uploads" })) vi.stubEnv(k, v); };

test("the view holds exactly what the pages computed: agreed names, public drops, seen items and their sources", async () => {
  expect(await buildItemView("2026-11-06T11:50:00Z", AT)).toEqual({
    version: 1, generatedAt: AT.toISOString(), dataAsOf: "2026-11-06T11:50:00Z",
    agreed: [[10, "Linen Cloth"]], dropped: [20], seen: [10, 20, 40], from: [[20, ["drop"]], [40, ["vendor"]]],
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
  expect(reads.passed).toEqual([corpus, corpus]);
  load.mockRestore();
});

test("a file of an unknown shape is no view", async () => {
  const view = await buildItemView(null, AT);
  expect(parseItemView(view)).toEqual(view);
  for (const bad of [null, {}, { ...view, version: 2 }, { ...view, seen: ["x"] }, { ...view, from: [[1, ["teleport"]]] }, { ...view, agreed: [[1]] }]) {
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
