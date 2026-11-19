import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { IntakeRecord } from "@everloot/protocol";
import { buildAggregates } from "./aggregate-set";
import { itemNames, npcNames, objectNames, questTitles } from "./names";
import {
  buildSearchNames, encodeSearchNames, forgetStoredSearchNames, loadStoredSearchNames, parseSearchNames, SEARCH_NAMES_KEY, SEARCH_NAMES_REVISION, writeSearchNames,
} from "./search-names-store";

const AS_OF = "2026-11-19T06:00:00.000Z";
const INSTALLS = ["install-aaaa-0001", "install-bbbb-0002", "install-cccc-0003"];
const CLOUD = { r2AccountId: "acct", r2AccessKeyId: "key", r2SecretAccessKey: "secret", r2Bucket: "uploads" };

/** Three installs agree on an item, an NPC, a quest and an object; one NPC is reported by one install only; one item drops. */
function rows(): IntakeRecord[] {
  const out: Record<string, unknown>[] = [];
  INSTALLS.forEach((installId, i) => {
    let n = 0;
    const row = (r: Record<string, unknown>) => out.push({ installId, eventId: `ev-${i}-${n++}`, capturedAt: AS_OF, ...r });
    row({ kind: "npc_sighting", npcId: 100, name: "Kobold Vermin", mapId: 1429, x: 40.1, y: 50.2, level: 2, reaction: "hostile", positionKind: "npc" });
    if (i === 0) row({ kind: "npc_sighting", npcId: 300, name: "Marshal McBride", mapId: 1429, x: 48.2, y: 41.9, level: 20, reaction: "friendly", positionKind: "interaction" });
    for (let w = 0; w < 4; w++) row({ kind: "loot", sourceNpcId: 100, sourceEvidence: "loot-api", lootType: "kill", items: [{ itemId: 1001, count: 1 }] });
    row({ kind: "quest", questId: 7, title: "Kobold Camp Cleanup", level: 2, giverNpcId: 300, rewardItemIds: [], category: "Elwynn Forest", faction: "alliance" });
    for (const [itemId, name] of [[1001, "Kobold Candle"], [1003, "Linen Cloth"]] as const) row({ kind: "item_seen", itemId, name, quality: "common" });
    row({ kind: "loot", sourceObjectId: 600, sourceEvidence: "loot-api", lootType: "gather", gatherKind: "ore", mapId: 1429, x: 30, y: 30, sourceObjectName: "Copper Vein", items: [{ itemId: 2447, count: 1 }] });
    row({ kind: "object_sighting", objectId: 600, name: "Copper Vein", mapId: 1429, x: 55.5, y: 60.25 });
  });
  return out as unknown as IntakeRecord[];
}
const set = () => buildAggregates({ uploads: INSTALLS.length, records: rows(), dataAsOf: AS_OF });

/** A fetch whose HEAD answers `status` with the stamp, and whose PUT answers 200. */
const head = (status: number, stamp?: string) => vi.fn(async (req: Request) =>
  req.method === "HEAD" ? new Response(null, { status, headers: stamp ? { "x-amz-meta-data-as-of": stamp } : {} }) : new Response(null, { status: 200 }));

beforeEach(() => forgetStoredSearchNames());
afterEach(() => vi.unstubAllEnvs());

test("the file holds the names names.ts agrees on per kind, the unanimous NPC candidates, and the items with a public drop rate", () => {
  const s = set();
  const file = buildSearchNames(s, AS_OF);
  expect(file.items).toEqual([...itemNames(s.items)].sort((a, b) => a[0] - b[0]));
  expect(file.items).toEqual([[1001, "Kobold Candle"], [1003, "Linen Cloth"]]);
  expect(file.npcs).toEqual([...npcNames(s.world)]);
  expect(file.npcs).toEqual([[100, "Kobold Vermin"]]);
  expect(file.quests).toEqual([...questTitles(s.world)]);
  expect(file.objects).toEqual([...objectNames(s.items)]);
  // One install's name is a candidate for the wiki match, never an agreed name; it is normalized, as the wiki file keys its names.
  expect(file.npcCandidates).toEqual([[300, "marshal mcbride"]]);
  expect(file.dropped).toEqual([...new Set(s.items.rates.filter((r) => r.public).map((r) => r.itemId))]);
  expect(file.dropped).toEqual([1001, 2447]);
  // The objects the search may name are the ones /database/objects lists: a public loot window behind them.
  expect(file.objectIds).toEqual([600]);
  expect(file).toMatchObject({ version: 1, revision: SEARCH_NAMES_REVISION, generatedAt: AS_OF, dataAsOf: AS_OF });
});

test("the file reads back as the maps the search matches against; text that is not the file reads as none", () => {
  const file = buildSearchNames(set(), AS_OF);
  const read = parseSearchNames(encodeSearchNames(file))!;
  expect(read.names.items.get(1003)).toBe("Linen Cloth");
  expect(read.names.npcs.get(100)).toBe("Kobold Vermin");
  expect(read.names.quests.get(7)).toBe("Kobold Camp Cleanup");
  expect(read.names.objects.get(600)).toBe("Copper Vein");
  expect(read.candidates.get(300)).toBe("marshal mcbride");
  expect(read.dropped.has(1001)).toBe(true);
  expect(read.objectIds.has(600)).toBe(true);
  expect(read).toMatchObject({ generatedAt: AS_OF, dataAsOf: AS_OF });
  for (const text of ["", "bad json", "{}", JSON.stringify({ version: 2 }), JSON.stringify({ ...file, items: [["x", 1]] }), JSON.stringify({ ...file, dropped: ["a"] }), JSON.stringify({ ...file, objectIds: undefined })]) expect(parseSearchNames(text), text).toBeNull();
});

test("the cron writes the file when the run added uploads or rebuilt, or when there is none or it is stamped for another snapshot; an idle run with a current file only asks", async () => {
  const build = vi.fn(async () => set());
  const current = head(200, `${AS_OF};${SEARCH_NAMES_REVISION}`);
  expect(await writeSearchNames({ added: 0, dataAsOf: AS_OF }, { cloud: CLOUD, fetch: current as unknown as typeof fetch, build })).toEqual({ written: false });
  expect(current).toHaveBeenCalledOnce();
  expect(build).not.toHaveBeenCalled();
  const missing = head(404);
  const wrote = await writeSearchNames({ added: 0, dataAsOf: AS_OF }, { cloud: CLOUD, fetch: missing as unknown as typeof fetch, build, now: () => new Date(AS_OF) });
  expect(wrote).toMatchObject({ written: true });
  const put = (missing.mock.calls[1] as unknown as [Request])[0];
  expect(put.method).toBe("PUT");
  expect(put.url).toContain(SEARCH_NAMES_KEY);
  expect(put.headers.get("x-amz-meta-data-as-of")).toBe(`${AS_OF};${SEARCH_NAMES_REVISION}`);
  const body = await put.text();
  expect(wrote.bytes).toBe(new TextEncoder().encode(body).length);
  expect(parseSearchNames(body)?.names.items.get(1003)).toBe("Linen Cloth");
  const older = head(200, `2026-11-18T00:00:00.000Z;${SEARCH_NAMES_REVISION}`);
  expect(await writeSearchNames({ added: 0, dataAsOf: AS_OF }, { cloud: CLOUD, fetch: older as unknown as typeof fetch, build })).toMatchObject({ written: true });
  for (const opts of [{ added: 3, dataAsOf: AS_OF }, { added: 0, rebuild: true, dataAsOf: AS_OF }]) {
    const f = head(200, `${AS_OF};${SEARCH_NAMES_REVISION}`);
    expect(await writeSearchNames(opts, { cloud: CLOUD, fetch: f as unknown as typeof fetch, build })).toMatchObject({ written: true });
    expect((f.mock.calls[0] as unknown as [Request])[0].method).toBe("PUT");
  }
  await expect(writeSearchNames({ added: 1, dataAsOf: AS_OF }, { cloud: null, build })).rejects.toThrow(/cloud/);
  const refused = vi.fn(async () => new Response(null, { status: 500 }));
  await expect(writeSearchNames({ added: 1, dataAsOf: AS_OF }, { cloud: CLOUD, fetch: refused as unknown as typeof fetch, build })).rejects.toThrow(/500/);
});

test("a page keeps the file five minutes, sends its ETag after, keeps the same maps while the file is the same, and reads none without a cloud or a file", async () => {
  const text = encodeSearchNames(buildSearchNames(set(), AS_OF));
  let now = 0;
  const fetcher = vi.fn(async (_req: Request) => new Response(text, { headers: { etag: '"v1"' } }));
  const deps = { cloud: CLOUD, fetch: fetcher as unknown as typeof fetch, now: () => now };
  const first = await loadStoredSearchNames(deps);
  expect(first?.names.npcs.get(100)).toBe("Kobold Vermin");
  expect(await loadStoredSearchNames(deps)).toBe(first);
  expect(fetcher).toHaveBeenCalledOnce();
  now += 5 * 60_000;
  fetcher.mockImplementation(async (req: Request) => (req.headers.get("if-none-match") === '"v1"' ? new Response(null, { status: 304 }) : new Response(text)));
  expect(await loadStoredSearchNames(deps)).toBe(first);
  expect(fetcher).toHaveBeenCalledTimes(2);
  // The same file written again keeps the maps already read, so every memo keyed on them holds.
  now += 5 * 60_000;
  fetcher.mockImplementation(async () => new Response(text, { headers: { etag: '"v2"' } }));
  expect(await loadStoredSearchNames(deps)).toBe(first);
  // A failed re-read keeps the file for a minute; a missing file drops it.
  now += 5 * 60_000;
  fetcher.mockImplementation(async () => new Response(null, { status: 503 }));
  expect(await loadStoredSearchNames(deps)).toBe(first);
  now += 60_000;
  fetcher.mockImplementation(async () => new Response(null, { status: 404 }));
  expect(await loadStoredSearchNames(deps)).toBeNull();
  forgetStoredSearchNames();
  expect(await loadStoredSearchNames({ cloud: null })).toBeNull();
  vi.stubEnv("R2_ACCOUNT_ID", "");
  expect(await loadStoredSearchNames({ fetch: fetcher as unknown as typeof fetch })).toBeNull();
  forgetStoredSearchNames();
  fetcher.mockImplementation(async () => { throw new Error("down"); });
  expect(await loadStoredSearchNames(deps)).toBeNull();
});
