import { beforeEach, expect, test, vi } from "vitest";
const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("./upload-store", () => ({ uploadStore: store }));
import { PROFESSIONS_KEY, PROFESSIONS_REVISION, buildProfessions, encodeProfessions, parseProfessions, writeProfessions, loadStoredProfessions, forgetStoredProfessions, loadProfessions } from "./profession-store";
import { stampOf } from "./stored-view-freshness";

const cloud = { r2AccountId: "acct", r2AccessKeyId: "id", r2SecretAccessKey: "secret", r2Bucket: "uploads" };
const asOf = "2026-11-09T00:00:00.000Z";
const corpus = { uploads: 3, dataAsOf: asOf, records: ["a", "b", "c"].flatMap((installId) => [
  { kind: "npc_sighting", installId, npcId: 7, name: "Guard", mapId: 1429, x: 40, y: 60, positionKind: "npc", capturedAt: asOf },
  { kind: "loot", installId, sourceObjectId: 5, sourceObjectName: "Peacebloom", sourceEvidence: "loot-api", lootType: "gather", gatherKind: "herb", items: [{ itemId: 2447, count: 1 }], mapId: 1429, x: 20, y: 30, capturedAt: asOf },
  { kind: "recipe_observed", installId, profession: "Alchemy", recipe: "Potion", rank: 1, difficulty: "optimal", reagents: [], capturedAt: asOf },
  { kind: "loot", installId, sourceNpcId: 6, sourceEvidence: "loot-api", lootType: "skinning", gatherSkill: 25, items: [{ itemId: 2934, count: 1 }] },
]) };
beforeEach(() => {
  forgetStoredProfessions();
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
  expect(await writeProfessions({ added: 1, dataAsOf: asOf }, { cloud, fetch: doFetch })).toMatchObject({ written: true });
  expect(requests[0].url).toContain(PROFESSIONS_KEY);
  expect(parseProfessions(body)?.set).toEqual(buildProfessions(corpus));
  expect(parseProfessions(body)?.set.gathering?.skinning).toEqual([{ npcId: 6, installs: 3, skill: { min: 25, median: 25, installs: 3 }, itemIds: [2934] }]);
  store.loadCorpus.mockClear();
  vi.stubGlobal("fetch", doFetch);
  expect(await loadProfessions()).toEqual({ ...buildProfessions(corpus), unreachable: false });
  expect(store.loadCorpus).not.toHaveBeenCalled();
});

test("a stored snapshot from before Fish and Skin observations can still serve existing profession facts", () => {
  const before = JSON.parse(encodeProfessions(buildProfessions(corpus), asOf));
  delete before.set.gathering;
  delete before.revision;
  const parsed = parseProfessions(JSON.stringify(before));
  expect(parsed?.set.sightings).toHaveLength(3);
  expect(parsed?.set.gathering).toBeUndefined();
});

test("an idle run only checks the file's stamp; a missing, unstamped or older file and a rebuild write it", async () => {
  const build = vi.fn(async () => buildProfessions(corpus));
  const stamped = (stamp?: string) => new Response(null, { headers: stamp ? { "x-amz-meta-data-as-of": stamp } : {} });
  const current = stampOf(asOf, PROFESSIONS_REVISION);
  const doFetch = vi.fn(async (input: RequestInfo | URL) => (input as Request).method === "PUT" ? new Response(null) : stamped(current));
  expect(await writeProfessions({ added: 0, dataAsOf: asOf }, { cloud, fetch: doFetch, build })).toEqual({ written: false });
  expect(build).not.toHaveBeenCalled();
  doFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
  await writeProfessions({ added: 0, dataAsOf: asOf }, { cloud, fetch: doFetch, build });
  // A file from before the stamp, or one built from an older snapshot (a write that failed after new uploads).
  doFetch.mockResolvedValueOnce(stamped());
  await writeProfessions({ added: 0, dataAsOf: asOf }, { cloud, fetch: doFetch, build });
  doFetch.mockResolvedValueOnce(stamped("2026-11-08T00:00:00.000Z"));
  await writeProfessions({ added: 0, dataAsOf: asOf }, { cloud, fetch: doFetch, build });
  // Same input data, but an earlier writer did not include fishing and skinning, so backfill even on an idle cron.
  doFetch.mockResolvedValueOnce(stamped(asOf));
  await writeProfessions({ added: 0, dataAsOf: asOf }, { cloud, fetch: doFetch, build });
  await writeProfessions({ added: 0, rebuild: true, dataAsOf: asOf }, { cloud, fetch: doFetch, build });
  expect(build).toHaveBeenCalledTimes(5);
  const puts = doFetch.mock.calls.map(([req]) => req as Request).filter((req) => req.method === "PUT");
  expect(puts.map((req) => req.headers.get("x-amz-meta-data-as-of"))).toEqual(Array(5).fill(current));
  // With no snapshot time the stamp says so, and a matching idle run still skips.
  doFetch.mockResolvedValueOnce(stamped(stampOf(null, PROFESSIONS_REVISION)));
  expect(await writeProfessions({ added: 0, dataAsOf: null }, { cloud, fetch: doFetch, build })).toEqual({ written: false });
});

test("the file is kept for five minutes and revalidated by ETag", async () => {
  const doFetch = vi.fn(async (_input: RequestInfo | URL) => new Response(encodeProfessions(buildProfessions(corpus), asOf), { headers: { etag: "v1" } }));
  const first = await loadStoredProfessions({ cloud, fetch: doFetch, now: () => 0 });
  expect(await loadStoredProfessions({ cloud, fetch: doFetch, now: () => 299999 })).toBe(first);
  expect(doFetch).toHaveBeenCalledTimes(1);
  doFetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
  expect(await loadStoredProfessions({ cloud, fetch: doFetch, now: () => 300000 })).toBe(first);
  expect((doFetch.mock.calls[1][0] as Request).headers.get("if-none-match")).toBe("v1");
});

test.each(["missing", "invalid", "failed"])("a %s file falls back and unreadable corpus stays unrecorded", async (mode) => {
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (mode === "failed") throw new Error("offline");
    return new Response("{}", { status: mode === "missing" ? 404 : 200 });
  }));
  expect(await loadProfessions()).toMatchObject({ ...buildProfessions(corpus), unreachable: false });
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  expect(await loadProfessions()).toMatchObject({ unreachable: true, dataAsOf: null });
});

test("a failed write does not claim success", async () => {
  await expect(writeProfessions({ added: 1, dataAsOf: asOf }, { cloud, fetch: async () => new Response(null, { status: 503 }) })).rejects.toThrow("write failed");
});

test("the file holds the reported rows only; the derived steps come from the build reading it", async () => {
  const ids = ["a", "b", "c"];
  const reagents = [{ item: "Peacebloom", count: 1 }];
  const records = [
    ...[1, 10, 12].map((rank, i) => ({ kind: "recipe_observed", installId: ids[i], profession: "Alchemy", recipe: "Lesser Healing Potion", rank, difficulty: i === 2 ? "medium" : "optimal", reagents, capturedAt: asOf })),
    ...ids.map((installId) => ({ kind: "trainer_seen", installId, profession: "Alchemy", recipe: "Lesser Healing Potion", requiredRank: 1 })),
  ];
  const set = buildProfessions({ records, dataAsOf: asOf });
  expect(set.facts.derived.length).toBeGreaterThan(0);
  const body = encodeProfessions(set, asOf);
  expect(JSON.parse(body).set.facts).not.toHaveProperty("derived");
  expect(parseProfessions(body)?.set).toEqual(set);
  // A file written by an older build, with steps that build derived, gets this build's steps.
  const old = JSON.parse(body);
  old.set.facts.derived = [{ profession: "Alchemy", recipe: "Stale Step", skillMin: 1, skillMax: 2, points: 1, reagents: [], reporters: 3, trainingCopper: null }];
  expect(parseProfessions(JSON.stringify(old))?.set.facts.derived).toEqual(set.facts.derived);
});

test("the file is parsed without a reviver, and its Maps come back as the reviver gave them, nested ones and a \"__proto__\" key included", () => {
  const good = JSON.parse(encodeProfessions(buildProfessions(corpus), asOf));
  const text = JSON.stringify({ ...good, set: { ...good.set, odd: {
    nested: { $map: [[1, { $map: [["in", [{ $map: [] }]]] }]] },
    notTagged: [{ $map: "no array" }, { $set: [1] }, { $map: [], other: 1 }],
    ["__proto__"]: { $map: [[1, 2]] },
  } } });
  // The reviver this replaced, as the reference: Maps only, as the file is written with Maps only.
  const reviver = (_: string, value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === 1 && Array.isArray((value as { $map?: unknown }).$map) ? new Map((value as { $map: [unknown, unknown][] }).$map) : value;
  const expected = JSON.parse(text, reviver).set;
  const parse = vi.spyOn(JSON, "parse");
  try {
    const read = parseProfessions(text);
    expect(parse.mock.calls.every((call) => call[1] === undefined)).toBe(true);
    const { derived: _derived, ...facts } = read!.set.facts;
    expect({ ...read!.set, facts }).toEqual(expected);
    const odd = (read!.set as unknown as { odd: Record<string, unknown> }).odd;
    expect(odd.nested).toEqual(new Map<unknown, unknown>([[1, new Map([["in", [new Map()]]])]]));
    expect(odd.notTagged).toEqual([{ $map: "no array" }, { $set: [1] }, { $map: [], other: 1 }]);
    expect(Object.getPrototypeOf(odd)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(odd, "__proto__")?.value).toEqual(new Map([[1, 2]]));
  } finally {
    parse.mockRestore();
  }
});

test("a file with characters past U+00FF is parsed from one-byte ASCII text, to the same value", async () => {
  const good = JSON.parse(encodeProfessions(buildProfessions(corpus), asOf));
  const note = "страж смерти “Оливер”";
  const parse = vi.spyOn(JSON, "parse");
  try {
    const read = await loadStoredProfessions({ cloud, fetch: async () => new Response(JSON.stringify({ ...good, set: { ...good.set, note } })), now: () => 0 });
    const texts = parse.mock.calls.map((call) => call[0]).filter((t) => typeof t === "string" && t.includes("generatedAt"));
    expect(texts).toHaveLength(1);
    expect([...texts[0]].every((c) => c.charCodeAt(0) < 0x80)).toBe(true);
    expect((read as unknown as { note: string }).note).toBe(note);
  } finally {
    parse.mockRestore();
  }
});

test("item-id vendor prices and trainer spell ids are stored beside the old fields; an older file reads with no item-id prices", () => {
  const records = [
    ...["a", "b", "c"].map((installId) => ({ kind: "vendor", installId, vendorNpcId: 1, items: [{ itemId: 2320, priceCopper: 10 }, { itemId: 2321, priceCopper: 0 }], capturedAt: asOf })),
    ...["a", "b", "c"].map((installId) => ({ kind: "trainer_seen", installId, profession: "Alchemy", recipe: "Lesser Healing Potion", spellId: 2337, productItemId: 858, requiredRank: 55, costCopper: 250, capturedAt: asOf })),
  ];
  const set = buildProfessions({ records, dataAsOf: asOf });
  expect(set.facts.vendorPricesById).toEqual(new Map([[2320, 10]]));
  const body = encodeProfessions(set, asOf);
  const read = parseProfessions(body)!.set;
  expect(read).toEqual(set);
  expect(read.facts.trainers[0]).toMatchObject({ spellId: 2337, productItemId: 858 });
  // A file written before item-id prices existed: the old fields read as before, and item-id prices are unavailable, not guessed from names.
  const old = JSON.parse(body);
  delete old.set.facts.vendorPricesById;
  const fallback = parseProfessions(JSON.stringify(old))!.set;
  expect(fallback.facts.vendorPricesById).toEqual(new Map());
  expect(fallback.facts.vendorPrices).toEqual(set.facts.vendorPrices);
  // Anything else in that slot is not a price list.
  old.set.facts.vendorPricesById = [[2320, 10]];
  expect(parseProfessions(JSON.stringify(old))).toBeNull();
});
