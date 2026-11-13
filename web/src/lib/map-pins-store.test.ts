import { beforeEach, expect, test, vi } from "vitest";
const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("./upload-store", () => ({ uploadStore: store }));
import { RECHECK_SCOPES } from "./recheck-scopes";
import { MAP_PINS_KEY, buildMapPins, encodeMapPins, parseMapPins, writeMapPins, loadStoredMapPins, forgetStoredMapPins, loadMapPins } from "./map-pins-store";

const cloud = { r2AccountId: "acct", r2AccessKeyId: "id", r2SecretAccessKey: "secret", r2Bucket: "uploads" };
const asOf = "2026-11-09T00:00:00.000Z";
const corpus = { uploads: 3, dataAsOf: asOf, records: ["a", "b", "c"].flatMap((installId) => [
  { kind: "npc_sighting", installId, npcId: 7, name: "Guard", mapId: 1429, x: 40, y: 60, positionKind: "npc", capturedAt: asOf },
  { kind: "loot", installId, sourceObjectId: 5, sourceObjectName: "Peacebloom", sourceEvidence: "loot-api", lootType: "gather", gatherKind: "herb", items: [{ itemId: 2447, count: 1 }], mapId: 1429, x: 20, y: 30, capturedAt: asOf },
  { kind: "recipe_observed", installId, profession: "Alchemy", recipe: "Potion", rank: 1, difficulty: "optimal", reagents: [], capturedAt: asOf },
]) };
beforeEach(() => {
  forgetStoredMapPins();
  store.loadCorpus.mockReset().mockResolvedValue(corpus);
  for (const [key, value] of Object.entries({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "uploads" })) vi.stubEnv(key, value);
});

test("the cron writes the same facts as the corpus and a request reads the file without the corpus", async () => {
  const requests: Request[] = [];
  let body = "";
  const doFetch = vi.fn(async (input: RequestInfo | URL) => {
    const req = input as Request;
    requests.push(req);
    if (req.method === "PUT") body = await req.text();
    return new Response(req.method === "GET" ? body : null, { headers: { etag: "v1" } });
  });
  expect(await writeMapPins({ added: 1, dataAsOf: asOf }, { cloud, fetch: doFetch })).toMatchObject({ written: true });
  expect(requests[0].url).toContain(MAP_PINS_KEY);
  expect(parseMapPins(body)?.set).toEqual(buildMapPins(corpus));
  store.loadCorpus.mockClear();
  vi.stubGlobal("fetch", doFetch);
  expect(await loadMapPins()).toEqual({ ...buildMapPins(corpus), unreachable: false });
  expect(store.loadCorpus).not.toHaveBeenCalled();
});

test("an idle run only checks the file's stamp; a missing, unstamped or older file and a rebuild write it", async () => {
  const build = vi.fn(async () => buildMapPins(corpus));
  const stamped = (stamp?: string) => new Response(null, { headers: stamp ? { "x-amz-meta-data-as-of": stamp } : {} });
  const doFetch = vi.fn(async (input: RequestInfo | URL) => (input as Request).method === "PUT" ? new Response(null) : stamped(asOf));
  expect(await writeMapPins({ added: 0, dataAsOf: asOf }, { cloud, fetch: doFetch, build })).toEqual({ written: false });
  expect(build).not.toHaveBeenCalled();
  doFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
  await writeMapPins({ added: 0, dataAsOf: asOf }, { cloud, fetch: doFetch, build });
  // A file from before the stamp, or one built from an older snapshot (a write that failed after new uploads).
  doFetch.mockResolvedValueOnce(stamped());
  await writeMapPins({ added: 0, dataAsOf: asOf }, { cloud, fetch: doFetch, build });
  doFetch.mockResolvedValueOnce(stamped("2026-11-08T00:00:00.000Z"));
  await writeMapPins({ added: 0, dataAsOf: asOf }, { cloud, fetch: doFetch, build });
  await writeMapPins({ added: 0, rebuild: true, dataAsOf: asOf }, { cloud, fetch: doFetch, build });
  expect(build).toHaveBeenCalledTimes(4);
  const puts = doFetch.mock.calls.map(([req]) => req as Request).filter((req) => req.method === "PUT");
  expect(puts.map((req) => req.headers.get("x-amz-meta-data-as-of"))).toEqual([asOf, asOf, asOf, asOf]);
  // With no snapshot time the stamp says so, and a matching idle run still skips.
  doFetch.mockResolvedValueOnce(stamped("none"));
  expect(await writeMapPins({ added: 0, dataAsOf: null }, { cloud, fetch: doFetch, build })).toEqual({ written: false });
});

test("the file is kept for five minutes and revalidated by ETag", async () => {
  const doFetch = vi.fn(async (_input: RequestInfo | URL) => new Response(encodeMapPins(buildMapPins(corpus), asOf), { headers: { etag: "v1" } }));
  const first = await loadStoredMapPins({ cloud, fetch: doFetch, now: () => 0 });
  expect(await loadStoredMapPins({ cloud, fetch: doFetch, now: () => 299999 })).toBe(first);
  expect(doFetch).toHaveBeenCalledTimes(1);
  doFetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
  expect(await loadStoredMapPins({ cloud, fetch: doFetch, now: () => 300000 })).toBe(first);
  expect((doFetch.mock.calls[1][0] as Request).headers.get("if-none-match")).toBe("v1");
});

test.each(["missing", "invalid", "failed"])("a %s file falls back and unreadable corpus stays unrecorded", async (mode) => {
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (mode === "failed") throw new Error("offline");
    return new Response("{}", { status: mode === "missing" ? 404 : 200 });
  }));
  expect(await loadMapPins()).toMatchObject({ ...buildMapPins(corpus), unreachable: false });
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  expect(await loadMapPins()).toMatchObject({ unreachable: true, dataAsOf: null });
});

test("a failed write does not claim success", async () => {
  await expect(writeMapPins({ added: 1, dataAsOf: asOf }, { cloud, fetch: async () => new Response(null, { status: 503 }) })).rejects.toThrow("write failed");
});

test("the file holds the reported rows only; the recheck list comes from the build reading it", async () => {
  const set = buildMapPins(corpus);
  expect(set.facts.recheck).toBe(RECHECK_SCOPES);
  const body = encodeMapPins(set, asOf);
  expect(JSON.parse(body).set.facts).not.toHaveProperty("recheck");
  expect(parseMapPins(body)?.set.facts.recheck).toBe(RECHECK_SCOPES);
  // A file written by an older build, with the list that build bundled, gets this build's list.
  const old = JSON.parse(body);
  old.set.facts.recheck = [{ kind: "npc", ids: [7], since: "2026-01-01T00:00:00.000Z", reason: "stale" }];
  expect(parseMapPins(JSON.stringify(old))?.set.facts.recheck).toBe(RECHECK_SCOPES);
});

test("the stored map includes rolled-up bounds without install identifiers", async () => {
  const records = ["private-a", "private-b", "private-c"].map((installId) => ({
    kind: "map_bounds", installId, capturedAt: asOf, mapId: 1429, continentId: 0,
    left: 100, top: 200, right: 300, bottom: 400,
  }));
  const body = encodeMapPins(buildMapPins({ records, dataAsOf: asOf }), asOf);
  const read = parseMapPins(body)!;
  expect(read.set).toHaveProperty("bounds", [{ mapId: 1429, continentId: 0, left: 100, top: 200, right: 300, bottom: 400, installs: 3, agreed: true }]);
  expect(body).not.toContain("private-");
  const old = JSON.parse(body);
  delete old.set.bounds;
  expect(parseMapPins(JSON.stringify(old))).toBeNull();
});

test("legacy and malformed bound snapshots fall back to the corpus", async () => {
  const valid = JSON.parse(encodeMapPins(buildMapPins(corpus), asOf));
  for (const broken of [
    { ...valid, version: 1 },
    { ...valid, set: { ...valid.set, bounds: null } },
    { ...valid, set: { ...valid.set, bounds: [{ mapId: 1429 }] } },
  ]) {
    forgetStoredMapPins();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(broken))));
    expect(await loadMapPins()).toEqual({ ...buildMapPins(corpus), unreachable: false });
  }
});
