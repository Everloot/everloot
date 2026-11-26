import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { forgetRenders, loadRenders, parseRenders, rendersRoot } from "./game-renders";

const BASE = "https://assets.example.test/wow_classic_beta-71139-abc";
const PIC_A = `renders/${"a".repeat(32)}.webp`;
const PIC_B = `renders/${"b".repeat(32)}.webp`;
// renders.json as `npm run kb -- client-renders` writes it (kb/src/client-renders.ts, RenderManifest).
const manifest = {
  schema: "everloot.game-renders/1", label: "found in game files, unconfirmed",
  build: { product: "wow_classic_beta", buildId: 71139, version: "1.60.1.71139", buildConfig: "abc", extractedAt: "2026-11-25T00:00:00Z" },
  renderer: 1, size: 512,
  creatureDisplays: { "4626": PIC_A }, itemDisplays: { "20190": PIC_B },
  npcs: { "7385": 4626, "7386": 9999 }, items: { "19019": 20190 },
  counts: { planned: 2, made: 2, reused: 0, encrypted: 0, absent: 0, failed: 0, npcsWithoutDisplay: 0, npcsHumanoid: 0, npcsWithoutModel: 0, itemsWithoutAppearance: 0, itemsTextureOnly: 0, itemsWithoutModelFile: 0 },
  skipped: [],
};
const ok = (body: unknown) => vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

beforeEach(() => forgetRenders());
afterEach(() => vi.restoreAllMocks());

test("the pictures sit in the bucket's shared renders/ folder, one level above the build folder", () => {
  expect(rendersRoot(BASE)).toBe("https://assets.example.test");
  expect(rendersRoot("https://cdn.example.test/game/wow_classic_beta-71139-abc")).toBe("https://cdn.example.test/game");
  // No build folder, no place for the pictures.
  expect(rendersRoot("https://assets.example.test")).toBeNull();
  expect(rendersRoot("not a url")).toBeNull();
});

test("an NPC or item id leads through its display to the picture; an id whose display has none is left out", () => {
  const r = parseRenders(manifest, BASE)!;
  expect(r.npcs.get(7385)).toEqual({ url: `https://assets.example.test/${PIC_A}`, size: 512 });
  expect(r.items.get(19019)).toEqual({ url: `https://assets.example.test/${PIC_B}`, size: 512 });
  expect(r.npcs.has(7386)).toBe(false);
  // An NPC id is not an item id: each list reads its own displays.
  expect(r.items.has(7385)).toBe(false);
});

test("anything that is not a valid renders.json gives no pictures", () => {
  expect(parseRenders(null, BASE)).toBeNull();
  expect(parseRenders({ ...manifest, schema: "everloot.game-renders/2" }, BASE)).toBeNull();
  // A path outside renders/ (or any other name) is refused, never turned into a URL.
  expect(parseRenders({ ...manifest, creatureDisplays: { "4626": "../secret.webp" } }, BASE)).toBeNull();
  expect(parseRenders({ ...manifest, itemDisplays: { "20190": "https://evil.example/x.webp" } }, BASE)).toBeNull();
  expect(parseRenders({ ...manifest, size: 0 }, BASE)).toBeNull();
  expect(parseRenders(manifest, "https://assets.example.test")).toBeNull();
});

test("loadRenders reads renders.json beside manifest.json once per build URL and keeps it", async () => {
  const fetcher = ok(manifest);
  const [a, b] = await Promise.all([loadRenders(BASE, fetcher), loadRenders(BASE, fetcher)]);
  expect(a?.npcs.get(7385)?.url).toBe(`https://assets.example.test/${PIC_A}`);
  expect(b).toBe(a);
  expect(await loadRenders(BASE, fetcher)).toBe(a);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(`${BASE}/renders.json`);
});

test("no asset URL, a missing file, a failed or bad read: no pictures, never a throw, and a miss is asked again only after a minute", async () => {
  expect(await loadRenders(null, ok(manifest))).toBeNull();
  const missing = vi.fn(async () => new Response("no", { status: 404 }));
  expect(await loadRenders(BASE, missing)).toBeNull();
  expect(await loadRenders(BASE, missing)).toBeNull();
  expect(missing).toHaveBeenCalledTimes(1);
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
  const later = ok(manifest);
  expect((await loadRenders(BASE, later))?.items.size).toBe(1);
  forgetRenders();
  expect(await loadRenders(BASE, vi.fn(async () => { throw new Error("timeout"); }))).toBeNull();
  forgetRenders();
  expect(await loadRenders(BASE, ok({ schema: "something else" }))).toBeNull();
  forgetRenders();
  expect(await loadRenders(BASE, vi.fn(async () => new Response("{not json", { status: 200 })))).toBeNull();
});
