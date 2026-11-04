import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createUploadStore, type CloudConfig } from "./upload-store.js";
import { lootWindowsFromRecords } from "./rollups.js";

/**
 * One mixed submission, all the way through: route parsing, the real store, the corpus readers and
 * the rollup that publishes the number. The point is that a row no schema accepted can never become
 * a published fact, whichever storage path it arrived through.
 */

const cloud: CloudConfig = {
  r2AccountId: "acct",
  r2AccessKeyId: "AKID",
  r2SecretAccessKey: "secret",
  r2Bucket: "everloot-uploads",
  supabaseUrl: "https://sb.example",
  supabaseServiceKey: "svc",
};
const R2 = "https://acct.r2.cloudflarestorage.com/everloot-uploads/";
const now = () => new Date("2026-10-05T12:00:00Z");
const capturedAt = "2026-10-05T00:00:00.000Z";
const CHARACTER_KEY = "test-character-key".repeat(2);

const goodLoot = {
  eventId: "event:1",
  kind: "loot",
  installId: "install-1234",
  capturedAt,
  sourceNpcId: 123,
  sourceEvidence: "loot-api",
  items: [{ itemId: 456, count: 1 }],
};
/** Same install, a source with no id, so the loot refinement refuses it. */
const rejectedLoot = { ...goodLoot, sourceNpcId: 0, sourceObjectId: undefined };
const mixedPayload = { addonVersion: "0.1.0", records: [goodLoot, rejectedLoot] };

function jsonRequest(payload: unknown): Request {
  return new Request("https://everloot.app/api/intake", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Load the route with a chosen store as its singleton, so the real store code is what runs. */
async function postWith(store: unknown) {
  vi.resetModules();
  vi.doMock("@/lib/upload-store", () => ({ uploadStore: store }));
  const { POST } = await import("../app/api/intake/route.js");
  return POST;
}

beforeEach(() => {
  vi.doUnmock("@/lib/upload-store");
});

describe("intake through the store into published facts", () => {
  test("local: one valid row is stored, read back, and becomes one loot window", async () => {
    const dir = mkdtempSync(join(tmpdir(), "everloot-intake-"));
    const store = createUploadStore({ cloud: null, localDir: dir, now, cacheMs: 0 });
    const POST = await postWith(store);

    const response = await POST(jsonRequest(mixedPayload));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, persisted: true, accepted: [{ index: 0, kind: "loot" }] });

    const files = readdirSync(join(dir, "uploads"));
    expect(files).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, "uploads", files[0]), "utf8"))).toEqual({
      addonVersion: "0.1.0",
      records: [goodLoot],
    });

    const corpus = await store.loadCorpus();
    expect(corpus.records).toEqual([goodLoot]);
    expect(corpus.unreachable).not.toBe(true);
    expect(lootWindowsFromRecords(corpus.records)).toEqual([
      { installId: "install-1234", sourceNpcId: 123, items: [{ itemId: 456, count: 1 }] },
    ]);
  });

  test("local: census rows are written without their GUID and never reach the corpus", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", CHARACTER_KEY);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now());
    const dir = mkdtempSync(join(tmpdir(), "everloot-intake-"));
    const store = createUploadStore({ cloud: null, localDir: dir, now, cacheMs: 0 });
    const POST = await postWith(store);
    const seen = {
      kind: "census_seen", installId: "install-1234", eventId: "census:Player-4395-0A1B2C3D", capturedAt,
      guid: "Player-4395-0A1B2C3D", race: "Scourge", class: "PRIEST", level: 24, faction: "Horde", via: "target",
    };
    try {
      expect((await POST(jsonRequest({ addonVersion: "0.4.0", records: [seen, goodLoot] }))).status).toBe(200);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }

    const [file] = readdirSync(join(dir, "uploads"));
    const text = readFileSync(join(dir, "uploads", file), "utf8");
    expect(text).toContain("census_seen");
    expect(text).not.toMatch(/Player|0A1B2C3D/i);
    expect((await store.loadCorpus()).records).toEqual([goodLoot]);
  });

  test("local: upload, storage, reader: loadCensus returns the keyed rows, with the address hash and no GUID", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", CHARACTER_KEY);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now());
    const dir = mkdtempSync(join(tmpdir(), "everloot-intake-"));
    const store = createUploadStore({ cloud: null, localDir: dir, now, cacheMs: 0 });
    const POST = await postWith(store);
    const seen = {
      kind: "census_seen", installId: "install-1234", eventId: "census:Player-4395-0A1B2C3D", capturedAt,
      guid: "Player-4395-0A1B2C3D", race: "Scourge", class: "PRIEST", level: 24, faction: "Horde", via: "target",
    };
    try {
      expect((await POST(jsonRequest({ addonVersion: "0.4.0", records: [seen, goodLoot] }))).status).toBe(200);
      // The same character again, from the same install: the reader still has one row.
      expect((await POST(jsonRequest({ addonVersion: "0.4.0", records: [{ ...seen, level: 25 }] }))).status).toBe(200);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }

    const census = await store.loadCensus();
    expect(census.unreachable).not.toBe(true);
    expect(census.rows).toHaveLength(1);
    expect(census.rows[0]).toMatchObject({
      kind: "census_seen", installId: "install-1234", serverId: 4395, race: "Scourge", class: "PRIEST", level: 25, faction: "Horde", via: "target",
      characterKey: expect.stringMatching(/^[0-9a-f]{64}$/), reporter: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    expect(JSON.stringify(census)).not.toMatch(/Player|0A1B2C3D/i);
    // Other rows in the same files are not census rows, and a file with a raw GUID row reads as nothing.
    expect(census.rows.every((r) => r.kind.startsWith("census_"))).toBe(true);
    expect(await store.installCensus("install-1234")).toEqual(census.rows);
    expect(await store.installCensus("install-other")).toEqual([]);
  });

  test("local: a raw row that still carries a GUID is never read back by the census reader", async () => {
    const dir = mkdtempSync(join(tmpdir(), "everloot-intake-"));
    mkdirSync(join(dir, "uploads"));
    const raw = { kind: "census_seen", installId: "install-1234", eventId: "census_seen:2026-10-05:" + "a".repeat(24), capturedAt, guid: "Player-4395-0A1B2C3D", race: "Orc", class: "WARRIOR", level: 20, faction: "Horde", via: "target" };
    writeFileSync(join(dir, "uploads", "u.json"), JSON.stringify({ addonVersion: "0.4.0", records: [raw] }));
    const store = createUploadStore({ cloud: null, localDir: dir, now, cacheMs: 0 });
    expect((await store.loadCensus()).rows).toEqual([]);
  });

  test("cloud: upload objects in R2 and the Supabase index are read back as keyed census rows", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", CHARACTER_KEY);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now());
    const objects: Record<string, string> = {};
    const indexQueries: string[] = [];
    const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;
      if (req.method === "PUT" && url.startsWith(`${R2}uploads/`)) { objects[url.slice(R2.length)] = await req.text(); return new Response(null, { status: 200 }); }
      if (req.method === "POST" && url.startsWith("https://sb.example/rest/v1/uploads")) return new Response(null, { status: 201 });
      if (req.method === "GET" && url.startsWith("https://sb.example/rest/v1/uploads")) {
        indexQueries.push(url);
        const wanted = new URL(url).searchParams.get("install_id");
        return Response.json(Object.keys(objects)
          .filter((key) => !wanted || wanted === `eq.${JSON.parse(objects[key]).records[0].installId}`)
          .map((key) => ({ id: key, object_key: key, received_at: "2026-10-05T07:00:00+00:00" })));
      }
      if (req.method === "GET" && url.startsWith(`${R2}uploads/`)) {
        const body = objects[url.slice(R2.length)];
        return body ? new Response(body) : new Response("missing", { status: 404 });
      }
      return new Response("no route", { status: 404 });
    }) as typeof fetch;
    const store = createUploadStore({ cloud, localDir: "unused", fetch: fn, now, cacheMs: 0 });
    const POST = await postWith(store);
    const row = (installId: string, guid: string) => ({
      kind: "census_seen", installId, eventId: `census:${guid}`, capturedAt, guid, race: "Orc", class: "WARRIOR", level: 20, faction: "Horde", via: "group",
    });
    try {
      expect((await POST(jsonRequest({ addonVersion: "0.4.0", records: [row("install-1234", "Player-4395-0000AAAA"), row("install-1234", "Player-4395-0000BBBB")] }))).status).toBe(200);
      expect((await POST(jsonRequest({ addonVersion: "0.4.0", records: [row("install-5678", "Player-4395-0000AAAA")] }))).status).toBe(200);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
    expect(Object.values(objects).join()).not.toMatch(/Player|0000AAAA/);
    const census = await store.loadCensus();
    expect(census.rows).toHaveLength(3);
    // One character seen by two installs has one key, so a rollup counts it once.
    expect(new Set(census.rows.map((r) => r.characterKey)).size).toBe(2);
    expect(census.rows.map((r) => r.installId).sort()).toEqual(["install-1234", "install-1234", "install-5678"]);
    expect((await store.installCensus("install-1234"))).toHaveLength(2);
    expect(indexQueries.some((q) => q.includes("install_id=eq.install-1234"))).toBe(true);
  });

  test("cloud: the snapshot the cron writes holds only the accepted row, and serves it back", async () => {
    const stored: Record<string, string> = {};
    let snapshotBody = "";
    const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = req.url;
      if (req.method === "PUT" && url.startsWith(`${R2}uploads/`)) {
        stored[url] = await req.text();
        return new Response(null, { status: 200 });
      }
      if (req.method === "POST" && url.startsWith("https://sb.example/rest/v1/uploads")) {
        return new Response(null, { status: 201 });
      }
      if (req.method === "PUT" && url === `${R2}snapshots/corpus.json`) {
        snapshotBody = await req.text();
        return new Response(null, { status: 200 });
      }
      if (req.method === "GET" && url === `${R2}snapshots/corpus.json`) {
        return snapshotBody ? new Response(snapshotBody) : new Response("missing", { status: 404 });
      }
      if (req.method === "GET" && url.startsWith("https://sb.example/rest/v1/uploads")) {
        return Response.json([
          { id: "u-1", object_key: "uploads/2026-10-05/u-1.json", received_at: "2026-10-05T07:00:00+00:00" },
        ]);
      }
      if (req.method === "GET" && url.startsWith(`${R2}uploads/`)) {
        const body = Object.values(stored)[0];
        return body ? new Response(body) : new Response("missing", { status: 404 });
      }
      return new Response("no route", { status: 404 });
    }) as typeof fetch;

    const writer = createUploadStore({ cloud, localDir: "unused", fetch: fn, now, cacheMs: 0 });
    const POST = await postWith(writer);
    expect((await POST(jsonRequest(mixedPayload))).status).toBe(200);
    expect(Object.values(stored).map((body) => JSON.parse(body))).toEqual([
      { addonVersion: "0.1.0", records: [goodLoot] },
    ]);

    expect(await writer.writeSnapshot()).toMatchObject({ uploads: 1, added: 1 });
    // The snapshot carries its records as replay events, once; the records array stays empty for the older reader.
    const snapshot = JSON.parse(snapshotBody);
    expect(snapshot.records).toEqual([]);
    expect(snapshot.corpusState.events.map((e: { record: unknown }) => e.record)).toEqual([goodLoot]);

    const reader = createUploadStore({ cloud, localDir: "unused", fetch: fn, now, cacheMs: 0 });
    const corpus = await reader.loadCorpus();
    expect(corpus).toEqual({ uploads: 1, records: [goodLoot], dataAsOf: "2026-10-05T12:00:00.000Z" });
    expect(lootWindowsFromRecords(corpus.records)).toHaveLength(1);
  });
});
