import { beforeEach, expect, test, vi } from "vitest";
import type { AggregateSet } from "./aggregate-set";
import { FARM_AREAS_KEY, FARM_AREAS_REVISION, forgetStoredFarmAreas, loadStoredFarmAreas, parseFarmAreas, writeFarmAreas } from "./farm-areas-store";
import { STAMP, stampOf } from "./stored-view-freshness";

const cloud = { r2AccountId: "acct", r2AccessKeyId: "synthetic-id", r2SecretAccessKey: "synthetic-secret", r2Bucket: "bucket" };
const area = { key: "1429", zone: { mapId: 1429, name: "Elwynn Forest", continentId: 1415, continentName: "Eastern Kingdoms" }, levels: { min: 5, max: 11 }, mobs: 2, nodes: 0 };
const file = { version: 1, revision: FARM_AREAS_REVISION, dataAsOf: "2026-11-22T14:10:12Z", areas: { gold: [area], leather: [], cloth: [area] } };

/** One stored file, served with its stamp; a PUT replaces it. */
function bucket(initial?: { body: string; stamp: string }) {
  const state = { ...initial, puts: 0 };
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const req = input as Request;
    expect(new URL(req.url).pathname).toBe(`/bucket/${FARM_AREAS_KEY}`);
    if (req.method === "PUT") { state.body = await req.text(); state.stamp = req.headers.get(STAMP) ?? ""; state.puts++; return new Response(null); }
    if (state.body === undefined) return new Response("missing", { status: 404 });
    return new Response(req.method === "HEAD" ? null : state.body, { headers: { [STAMP]: state.stamp!, etag: '"1"' } });
  });
  return { fetch, state };
}

beforeEach(() => forgetStoredFarmAreas());

test("the file reads back as written, and anything else is not the file", () => {
  expect(parseFarmAreas(JSON.stringify(file))).toEqual({ dataAsOf: file.dataAsOf, areas: file.areas });
  expect(parseFarmAreas("not json")).toBeNull();
  expect(parseFarmAreas(JSON.stringify({ ...file, version: 2 }))).toBeNull();
  expect(parseFarmAreas(JSON.stringify({ ...file, areas: { gold: [], leather: [] } }))).toBeNull();
  expect(parseFarmAreas(JSON.stringify({ ...file, areas: { ...file.areas, cloth: [{ ...area, mobs: "2" }] } }))).toBeNull();
});

test("the job writes the file stamped with the snapshot and revision, builds nothing while the stamp is current, and rewrites on a new snapshot", async () => {
  const { fetch, state } = bucket();
  const set = { dataAsOf: "2026-11-22T14:10:12Z", world: { npcs: [], quests: [], vendors: [] }, drops: { rates: [], measuredZeros: [], rejected: [] } } as unknown as AggregateSet;
  const build = vi.fn(async () => set);
  const opts = { added: 0, dataAsOf: "2026-11-22T14:10:12Z" };
  expect(await writeFarmAreas(opts, { cloud, fetch, build })).toMatchObject({ written: true });
  expect(state.stamp).toBe(stampOf("2026-11-22T14:10:12Z", FARM_AREAS_REVISION));
  expect(parseFarmAreas(state.body!)).toEqual({ dataAsOf: "2026-11-22T14:10:12Z", areas: { gold: [], leather: [], cloth: [] } });
  expect(await writeFarmAreas(opts, { cloud, fetch, build })).toEqual({ written: false });
  expect(build).toHaveBeenCalledOnce();
  expect(await writeFarmAreas({ ...opts, dataAsOf: "2026-11-22T14:20:12Z" }, { cloud, fetch, build })).toMatchObject({ written: true });
  expect(state.puts).toBe(2);
});

test("a page reads the stored areas once and keeps them; with no file it gets null and works them out itself", async () => {
  const { fetch } = bucket({ body: JSON.stringify(file), stamp: stampOf(file.dataAsOf, FARM_AREAS_REVISION) });
  const now = () => Date.parse("2026-11-22T14:30:00Z");
  expect(await loadStoredFarmAreas({ cloud, fetch, now })).toEqual({ dataAsOf: file.dataAsOf, areas: file.areas });
  expect(await loadStoredFarmAreas({ cloud, fetch, now })).not.toBeNull();
  expect(fetch).toHaveBeenCalledOnce();
  forgetStoredFarmAreas();
  expect(await loadStoredFarmAreas({ cloud, fetch: bucket().fetch, now })).toBeNull();
  forgetStoredFarmAreas();
  expect(await loadStoredFarmAreas({ cloud: null })).toBeNull();
});
