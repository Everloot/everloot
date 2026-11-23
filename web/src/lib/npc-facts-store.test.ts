import { beforeEach, expect, test, vi } from "vitest";
import { agreedNpcFacts, worldFactsFromRecords } from "@kb/world-pages";
import type { AggregateSet } from "./aggregate-set";
import { buildNpcFacts, forgetStoredNpcFacts, loadStoredNpcFacts, NPC_FACTS_KEY, NPC_FACTS_REVISION, parseNpcFacts, writeNpcFacts } from "./npc-facts-store";
import { STAMP, stampOf } from "./stored-view-freshness";

const cloud = { r2AccountId: "acct", r2AccessKeyId: "synthetic-id", r2SecretAccessKey: "synthetic-secret", r2Bucket: "bucket" };
const AS_OF = "2026-11-23T10:00:00Z";
const sight = (installId: string, npcId: number, name: string, extra: Record<string, unknown> = {}) =>
  ({ kind: "npc_sighting", installId, npcId, name, mapId: 1429, x: 40, y: 60, positionKind: "npc", level: 5, reaction: "hostile", creatureType: "Beast", rank: "normal", capturedAt: AS_OF, ...extra });
// One NPC with every fact agreed, one two installs named (a candidate and a drop name), one with nothing agreed.
const world = worldFactsFromRecords([
  ...["a", "b", "c"].map((i) => sight(i, 7, "Hogger")),
  ...["a", "b"].map((i) => sight(i, 8, "Murk-Eye", { mapId: 0 })),
  sight("a", 9, "Stray"), sight("b", 9, "Other"),
]);
const set = { dataAsOf: AS_OF, world } as unknown as AggregateSet;

/** One stored file, served with its stamp; a PUT replaces it. */
function bucket(initial?: { body: string; stamp: string }) {
  const state = { ...initial, puts: 0 };
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const req = input as Request;
    expect(new URL(req.url).pathname).toBe(`/bucket/${NPC_FACTS_KEY}`);
    if (req.method === "PUT") { state.body = await req.text(); state.stamp = req.headers.get(STAMP) ?? ""; state.puts++; return new Response(null); }
    if (state.body === undefined) return new Response("missing", { status: 404 });
    return new Response(req.method === "HEAD" ? null : state.body, { headers: { [STAMP]: state.stamp!, etag: '"1"' } });
  });
  return { fetch, state };
}

beforeEach(() => forgetStoredNpcFacts());

test("the file reads back as the agreed table, in the order first seen, with empty fields left out of the file", () => {
  const file = buildNpcFacts(set);
  expect(file).toMatchObject({ version: 1, revision: NPC_FACTS_REVISION, dataAsOf: AS_OF });
  // The NPC with nothing agreed keeps only its zone and its leading name's one reporter (a zone 0 is still written).
  expect(file.npcs.find((n) => n.npcId === 9)).toEqual({ npcId: 9, zone: 1429, nameReporters: 1 });
  expect(file.npcs.find((n) => n.npcId === 8)).toMatchObject({ zone: 0, nameReporters: 2 });
  const read = parseNpcFacts(JSON.stringify(file));
  expect(read?.dataAsOf).toBe(AS_OF);
  expect([...read!.npcs]).toEqual([...agreedNpcFacts(world)]);
});

test("anything else is not the file", () => {
  const file = buildNpcFacts(set);
  expect(parseNpcFacts("not json")).toBeNull();
  expect(parseNpcFacts(JSON.stringify({ ...file, version: 2 }))).toBeNull();
  expect(parseNpcFacts(JSON.stringify({ ...file, npcs: {} }))).toBeNull();
  expect(parseNpcFacts(JSON.stringify({ ...file, npcs: [{ npcId: "7" }] }))).toBeNull();
  expect(parseNpcFacts(JSON.stringify({ ...file, npcs: [{ npcId: 7, rank: "legend" }] }))).toBeNull();
  expect(parseNpcFacts(JSON.stringify({ ...file, npcs: [{ npcId: 7, pins: [{ mapId: 1, x: 1 }] }] }))).toBeNull();
  expect(parseNpcFacts(JSON.stringify({ ...file, npcs: [{ npcId: 7, pinDates: [[1]] }] }))).toBeNull();
});

test("the job writes the file stamped with the snapshot and revision, builds nothing while the stamp is current, and rewrites on a new snapshot", async () => {
  const { fetch, state } = bucket();
  const build = vi.fn(async () => set);
  const opts = { added: 0, dataAsOf: AS_OF };
  expect(await writeNpcFacts(opts, { cloud, fetch, build })).toMatchObject({ written: true, npcs: 3 });
  expect(state.stamp).toBe(stampOf(AS_OF, NPC_FACTS_REVISION));
  expect([...parseNpcFacts(state.body!)!.npcs.keys()]).toEqual([7, 8, 9]);
  expect(await writeNpcFacts(opts, { cloud, fetch, build })).toEqual({ written: false });
  expect(build).toHaveBeenCalledOnce();
  expect(await writeNpcFacts({ ...opts, dataAsOf: "2026-11-23T10:10:00Z" }, { cloud, fetch, build })).toMatchObject({ written: true });
  expect(state.puts).toBe(2);
  await expect(writeNpcFacts(opts, { cloud: null, build })).rejects.toThrow(/cloud/);
});

test("a page reads the stored table once and keeps it; with no file it gets null", async () => {
  const file = JSON.stringify(buildNpcFacts(set));
  const { fetch } = bucket({ body: file, stamp: stampOf(AS_OF, NPC_FACTS_REVISION) });
  const now = () => Date.parse("2026-11-23T10:30:00Z");
  expect([...(await loadStoredNpcFacts({ cloud, fetch, now }))!.npcs.keys()]).toEqual([7, 8, 9]);
  expect(await loadStoredNpcFacts({ cloud, fetch, now })).not.toBeNull();
  expect(fetch).toHaveBeenCalledOnce();
  forgetStoredNpcFacts();
  expect(await loadStoredNpcFacts({ cloud, fetch: bucket().fetch, now })).toBeNull();
  forgetStoredNpcFacts();
  expect(await loadStoredNpcFacts({ cloud: null })).toBeNull();
});
