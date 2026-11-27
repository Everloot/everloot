import { beforeEach, expect, test, vi } from "vitest";
import type { AggregateSet } from "./aggregate-set";
import { forgetStoredInstanceFacts, INSTANCE_FACTS_KEY, INSTANCE_FACTS_REVISION, loadStoredInstanceFacts, parseInstanceFacts, writeInstanceFacts } from "./instance-facts-store";
import { STAMP, stampOf } from "./stored-view-freshness";

const cloud = { r2AccountId: "acct", r2AccessKeyId: "synthetic-id", r2SecretAccessKey: "synthetic-secret", r2Bucket: "bucket" };
const entrance = { installId: "invented-observer", instanceMapId: 33, name: "Invented Dungeon", instanceType: "party", mapId: 1, x: 20, y: 30 };
const encounter = { installId: "invented-observer", encounterId: 2748, name: "Invented Boss", instanceMapId: 33, success: true, npcIds: [3914] };
const instances = { entrances: [entrance], encounters: [encounter] };
const file = { version: 1, revision: INSTANCE_FACTS_REVISION, dataAsOf: "2026-11-27T14:10:12Z", instances };

/** One stored file, served with its stamp; a PUT replaces it. */
function bucket(initial?: { body: string; stamp: string }) {
  const state = { ...initial, puts: 0 };
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const req = input as Request;
    expect(new URL(req.url).pathname).toBe(`/bucket/${INSTANCE_FACTS_KEY}`);
    if (req.method === "PUT") { state.body = await req.text(); state.stamp = req.headers.get(STAMP) ?? ""; state.puts++; return new Response(null); }
    if (state.body === undefined) return new Response("missing", { status: 404 });
    return new Response(req.method === "HEAD" ? null : state.body, { headers: { [STAMP]: state.stamp!, etag: '"1"' } });
  });
  return { fetch, state };
}

beforeEach(() => forgetStoredInstanceFacts());

test("the file reads back as written, and anything else is not the file", () => {
  expect(parseInstanceFacts(JSON.stringify(file))).toEqual({ dataAsOf: file.dataAsOf, instances });
  expect(parseInstanceFacts("not json")).toBeNull();
  expect(parseInstanceFacts(JSON.stringify({ ...file, version: 2 }))).toBeNull();
  expect(parseInstanceFacts(JSON.stringify({ ...file, instances: { entrances: [] } }))).toBeNull();
  expect(parseInstanceFacts(JSON.stringify({ ...file, instances: { ...instances, encounters: [{ ...encounter, success: "yes" }] } }))).toBeNull();
});

test("the job writes the set's instance facts stamped with the snapshot and revision, and builds nothing while the stamp is current", async () => {
  const { fetch, state } = bucket();
  const set = { dataAsOf: "2026-11-27T14:10:12Z", instances: { ...instances, extra: "not stored" } } as unknown as AggregateSet;
  const build = vi.fn(async () => set);
  const opts = { added: 0, dataAsOf: "2026-11-27T14:10:12Z" };
  expect(await writeInstanceFacts(opts, { cloud, fetch, build })).toMatchObject({ written: true });
  expect(state.stamp).toBe(stampOf("2026-11-27T14:10:12Z", INSTANCE_FACTS_REVISION));
  expect(JSON.parse(state.body!)).toEqual(file);
  expect(await writeInstanceFacts(opts, { cloud, fetch, build })).toEqual({ written: false });
  expect(build).toHaveBeenCalledOnce();
  expect(await writeInstanceFacts({ ...opts, dataAsOf: "2026-11-27T14:20:12Z" }, { cloud, fetch, build })).toMatchObject({ written: true });
  expect(state.puts).toBe(2);
});

test("a page reads the stored facts once and keeps them; with no file it gets null and reads the aggregates itself", async () => {
  const { fetch } = bucket({ body: JSON.stringify(file), stamp: stampOf(file.dataAsOf, INSTANCE_FACTS_REVISION) });
  const now = () => Date.parse("2026-11-27T14:30:00Z");
  expect(await loadStoredInstanceFacts({ cloud, fetch, now })).toEqual({ dataAsOf: file.dataAsOf, instances });
  expect(await loadStoredInstanceFacts({ cloud, fetch, now })).not.toBeNull();
  expect(fetch).toHaveBeenCalledOnce();
  forgetStoredInstanceFacts();
  expect(await loadStoredInstanceFacts({ cloud, fetch: bucket().fetch, now })).toBeNull();
  forgetStoredInstanceFacts();
  expect(await loadStoredInstanceFacts({ cloud: null })).toBeNull();
});
