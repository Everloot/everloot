import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { cloudConfig, createUploadStore, type CloudConfig } from "./upload-store.js";

const cloud: CloudConfig = {
  r2AccountId: "acct",
  r2AccessKeyId: "AKID",
  r2SecretAccessKey: "secret",
  r2Bucket: "everloot-uploads",
  supabaseUrl: "https://sb.example",
  supabaseServiceKey: "svc",
};

interface Call { url: string; method: string; headers: Headers; body: string }

/** A fetch that records every call and answers from a list of [url-prefix, method, response] routes. */
function fakeFetch(routes: Array<[string, string, () => Response]>) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    calls.push({ url: req.url, method: req.method, headers: req.headers, body: await req.text() });
    const hit = routes.find(([prefix, method]) => req.url.startsWith(prefix) && req.method === method);
    const response = hit ? hit[2]() : new Response("no route", { status: 404 });
    if (response.ok && req.method === "GET") response.headers.set("etag", '"fixture"');
    return response;
  }) as typeof fetch;
  return { fn, calls };
}

const R2 = "https://acct.r2.cloudflarestorage.com/everloot-uploads/";
const now = () => new Date("2026-10-04T12:00:00Z");
const capturedAt = "2026-10-04T07:00:00.000Z";

/** Schema-valid records: a corpus normalizer parses stored rows, so a kind-only fixture is not a fixture. */
const lootRow = (over: Record<string, unknown> = {}) => ({
  kind: "loot" as const,
  eventId: "event:1",
  installId: "install-1",
  capturedAt,
  sourceNpcId: 1234,
  items: [{ itemId: 456, count: 2 }],
  ...over,
});
const questRow = () => ({
  kind: "quest",
  eventId: "event:2",
  installId: "install-1",
  capturedAt,
  questId: 55,
  title: "Road to Westfall",
  level: 12,
  rewardItemIds: [],
});
const npcRow = () => ({
  kind: "npc_sighting" as const,
  eventId: "event:3",
  installId: "install-1",
  capturedAt,
  npcId: 1234,
  name: "Forest Spider",
  mapId: 141,
  x: 42.5,
  y: 61,
  level: 60,
  reaction: "hostile" as const,
});
const vendorRow = () => ({
  kind: "vendor",
  eventId: "event:4",
  installId: "install-1",
  capturedAt,
  vendorNpcId: 7,
  items: [{ itemId: 456, priceCopper: 100 }],
});

const payload = { addonVersion: "0.1.0", records: [lootRow(), npcRow()] };

test.each(["2026-10-04T00:01:00Z", "2026-10-03T23:59:00Z"])("idle market folds only across a UTC day (%s)", async generatedAt => {
  const { fn, calls } = fakeFetch([
    [`${R2}snapshots/market.json`, "GET", () => Response.json({ version: 3, generatedAt, state: { version: 3, realms: {} }, seenUploadIds: [] })],
    ["https://sb.example/rest/v1/uploads", "GET", () => Response.json([])],
    [`${R2}snapshots/market.json`, "PUT", () => new Response(null)],
  ]);
  const result = await createUploadStore({ cloud, localDir: "unused", fetch: fn, now }).writeMarket({ idle: true });
  const sameDay = generatedAt.startsWith("2026-10-04");
  expect(result.skipped === true).toBe(sameDay);
  expect(calls.some(c => new URL(c.url).origin === "https://sb.example")).toBe(!sameDay);
  expect(calls.some(c => c.method === "PUT")).toBe(!sameDay);
});

test("idle probe is one strict watermark query with limit one and no corpus rewrite", async () => {
  const { fn, calls } = fakeFetch([
    [`${R2}snapshots/corpus.json`, "GET", () => Response.json({ records: [], generatedAt: "2026-09-27", lastReceivedAt: capturedAt })],
    ["https://sb.example/rest/v1/uploads", "GET", () => Response.json([])],
    [`${R2}cron/last-run.json`, "GET", () => Response.json({ dataAsOf: "2026-09-27", completionPending: false, settledWeek: "2026-W39" })],
  ]);
  const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now });
  expect(await store.snapshotWork()).toEqual({ idle: true, retryRollups: false, dataAsOf: "2026-09-27", settledWeek: "2026-W39" });
  const index = calls.filter(c => new URL(c.url).origin === "https://sb.example");
  expect(index).toHaveLength(1);
  expect(new URL(index[0].url).searchParams.get("limit")).toBe("1");
  expect(new URL(index[0].url).searchParams.get("received_at")).toBe(`gt.${capturedAt}`);
  expect(calls.every(c => c.method === "GET")).toBe(true);
});

test.each([
  ["a rejected fetch", () => { throw new Error("network down"); }],
  ["malformed JSON", () => new Response("{not json", { status: 200 })],
])("a non-idle heartbeat failure (%s) does not block pending uploads", async (_name, heartbeat) => {
  const { fn } = fakeFetch([
    [`${R2}snapshots/corpus.json`, "GET", () => Response.json({ records: [], generatedAt: "2026-09-27", lastReceivedAt: capturedAt })],
    ["https://sb.example/rest/v1/uploads", "GET", () => Response.json([{ id: "u-2" }])],
    [`${R2}cron/last-run.json`, "GET", heartbeat],
  ]);
  expect(await createUploadStore({ cloud, localDir: "unused", fetch: fn, now }).snapshotWork()).toEqual({
    idle: false, retryRollups: false, dataAsOf: "2026-09-27", settledWeek: null,
  });
});

test.each(["2026-09-26", "2026-09-27"])("idle probe retries an unfinished fold (%s)", async dataAsOf => {
  const { fn } = fakeFetch([
    [`${R2}snapshots/corpus.json`, "GET", () => Response.json({ records: [], generatedAt: "2026-09-27" })],
    ["https://sb.example/rest/v1/uploads", "GET", () => Response.json([])],
    [`${R2}cron/last-run.json`, "GET", () => Response.json({ dataAsOf, completionPending: true })],
  ]);
  expect((await createUploadStore({ cloud, localDir: "unused", fetch: fn, now }).snapshotWork()).retryRollups).toBe(true);
});

describe("upload store, cloud mode", () => {
  test("a stored upload is a signed R2 object plus one index row", async () => {
    const { fn, calls } = fakeFetch([
      [R2, "PUT", () => new Response(null, { status: 200 })],
      ["https://sb.example/rest/v1/uploads", "POST", () => new Response(null, { status: 201 })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now });
    expect(await store.putUpload("u-1", "install-1", payload)).toBe(true);

    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toBe(`${R2}uploads/2026-10-04/u-1.json`);
    expect(calls[0].headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(JSON.parse(calls[0].body)).toEqual(payload);

    expect(calls[1].headers.get("apikey")).toBe("svc");
    expect(JSON.parse(calls[1].body)).toEqual({
      id: "u-1",
      install_id: "install-1",
      record_count: 2,
      bytes: JSON.stringify(payload).length,
      object_key: "uploads/2026-10-04/u-1.json",
    });
  });

  test("an R2 failure is not persisted and writes no index row", async () => {
    const { fn, calls } = fakeFetch([[R2, "PUT", () => new Response("down", { status: 500 })]]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now });
    expect(await store.putUpload("u-1", "install-1", payload)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("an R2 put whose fetch rejects names the R2 half, not the store", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fn } = fakeFetch([[R2, "PUT", () => { throw new TypeError("fetch failed"); }]]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: fn, now }).putUpload("u-1", "install-1", payload)).toBe(false);
    expect(log).toHaveBeenLastCalledWith("upload u-1: R2 put failed", expect.any(TypeError));
    log.mockRestore();
  });

  test("an index failure is not persisted, because the reader only sees indexed uploads", async () => {
    const { fn } = fakeFetch([
      [R2, "PUT", () => new Response(null, { status: 200 })],
      ["https://sb.example/rest/v1/uploads", "POST", () => new Response("bad", { status: 400 })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now });
    expect(await store.putUpload("u-1", "install-1", payload)).toBe(false);
  });

  test("each half of a failed store names itself in the log, with the body that says why", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r2Down = fakeFetch([[R2, "PUT", () => new Response("<Code>AccessDenied</Code>", { status: 403 })]]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: r2Down.fn, now }).putUpload("u-1", "install-1", payload)).toBe(false);
    expect(log).toHaveBeenLastCalledWith("upload u-1: R2 put failed (403): <Code>AccessDenied</Code>");
    // A row the table refuses is refused again, so it is tried once.
    const refused = fakeFetch([
      [R2, "PUT", () => new Response(null, { status: 200 })],
      ["https://sb.example/rest/v1/uploads", "POST", () => Response.json({ code: "22P05", message: "unsupported Unicode escape sequence" }, { status: 400 })],
    ]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: refused.fn, now }).putUpload("u-2", "install-1", payload)).toBe(false);
    expect(refused.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^upload u-2: R2 object stored but index insert failed \(400\): .*22P05/));
    log.mockRestore();
  });

  test.each([
    ["a 5xx", () => new Response("upstream", { status: 503 })],
    ["a dropped connection", () => { throw new TypeError("fetch failed"); }],
  ])("an index insert that fails with %s is tried once more", async (_, first) => {
    let posts = 0;
    const { fn, calls } = fakeFetch([
      [R2, "PUT", () => new Response(null, { status: 200 })],
      ["https://sb.example/rest/v1/uploads", "POST", () => (++posts === 1 ? first() : new Response(null, { status: 201 }))],
    ]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: fn, now }).putUpload("u-1", "install-1", payload)).toBe(true);
    const inserts = calls.filter((c) => c.method === "POST");
    expect(inserts).toHaveLength(2);
    expect(inserts[1].body).toBe(inserts[0].body);
  });

  test("a 409 on the second try is the first try's row, so the upload is stored", async () => {
    let posts = 0;
    const { fn } = fakeFetch([
      [R2, "PUT", () => new Response(null, { status: 200 })],
      ["https://sb.example/rest/v1/uploads", "POST", () => {
        if (++posts === 1) throw new TypeError("fetch failed");
        return Response.json({ code: "23505" }, { status: 409 });
      }],
    ]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: fn, now }).putUpload("u-1", "install-1", payload)).toBe(true);
  });

  test("an index insert that fails twice is not persisted", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fn, calls } = fakeFetch([
      [R2, "PUT", () => new Response(null, { status: 200 })],
      ["https://sb.example/rest/v1/uploads", "POST", () => new Response("upstream", { status: 503 })],
    ]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: fn, now }).putUpload("u-1", "install-1", payload)).toBe(false);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
    expect(log).toHaveBeenCalledWith("upload u-1: R2 object stored but index insert failed (503): upstream");
    log.mockRestore();
  });

  test("the corpus reads indexed objects, skips a corrupt one, and caches", async () => {
    const { fn, calls } = fakeFetch([
      ["https://sb.example/rest/v1/uploads", "GET", () => Response.json([{ object_key: "uploads/a.json" }, { object_key: "uploads/b.json" }])],
      [`${R2}uploads/a.json`, "GET", () => Response.json({ records: [lootRow(), questRow()] })],
      [`${R2}uploads/b.json`, "GET", () => new Response("{not json")],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now, cacheMs: 60_000 });
    const corpus = await store.loadCorpus();
    expect(corpus).toEqual({ uploads: 2, records: [lootRow(), questRow()], dataAsOf: "2026-10-04T12:00:00.000Z" });

    const before = calls.length;
    await store.loadCorpus();
    expect(calls.length).toBe(before);
  });

  test("a waitlist signup is one row, and a repeat is ignored by the table", async () => {
    const { fn, calls } = fakeFetch([["https://sb.example/rest/v1/waitlist", "POST", () => new Response(null, { status: 201 })]]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now });
    expect(await store.putWaitlist({ toolSlug: "auctions", email: "a@b.co", ts: "2026-10-04T12:00:00Z" })).toBe(true);
    expect(calls[0].headers.get("prefer")).toContain("resolution=ignore-duplicates");
    expect(JSON.parse(calls[0].body)).toEqual({ email: "a@b.co", tool_slug: "auctions", created_at: "2026-10-04T12:00:00Z" });
  });
});

describe("corpus snapshot", () => {
  const SNAP = `${R2}snapshots/corpus.json`;
  const INDEX = "https://sb.example/rest/v1/uploads";

  test("the first snapshot reads every indexed upload and records where it stopped", async () => {
    const { fn, calls } = fakeFetch([
      [SNAP, "GET", () => new Response("missing", { status: 404 })],
      [INDEX, "GET", () => Response.json([
        { id: "a", object_key: "uploads/a.json", received_at: "2026-10-04T07:00:00+00:00" },
        { id: "b", object_key: "uploads/b.json", received_at: "2026-10-04T08:00:00+00:00" },
      ])],
      [`${R2}uploads/a.json`, "GET", () => Response.json({ records: [lootRow()] })],
      [`${R2}uploads/b.json`, "GET", () => Response.json({ records: [questRow()] })],
      [SNAP, "PUT", () => new Response(null, { status: 200 })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now });
    expect(await store.writeSnapshot()).toMatchObject({ uploads: 2, added: 2 });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(JSON.parse(put.body)).toMatchObject({
      generatedAt: "2026-10-04T12:00:00.000Z",
      uploads: 2,
      records: [],
      lastReceivedAt: "2026-10-04T08:00:00+00:00",
      lastIds: ["b"],
    });
    expect(JSON.parse(put.body).corpusState.events.map((e: { record: unknown }) => e.record)).toEqual([lootRow(), questRow()]);
    expect(put.headers.get("if-none-match")).toBe("*");
  });

  test("a later snapshot reads only uploads it has not seen", async () => {
    const { fn, calls } = fakeFetch([
      [SNAP, "GET", () => Response.json({
        generatedAt: "x", uploads: 2, records: [lootRow(), questRow()],
        lastReceivedAt: "2026-10-04T08:00:00+00:00", lastIds: ["b"],
      })],
      [INDEX, "GET", () => Response.json([
        { id: "b", object_key: "uploads/b.json", received_at: "2026-10-04T08:00:00+00:00" },
        { id: "c", object_key: "uploads/c.json", received_at: "2026-10-04T09:00:00+00:00" },
      ])],
      [`${R2}uploads/c.json`, "GET", () => Response.json({ records: [vendorRow()] })],
      [SNAP, "PUT", () => new Response(null, { status: 200 })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now });
    expect(await store.writeSnapshot()).toMatchObject({ uploads: 3, added: 1 });
    expect(calls.some((c) => c.url.endsWith("uploads/b.json"))).toBe(false);
    expect(calls.find((c) => c.method === "GET" && c.url.startsWith(INDEX))!.url).toContain("received_at=gte.2026-10-04T08%3A00%3A00%2B00%3A00");
    const put = JSON.parse(calls.find((c) => c.method === "PUT")!.body);
    // Stored once, as replay events; the records array stays empty so the previous reader still opens the file.
    expect(put.records).toEqual([]);
    expect(put.corpusState.events.map((e: { record: unknown }) => e.record)).toEqual([lootRow(), questRow(), vendorRow()]);
    expect(put.lastIds).toEqual(["c"]);
  });

  test("an unreadable object is not a silent empty corpus and is not cached", async () => {
    const { fn, calls } = fakeFetch([
      [SNAP, "GET", () => new Response("missing", { status: 404 })],
      [INDEX, "GET", () => Response.json([{ object_key: "uploads/a.json" }])],
      [`${R2}uploads/a.json`, "GET", () => new Response("down", { status: 500 })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now, cacheMs: 60_000 });
    expect(await store.loadCorpus()).toEqual({ uploads: 0, records: [], unreachable: true });
    const before = calls.length;
    await store.loadCorpus();
    expect(calls.length).toBeGreaterThan(before);
  });

  test("a failed snapshot read is unreachable, not an empty corpus", async () => {
    const { fn } = fakeFetch([[SNAP, "GET", () => new Response("down", { status: 500 })]]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now, cacheMs: 60_000 });
    expect(await store.loadCorpus()).toEqual({ uploads: 0, records: [], unreachable: true });
  });

  test("a missed object is not written into the snapshot", async () => {
    const { fn, calls } = fakeFetch([
      [SNAP, "GET", () => new Response("missing", { status: 404 })],
      [INDEX, "GET", () => Response.json([{ id: "a", object_key: "uploads/a.json", received_at: "2026-10-04T07:00:00+00:00" }])],
      [`${R2}uploads/a.json`, "GET", () => new Response("down", { status: 500 })],
      [SNAP, "PUT", () => new Response(null, { status: 200 })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now });
    await expect(store.writeSnapshot()).rejects.toThrow(/unreadable/);
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  test("pages read the snapshot in one request when it exists", async () => {
    const { fn, calls } = fakeFetch([
      [SNAP, "GET", () => Response.json({ generatedAt: "x", uploads: 5, records: [lootRow()], lastReceivedAt: null, lastIds: [] })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now });
    expect(await store.loadCorpus()).toEqual({ uploads: 5, records: [lootRow()], dataAsOf: null });
    expect(calls).toHaveLength(1);
  });

  test("a snapshot read reports when the snapshot was built, not when the page asked", async () => {
    const { fn } = fakeFetch([
      [SNAP, "GET", () => Response.json({ generatedAt: "2026-10-04T11:50:00.000Z", uploads: 1, records: [lootRow()], lastReceivedAt: null, lastIds: [] })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now });
    expect((await store.loadCorpus()).dataAsOf).toBe("2026-10-04T11:50:00.000Z");
  });
});

describe("corpus normalization", () => {
  const SNAP = `${R2}snapshots/corpus.json`;
  const INDEX = "https://sb.example/rest/v1/uploads";
  const badRows: unknown[] = [
    { kind: "flying_mounts", installId: "install-1" },
    { ...lootRow(), sourceNpcId: 0, sourceObjectId: undefined },
    { ...lootRow(), capturedAt: "yesterday" },
    "not a record",
  ];

  test("a stored local file contributes only its valid records, and still counts as one upload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "everloot-corpus-"));
    mkdirSync(join(dir, "uploads"));
    writeFileSync(join(dir, "uploads", "u-1.json"), JSON.stringify({ addonVersion: "0.1.0", records: [lootRow(), ...badRows] }));
    const store = createUploadStore({ cloud: null, localDir: dir, now, cacheMs: 0 });

    expect(await store.loadCorpus()).toEqual({ uploads: 1, records: [lootRow()], dataAsOf: "2026-10-04T12:00:00.000Z" });
  });

  test("nested extra fields are stripped from a stored object", async () => {
    const dir = mkdtempSync(join(tmpdir(), "everloot-corpus-"));
    mkdirSync(join(dir, "uploads"));
    const nested = lootRow({ items: [{ itemId: 456, count: 2, smuggle: true }] });
    writeFileSync(join(dir, "uploads", "u-1.json"), JSON.stringify({ addonVersion: "0.1.0", records: [nested] }));
    const store = createUploadStore({ cloud: null, localDir: dir, now, cacheMs: 0 });

    expect(await store.loadCorpus()).toEqual({ uploads: 1, records: [lootRow()], dataAsOf: "2026-10-04T12:00:00.000Z" });
  });

  test("an existing snapshot is normalized on read and stays normalized in the cache", async () => {
    const { fn, calls } = fakeFetch([
      [SNAP, "GET", () => Response.json({
        generatedAt: "x", uploads: 1, records: [lootRow(), ...badRows],
        lastReceivedAt: null, lastIds: [],
      })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now, cacheMs: 60_000 });

    expect(await store.loadCorpus()).toEqual({ uploads: 1, records: [lootRow()], dataAsOf: null });
    expect(await store.loadCorpus()).toEqual({ uploads: 1, records: [lootRow()], dataAsOf: null });
    expect(calls).toHaveLength(1);
  });

  test("the next snapshot write normalizes the prior records it carries forward", async () => {
    const { fn, calls } = fakeFetch([
      [SNAP, "GET", () => Response.json({
        generatedAt: "x", uploads: 1, records: [lootRow(), ...badRows],
        lastReceivedAt: "2026-10-04T08:00:00+00:00", lastIds: ["b"],
      })],
      [INDEX, "GET", () => Response.json([
        { id: "c", object_key: "uploads/c.json", received_at: "2026-10-04T09:00:00+00:00" },
      ])],
      [`${R2}uploads/c.json`, "GET", () => Response.json({ records: [vendorRow(), ...badRows] })],
      [SNAP, "PUT", () => new Response(null, { status: 200 })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now });

    expect(await store.writeSnapshot()).toMatchObject({ uploads: 2, added: 1 });
    const put = JSON.parse(calls.find((c) => c.method === "PUT")!.body);
    expect(put.records).toEqual([]);
    expect(put.corpusState.events.map((e: { record: unknown }) => e.record)).toEqual([lootRow(), vendorRow()]);
  });

  test("a corpus larger than the 2000-row request cap keeps every valid record", async () => {
    // Distinct installs, not random ones: two random ids collided about 2% of runs and deduplicated to 2000.
    const records = Array.from({ length: 2001 }, (_, i) => lootRow({ installId: `install-${i}` }));
    const { fn } = fakeFetch([
      [SNAP, "GET", () => Response.json({ generatedAt: "x", uploads: 2001, records, lastReceivedAt: null, lastIds: [] })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now, cacheMs: 0 });

    const corpus = await store.loadCorpus();
    expect(corpus.records).toHaveLength(2001);
  });

  test("a snapshot with no records array is unreachable, not an empty corpus", async () => {
    const { fn } = fakeFetch([
      [SNAP, "GET", () => Response.json({ generatedAt: "x", uploads: 3, lastReceivedAt: null, lastIds: [] })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now, cacheMs: 0 });

    expect(await store.loadCorpus()).toEqual({ uploads: 0, records: [], unreachable: true });
  });
});

describe("upload store, local mode", () => {
  test("production without complete cloud configuration never writes to local disk", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const dir = join(mkdtempSync(join(tmpdir(), "everloot-prod-config-")), "missing");
      const store = createUploadStore({ cloud: null, localDir: dir });
      expect(await store.putUpload("u-1", "install-1", payload)).toBe(false);
      expect(await store.putWaitlist({ toolSlug: "tool", email: "user@example.test", ts: capturedAt })).toBe(false);
      expect((await store.loadCorpus()).unreachable).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });
  test("cloud mode needs every variable", () => {
    expect(cloudConfig({})).toBeNull();
    expect(cloudConfig({
      R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d",
      SUPABASE_URL: "https://e", SUPABASE_SERVICE_ROLE_KEY: "f",
    })).toEqual({
      r2AccountId: "a", r2AccessKeyId: "b", r2SecretAccessKey: "c", r2Bucket: "d",
      supabaseUrl: "https://e", supabaseServiceKey: "f",
    });
    expect(cloudConfig({ R2_ACCOUNT_ID: "a", SUPABASE_URL: "https://e" })).toBeNull();
  });

  test("without cloud variables an upload round-trips through the local folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "everloot-store-"));
    const store = createUploadStore({ cloud: null, localDir: dir, now, cacheMs: 0 });
    expect(await store.putUpload("u-1", "install-1", payload)).toBe(true);
    expect(await store.loadCorpus()).toEqual({ uploads: 1, records: payload.records, dataAsOf: "2026-10-04T12:00:00.000Z" });
  });

  test("a missing local directory is empty, not unreachable", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "everloot-store-")), "missing");
    const store = createUploadStore({ cloud: null, localDir: dir, now, cacheMs: 0 });
    expect(await store.loadCorpus()).toEqual({ uploads: 0, records: [], dataAsOf: "2026-10-04T12:00:00.000Z" });
  });
});

describe("market rollup", () => {
  const MARKET = `${R2}snapshots/market.json`;
  const INDEX = "https://sb.example/rest/v1/uploads";
  // Three installs on one day make the item public (kb/src/market.ts).
  const scan = (installId: string, minUnit: number) => ({
    kind: "auction_snapshot", eventId: `scan:${installId}`, installId, capturedAt,
    realm: "Forever", scanId: `scan-${installId}`, part: 1, parts: 1, items: [[2589, 3, 60, minUnit, minUnit + 5]],
  });
  const index = (ids: string[]) => ids.map((id, i) => ({ id, object_key: `uploads/${id}.json`, received_at: `2026-10-04T0${i}:00:00+00:00` }));

  test("the first rollup reads every upload, keeps only full scans, and creates the object", async () => {
    const { fn, calls } = fakeFetch([
      [MARKET, "GET", () => new Response("missing", { status: 404 })],
      [INDEX, "GET", () => Response.json(index(["a", "b", "c"]))],
      [`${R2}uploads/a.json`, "GET", () => Response.json({ records: [scan("install-1", 100), lootRow()] })],
      [`${R2}uploads/b.json`, "GET", () => Response.json({ records: [scan("install-2", 200)] })],
      [`${R2}uploads/c.json`, "GET", () => Response.json({ records: [scan("install-3", 300)] })],
      [MARKET, "PUT", () => new Response(null, { status: 200 })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now });
    expect(await store.writeMarket()).toEqual({ added: 3, scans: 3 });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("if-none-match")).toBe("*");
    const body = JSON.parse(put.body);
    expect(body).toMatchObject({ version: 3, generatedAt: "2026-10-04T12:00:00.000Z", seenUploadIds: ["a", "b", "c"] });
    expect(Object.keys(body.state.realms.forever.items)).toEqual(["2589"]);
    // Uploads older than the 60-day history can only hold pruned days, so they are never read.
    expect(calls.find((c) => c.url.startsWith(INDEX))!.url).toContain("received_at=gte.2026-08-03T12%3A00%3A00.000Z");
  });

  test("a later rollup reads only unseen uploads and replaces the object it read", async () => {
    const { fn, calls } = fakeFetch([
      [MARKET, "GET", () => Response.json({ version: 3, generatedAt: "x", state: { version: 3, realms: {} }, seenUploadIds: ["a", "gone"] })],
      [INDEX, "GET", () => Response.json(index(["a", "b"]))],
      [`${R2}uploads/b.json`, "GET", () => Response.json({ records: [scan("install-2", 200)] })],
      [MARKET, "PUT", () => new Response(null, { status: 200 })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now });
    expect(await store.writeMarket()).toEqual({ added: 1, scans: 1 });
    expect(calls.some((c) => c.url.endsWith("uploads/a.json"))).toBe(false);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("if-match")).toBe('"fixture"');
    // Ids that left the window are forgotten, so the list stays bounded.
    expect(JSON.parse(put.body).seenUploadIds).toEqual(["a", "b"]);
  });

  test("an unreadable upload writes nothing, so it is read again next time", async () => {
    const { fn, calls } = fakeFetch([
      [MARKET, "GET", () => new Response("missing", { status: 404 })],
      [INDEX, "GET", () => Response.json(index(["a"]))],
      [`${R2}uploads/a.json`, "GET", () => new Response("down", { status: 500 })],
    ]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now });
    await expect(store.writeMarket()).rejects.toThrow(/unreadable/);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  test("pages read the rollup; a missing or failed one is unavailable, never an empty market", async () => {
    const state = { version: 3, realms: {} };
    const ok = fakeFetch([[MARKET, "GET", () => Response.json({ version: 3, generatedAt: "2026-10-04T11:50:00.000Z", state, seenUploadIds: [] })]]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: ok.fn, now }).loadMarket())
      .toEqual({ state, dataAsOf: "2026-10-04T11:50:00.000Z" });
    // Before the first cron run there is no rollup: that is not "no scans uploaded".
    const missing = fakeFetch([[MARKET, "GET", () => new Response("missing", { status: 404 })]]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: missing.fn, now }).loadMarket())
      .toEqual({ state: null, dataAsOf: null, unreachable: true });
    const down = fakeFetch([[MARKET, "GET", () => new Response("down", { status: 500 })]]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: down.fn, now }).loadMarket())
      .toEqual({ state: null, dataAsOf: null, unreachable: true });
  });

  test("local mode folds the local uploads on read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "everloot-market-"));
    mkdirSync(join(dir, "uploads"));
    ["install-1", "install-2", "install-3"].forEach((id, i) =>
      writeFileSync(join(dir, "uploads", `${id}.json`), JSON.stringify({ records: [scan(id, (i + 1) * 100)] })));
    const market = await createUploadStore({ cloud: null, localDir: dir, now, cacheMs: 0 }).loadMarket();
    expect(market.dataAsOf).toBe("2026-10-04T12:00:00.000Z");
    expect(Object.keys(market.state!.realms.forever.items["2589"].open["2026-10-04"])).toHaveLength(3);
  });

  test("installs behind one upload address count once in the rollup", async () => {
    const same = "0123456789abcdef";
    const { fn, calls } = fakeFetch([
      [MARKET, "GET", () => new Response("missing", { status: 404 })],
      [INDEX, "GET", () => Response.json(index(["a", "b", "c"]))],
      [`${R2}uploads/a.json`, "GET", () => Response.json({ reporter: same, records: [scan("install-1", 100)] })],
      [`${R2}uploads/b.json`, "GET", () => Response.json({ reporter: same, records: [scan("install-2", 200)] })],
      [`${R2}uploads/c.json`, "GET", () => Response.json({ reporter: same, records: [scan("install-3", 300)] })],
      [MARKET, "PUT", () => new Response(null, { status: 200 })],
    ]);
    await createUploadStore({ cloud, localDir: "unused", fetch: fn, now }).writeMarket();
    const body = JSON.parse(calls.find((c) => c.method === "PUT")!.body);
    const open = body.state.realms.forever.items["2589"].open["2026-10-04"];
    expect(Object.values(open).map((v) => (v as unknown[])[5])).toEqual([same, same, same]);
    // Three installs, one address: not a public day.
    const { itemMarket } = await import("../../../kb/src/market");
    expect(itemMarket(body.state, "Forever", 2589, now()).points).toEqual([]);
  });

  test("an upload names at most 3 realms in the rollup, whatever its file says", async () => {
    const realms = ["Aaa", "Bbb", "Ccc", "Ddd", "Eee"];
    const { fn, calls } = fakeFetch([
      [MARKET, "GET", () => new Response("missing", { status: 404 })],
      [INDEX, "GET", () => Response.json(index(["a"]))],
      [`${R2}uploads/a.json`, "GET", () => Response.json({ records: realms.map((realm) => ({ ...scan("install-1", 100), realm })) })],
      [MARKET, "PUT", () => new Response(null, { status: 200 })],
    ]);
    await createUploadStore({ cloud, localDir: "unused", fetch: fn, now }).writeMarket();
    expect(Object.keys(JSON.parse(calls.find((c) => c.method === "PUT")!.body).state.realms)).toEqual(["aaa", "bbb", "ccc"]);
  });

  test("a rollup past its size limit is not written, and one past it on read is unavailable", async () => {
    const big = fakeFetch([
      [MARKET, "GET", () => new Response("missing", { status: 404 })],
      [INDEX, "GET", () => Response.json(index(["a"]))],
      [`${R2}uploads/a.json`, "GET", () => Response.json({ records: [scan("install-1", 100)] })],
    ]);
    await expect(createUploadStore({ cloud, localDir: "unused", fetch: big.fn, now, marketMaxBytes: 200 }).writeMarket()).rejects.toThrow(/size limit/);
    expect(big.calls.some((c) => c.method === "PUT")).toBe(false);
    const state = { version: 3, realms: {} };
    const stored = JSON.stringify({ version: 3, generatedAt: "2026-10-04T11:50:00.000Z", state, seenUploadIds: [] });
    const read = fakeFetch([[MARKET, "GET", () => new Response(stored, { headers: { etag: '"fixture"' } })]]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: read.fn, now, marketMaxBytes: stored.length - 1 }).loadMarket())
      .toEqual({ state: null, dataAsOf: null, unreachable: true });
  });

  test("a rollup in an old or unknown shape stops a normal run but a rebuild replaces it", async () => {
    const routes = (): Parameters<typeof fakeFetch>[0] => [
      [MARKET, "GET", () => Response.json({ version: 2, state: { version: 2, realms: {} }, seenUploadIds: [] })],
      [INDEX, "GET", () => Response.json(index(["a"]))],
      [`${R2}uploads/a.json`, "GET", () => Response.json({ records: [scan("install-1", 100)] })],
      [MARKET, "PUT", () => new Response(null, { status: 200 })],
    ];
    const stuck = fakeFetch(routes());
    await expect(createUploadStore({ cloud, localDir: "unused", fetch: stuck.fn, now }).writeMarket()).rejects.toThrow(/rebuild/);
    expect(stuck.calls.some((c) => c.method === "PUT")).toBe(false);
    const rebuilt = fakeFetch(routes());
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: rebuilt.fn, now }).writeMarket({ rebuild: true })).toEqual({ added: 1, scans: 1 });
    expect(rebuilt.calls.find((c) => c.method === "PUT")!.headers.get("if-match")).toBe('"fixture"');
  });
});

describe("completion rollup", () => {
  const COMPLETION = `${R2}snapshots/completion.json`;
  const INDEX = "https://sb.example/rest/v1/uploads";
  const title = (installId: string, n: number) => ({ kind: "title_catalog", eventId: `t:${installId}:${n}`, installId, capturedAt, titleId: 4, name: "Private" });
  const index = (ids: string[]) => ids.map((id, i) => ({ id, object_key: `uploads/${id}.json`, received_at: `2026-10-04T0${i}:00:00+00:00` }));

  test("the cron folds uploads into its own object, and the next run starts after the last one it read", async () => {
    const first = fakeFetch([
      [COMPLETION, "GET", () => new Response("missing", { status: 404 })],
      [INDEX, "GET", () => Response.json(index(["a", "b"]))],
      [`${R2}uploads/a.json`, "GET", () => Response.json({ records: [title("install-1", 1), lootRow()] })],
      [`${R2}uploads/b.json`, "GET", () => Response.json({ records: [title("install-2", 1)] })],
      [COMPLETION, "PUT", () => new Response(null, { status: 200 })],
    ]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: first.fn, now }).writeCompletion()).toEqual({ added: 2, remaining: 0, trimmed: 0, rebuilding: false });
    const put = first.calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("if-none-match")).toBe("*");
    const stored = JSON.parse(put.body);
    expect(stored).toMatchObject({ version: 2, lastReceivedAt: "2026-10-04T01:00:00+00:00", lastIds: ["b"] });
    expect(stored.state.catalog.t["4"][0].v).toEqual(["i:install-1", "i:install-2"]);

    const second = fakeFetch([
      [COMPLETION, "GET", () => Response.json(stored)],
      [INDEX, "GET", () => Response.json([...index(["a", "b"]).slice(1), { id: "c", object_key: "uploads/c.json", received_at: "2026-10-04T02:00:00+00:00" }])],
      [`${R2}uploads/c.json`, "GET", () => Response.json({ records: [title("install-3", 1)] })],
      [COMPLETION, "PUT", () => new Response(null, { status: 200 })],
    ]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: second.fn, now }).writeCompletion()).toEqual({ added: 1, remaining: 0, trimmed: 0, rebuilding: false });
    expect(second.calls.find((c) => c.url.startsWith(INDEX))!.url).toContain("received_at=gte.2026-10-04T01%3A00%3A00%2B00%3A00");
    expect(second.calls.some((c) => c.url.endsWith("uploads/b.json"))).toBe(false);
    const put2 = second.calls.find((c) => c.method === "PUT")!;
    expect(put2.headers.get("if-match")).toBe('"fixture"');
    expect(JSON.parse(put2.body).state.catalog.t["4"][0].v).toHaveLength(3);
  });

  test("the corpus every page reads carries no completion row; only the completion read does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "everloot-completion-"));
    mkdirSync(join(dir, "uploads"));
    ["install-1", "install-2", "install-3"].forEach((id) =>
      writeFileSync(join(dir, "uploads", `${id}.json`), JSON.stringify({ records: [title(id, 1), { ...lootRow(), installId: id, eventId: `l:${id}` }] })));
    const store = createUploadStore({ cloud: null, localDir: dir, now, cacheMs: 0 });
    const corpus = await store.loadCorpus();
    expect(corpus.records.length).toBeGreaterThan(0);
    expect(corpus.records.some((r) => (r as { kind: string }).kind === "title_catalog")).toBe(false);
    const completion = await store.loadCompletion();
    expect(completion.state!.catalog.t["4"][0].v).toHaveLength(3);
  });

  test("a missing or failed rollup is unavailable, never an empty one", async () => {
    const missing = fakeFetch([[COMPLETION, "GET", () => new Response("missing", { status: 404 })]]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: missing.fn, now }).loadCompletion())
      .toEqual({ state: null, dataAsOf: null, unreachable: true });
    const odd = fakeFetch([[COMPLETION, "GET", () => Response.json({ version: 2, state: { version: 1 }, lastIds: [] })]]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: odd.fn, now }).loadCompletion())
      .toEqual({ state: null, dataAsOf: null, unreachable: true });
  });

  /** R2 and the upload index in memory: objects are really stored, and the index honours received_at=gte. */
  function memoryCloud(uploads: Record<string, unknown>, rows: { id: string; object_key: string; received_at: string }[], onPut?: (key: string) => void) {
    const objects = new Map<string, string>();
    const etags = new Map<string, string>();
    let version = 0;
    const reads: string[] = [];
    const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.url.startsWith(INDEX)) {
        const since = /received_at=gte\.([^&]+)/.exec(req.url);
        return Response.json(rows.filter((r) => !since || r.received_at >= decodeURIComponent(since[1])));
      }
      const key = decodeURIComponent(new URL(req.url).pathname.split("/everloot-uploads/")[1]);
      if (key.startsWith("uploads/")) {
        reads.push(key);
        return key in uploads ? Response.json(uploads[key]) : new Response("gone", { status: 404 });
      }
      if (req.method === "GET") return objects.has(key) ? new Response(objects.get(key), { headers: { etag: etags.get(key)! } }) : new Response("missing", { status: 404 });
      if (req.method === "HEAD") return objects.has(key) ? new Response(null, { headers: { etag: etags.get(key)! } }) : new Response(null, { status: 404 });
      if (req.method === "PUT") {
        objects.set(key, await req.text()); etags.set(key, `"v${++version}"`);
        onPut?.(key);
        return new Response(null, { status: 200 });
      }
      if (req.method === "DELETE") {
        const match = req.headers.get("if-match");
        if (match && match !== etags.get(key)) return new Response(null, { status: 412 });
        objects.delete(key); etags.delete(key);
        return new Response(null, { status: 204 });
      }
      return new Response("no route", { status: 404 });
    }) as typeof fetch;
    /** Another run writing an object directly (a concurrent ?rebuild=1). */
    const write = (key: string, body: string) => { objects.set(key, body); etags.set(key, `"v${++version}"`); };
    return { fn, objects, reads, write };
  }
  const SERVED = "snapshots/completion.json";
  const REBUILD = "snapshots/completion-rebuild.json";
  const stamp = (i: number) => `2026-10-04T0${Math.floor(i / 3600)}:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}+00:00`;
  const many = (n: number) => {
    const rows = Array.from({ length: n }, (_, i) => ({ id: `u${i}`, object_key: `uploads/u${i}.json`, received_at: stamp(i) }));
    const uploads: Record<string, unknown> = Object.fromEntries(rows.map((r, i) => [r.object_key, { records: [title(`install-${i}`, 1)] }]));
    return { rows, uploads };
  };

  test("a run folds at most a batch; a rebuild is folded aside and replaces the served rollup only when complete", async () => {
    const { rows, uploads } = many(3);
    const mem = memoryCloud(uploads, rows);
    const store = () => createUploadStore({ cloud, localDir: "unused", fetch: mem.fn, now, completionBatch: 2 });
    const voters = (key: string) => JSON.parse(mem.objects.get(key)!).state.catalog.t["4"][0].v.length;
    expect(await store().writeCompletion()).toEqual({ added: 2, remaining: 1, trimmed: 0, rebuilding: false });
    expect(JSON.parse(mem.objects.get(SERVED)!)).toMatchObject({ lastReceivedAt: stamp(1), lastIds: ["u1"] });
    expect(await store().writeCompletion()).toEqual({ added: 1, remaining: 0, trimmed: 0, rebuilding: false });
    expect(voters(SERVED)).toBe(3);
    expect(await store().writeCompletion()).toEqual({ added: 0, remaining: 0, trimmed: 0, rebuilding: false });
    // A rebuild starts aside: the served rollup keeps its complete lists meanwhile.
    expect(await store().writeCompletion({ rebuild: true })).toEqual({ added: 2, remaining: 1, trimmed: 0, rebuilding: true });
    expect(voters(SERVED)).toBe(3);
    expect(voters(REBUILD)).toBe(2);
    // The next ordinary run continues the rebuild, swaps it in and removes it.
    expect(await store().writeCompletion()).toEqual({ added: 1, remaining: 0, trimmed: 0, rebuilding: false });
    expect(mem.objects.has(REBUILD)).toBe(false);
    expect(voters(SERVED)).toBe(3);
  });

  test("a ?rebuild=1 that starts between a finished rebuild's swap and its cleanup is not deleted", async () => {
    const { rows, uploads } = many(3);
    let racing = false;
    const mem = memoryCloud(uploads, rows, (key) => {
      // The moment the finished rebuild is swapped in, another run starts a new rebuild.
      if (racing && key === SERVED) { racing = false; mem.write(REBUILD, JSON.stringify({ version: 2, generatedAt: "x", state: { version: 2, catalog: { a: {}, f: {}, t: {}, q: {} }, owned: {} }, lastReceivedAt: null, lastIds: [] })); }
    });
    const store = () => createUploadStore({ cloud, localDir: "unused", fetch: mem.fn, now, completionBatch: 2 });
    await store().writeCompletion({ rebuild: true });
    expect(mem.objects.has(REBUILD)).toBe(true);
    racing = true;
    expect(await store().writeCompletion()).toMatchObject({ remaining: 0, rebuilding: false });
    // The new rebuild survived, and the next run continues it.
    expect(JSON.parse(mem.objects.get(REBUILD)!).lastReceivedAt).toBeNull();
    expect(await store().writeCompletion()).toMatchObject({ added: 2, rebuilding: true });
  });

  test("a run stops at its time budget after a whole batch and saves its place, so no input can stall the rollup", async () => {
    const { rows, uploads } = many(130);
    const mem = memoryCloud(uploads, rows);
    const run = () => createUploadStore({ cloud, localDir: "unused", fetch: mem.fn, now, completionBudgetMs: 0 }).writeCompletion();
    expect(await run()).toMatchObject({ added: 64, remaining: 66 });
    expect(JSON.parse(mem.objects.get(SERVED)!).lastReceivedAt).toBe(stamp(63));
    expect(await run()).toMatchObject({ added: 64, remaining: 2 });
    expect(await run()).toMatchObject({ added: 2, remaining: 0 });
    expect(JSON.parse(mem.objects.get(SERVED)!).state.catalog.t["4"][0].v).toHaveLength(64);
  });

  test("an unreadable upload keeps the batches before it and fails, so the next run starts at it", async () => {
    const { rows, uploads } = many(100);
    delete uploads["uploads/u70.json"];
    const mem = memoryCloud(uploads, rows);
    const run = () => createUploadStore({ cloud, localDir: "unused", fetch: mem.fn, now }).writeCompletion();
    await expect(run()).rejects.toThrow(/unreadable; the uploads before it were saved/);
    expect(JSON.parse(mem.objects.get(SERVED)!).lastReceivedAt).toBe(stamp(63));
    mem.reads.length = 0;
    await expect(run()).rejects.toThrow(/unreadable/);
    // Reads of a batch run in parallel after each request is signed, so their order is not fixed: the run
    // starts at u64 when no earlier upload is read and u64 is.
    const read = mem.reads.map((key) => Number(/u(\d+)\.json$/.exec(key)![1]));
    expect(Math.min(...read)).toBe(64);
  });

  test("when the grant lookup fails, a trim keeps every character of an install that holds a grant", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: `u${i}`, object_key: `uploads/u${i}.json`, received_at: stamp(i) }));
    const uploads = Object.fromEntries(rows.map((r, i) => [r.object_key, { publicationGrants: ["a".repeat(64)], records: [
      { kind: "quest_owned", installId: `install-${i}`, eventId: `q:${i}`, capturedAt, characterKey: "0a1b2c3d", class: "MAGE", level: 40, questIds: [1, 2, 3] },
      ...Array.from({ length: 40 }, (_, k) => ({ ...title(`install-${i}`, k), titleId: 100 + i * 40 + k, name: `Junk ${i} ${k}` })),
    ] }]));
    const mem = memoryCloud(uploads, rows);
    const result = await createUploadStore({ cloud, localDir: "unused", fetch: mem.fn, now, completionMaxBytes: 9000 })
      .writeCompletion({ authority: async () => { throw new Error("sharing store down"); } });
    expect(result.trimmed).toBeGreaterThan(0);
    const owned = JSON.parse(mem.objects.get(SERVED)!).state.owned;
    expect(Object.values(owned).map((i) => Object.keys((i as { characters: object }).characters).length)).toEqual([1, 1, 1, 1]);
  });

  test("a stored rollup with an install called __proto__ reads back as an ordinary install", async () => {
    const records = [{ kind: "title_owned", installId: "__proto__", eventId: "p:1", capturedAt, characterKey: "0a1b2c3d", class: "MAGE", level: 40, titleIds: [4] }];
    const mem = memoryCloud({ "uploads/u0.json": { records } }, [{ id: "u0", object_key: "uploads/u0.json", received_at: stamp(0) }]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch: mem.fn, now, cacheMs: 0 });
    await store.writeCompletion();
    expect(mem.objects.get(SERVED)).toContain('"__proto__":{');
    const read = await store.loadCompletion();
    expect(Object.keys(read.state!.owned)).toEqual(["__proto__"]);
    expect(read.state!.owned["__proto__"].characters["0a1b2c3d"].t).toEqual([4]);
    expect(read.state!.owned["constructor"]).toBeUndefined();
  });

  test("installs behind one upload address vote once, and the address hash never reaches what is read", async () => {
    const same = "0123456789abcdef";
    const { fn, calls } = fakeFetch([
      [COMPLETION, "GET", () => new Response("missing", { status: 404 })],
      [INDEX, "GET", () => Response.json(index(["a", "b", "c"]))],
      ...["a", "b", "c"].map((id, i): Parameters<typeof fakeFetch>[0][number] =>
        [`${R2}uploads/${id}.json`, "GET", () => Response.json({ reporter: same, records: [title(`install-${i + 1}`, 1)] })]),
      [COMPLETION, "PUT", () => new Response(null, { status: 200 })],
    ]);
    await createUploadStore({ cloud, localDir: "unused", fetch: fn, now }).writeCompletion();
    const body = JSON.parse(calls.find((c) => c.method === "PUT")!.body);
    expect(body.state.catalog.t["4"][0].v).toEqual([`r:${same}`]);
    const { agreedCatalog } = await import("../../../kb/src/completion-rollup");
    expect(agreedCatalog(body.state).titles.size).toBe(0);
  });

  test("a rollup heading past its size limit is trimmed and written, not refused; one past it on read is unavailable", async () => {
    const junk = (id: string, n: number) => ({ records: Array.from({ length: 40 }, (_, i) => ({ ...title(id, n * 100 + i), titleId: 1000 + n * 100 + i, name: `Junk ${n} ${i}` })) });
    const big = fakeFetch([
      [COMPLETION, "GET", () => new Response("missing", { status: 404 })],
      [INDEX, "GET", () => Response.json(index(["a", "b", "c", "d"]))],
      ...["a", "b", "c", "d"].map((id, n): Parameters<typeof fakeFetch>[0][number] => [`${R2}uploads/${id}.json`, "GET", () => Response.json(junk(`install-${n + 1}`, n))]),
      [COMPLETION, "PUT", () => new Response(null, { status: 200 })],
    ]);
    const result = await createUploadStore({ cloud, localDir: "unused", fetch: big.fn, now, completionMaxBytes: 6000 }).writeCompletion({
      authority: async () => ({ grants: [], suppressions: [] }),
    });
    expect(result.added).toBe(4);
    expect(result.trimmed).toBeGreaterThan(0);
    const put = big.calls.find((c) => c.method === "PUT")!;
    expect(Buffer.byteLength(put.body)).toBeLessThanOrEqual(6000);
    const read = fakeFetch([[COMPLETION, "GET", () => new Response(put.body, { headers: { etag: '"fixture"' } })]]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch: read.fn, now, completionMaxBytes: put.body.length - 1 }).loadCompletion())
      .toEqual({ state: null, dataAsOf: null, unreachable: true });
  });
});
