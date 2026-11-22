import { describe, expect, test } from "vitest";
import { createUploadStore, snapshotParts, type CloudConfig } from "./upload-store";

const cloud: CloudConfig = { r2AccountId: "acct", r2AccessKeyId: "key", r2SecretAccessKey: "secret", r2Bucket: "bucket", supabaseUrl: "https://db.test", supabaseServiceKey: "service" };
const loot = (i: number) => ({ kind: "loot", installId: `install-${i % 3}`, eventId: `event-${i}`, capturedAt: "2026-10-07T00:00:00.000Z", sourceNpcId: i, items: [{ itemId: 2, count: 1 }] });
const index = (ids: string[]) => ids.map((id, i) => ({ id, object_key: `uploads/${id}.json`, received_at: `2026-10-0${i + 1}T00:00:00.000Z` }));

/** An R2 and index that keep what the store writes: the snapshot as stored bytes, the uploads as they are. */
function fakeStorage(ids: string[], persisted: { snapshot?: string; probe?: string[] } = {}) {
  const uploads = new Map(ids.map((id, i) => [id, { records: [loot(i)] }]));
  const state = { snapshot: persisted.snapshot, puts: 0, parts: new Map<string, string>() };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const part = /snapshots\/corpus\/.+\.json/.exec(req.url)?.[0];
    if (part) {
      if (req.method === "PUT") { state.parts.set(part, await req.text()); return new Response(null); }
      if (req.method === "DELETE") { state.parts.delete(part); return new Response(null, { status: 204 }); }
      return state.parts.has(part) ? new Response(state.parts.get(part)) : new Response("missing", { status: 404 });
    }
    if (req.url.includes("snapshots/corpus.json")) {
      if (req.method === "PUT") { state.snapshot = await req.text(); state.puts++; return new Response(null); }
      if (state.snapshot === undefined) return new Response("missing", { status: 404 });
      // Served in 7-byte pieces, so a key or value is cut across chunks.
      const bytes = new TextEncoder().encode(state.snapshot);
      let at = 0;
      return new Response(new ReadableStream({ pull(c) { if (at >= bytes.length) c.close(); else { c.enqueue(bytes.slice(at, at + 7)); at += 7; } } }), { headers: { etag: '"current"' } });
    }
    if (req.url.includes("cron/last-run.json")) return new Response("missing", { status: 404 });
    if (req.url.includes("/rest/v1/uploads")) {
      const after = new URL(req.url).searchParams.get("received_at")?.replace(/^gt\./, "");
      const select = new URL(req.url).searchParams.get("select");
      const rows = index(ids).filter((r) => !after || r.received_at > after);
      return Response.json(select === "id" ? rows.map((r) => ({ id: r.id })) : rows);
    }
    const id = /uploads\/(.+)\.json/.exec(req.url)?.[1];
    return id && uploads.has(id) ? Response.json(uploads.get(id)) : new Response("missing", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, state };
}

describe("writeSnapshot keeps one copy of the corpus", () => {
  test("after writeSnapshot the corpus is the one written, without reading the file again", async () => {
    const { fetch, state } = fakeStorage(["a", "b", "c"]);
    const writer = createUploadStore({ cloud, localDir: "unused", fetch });
    await writer.writeSnapshot();
    // Count reads of the snapshot from here: the writer's corpus must come from memory.
    let reads = 0;
    const counting = ((input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      if (req.url.includes("snapshots/corpus.json") && req.method === "GET") reads++;
      return fetch(input, init);
    }) as typeof globalThis.fetch;
    const primed = createUploadStore({ cloud, localDir: "unused", fetch: counting });
    await primed.writeSnapshot();
    const afterWrite = reads;
    const mine = await primed.loadCorpus();
    expect(reads).toBe(afterWrite);
    // A store that knows nothing but the stored file sees the same records.
    const fresh = await createUploadStore({ cloud, localDir: "unused", fetch }).loadCorpus();
    expect(JSON.parse(JSON.stringify(mine))).toEqual(JSON.parse(JSON.stringify(fresh)));
    expect(mine.records.length).toBeGreaterThan(0);
    expect(state.puts).toBe(2);
  });

  test("a rebuild's state is what loadCorpus returns, and a later write extends it", async () => {
    const { fetch } = fakeStorage(["a", "b", "c"]);
    const store = createUploadStore({ cloud, localDir: "unused", fetch });
    await store.writeSnapshot({ rebuild: true });
    const once = JSON.parse(JSON.stringify(await store.loadCorpus()));
    expect(JSON.parse(JSON.stringify(await createUploadStore({ cloud, localDir: "unused", fetch }).loadCorpus()))).toEqual(once);
    await store.writeSnapshot();
    expect(JSON.parse(JSON.stringify((await store.loadCorpus()).records))).toEqual(once.records);
  });
});

describe("the snapshot is stored in parts (#1354)", () => {
  test("each part is a JSON array within the size limit, and the parts together are every event in order", () => {
    const events = Array.from({ length: 40 }, (_, i) => ({ i, pad: "x".repeat(i % 7 * 5) }));
    const parts = [...snapshotParts(events, 120)];
    expect(parts.length).toBeGreaterThan(5);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(120);
    expect(parts.flatMap((part) => JSON.parse(part))).toEqual(events);
    // One event larger than the limit gets a part of its own rather than being split or dropped.
    const big = { pad: "y".repeat(300) };
    expect([...snapshotParts([{ a: 1 }, big, { b: 2 }], 120)].map((part) => JSON.parse(part))).toEqual([[{ a: 1 }], [big], [{ b: 2 }]]);
    expect([...snapshotParts([])]).toEqual([]);
  });

  test("a write keeps its own parts and the previous write's, and deletes the ones before", async () => {
    const { fetch, state } = fakeStorage(["a", "b", "c"]);
    const store = () => createUploadStore({ cloud, localDir: "unused", fetch });
    const folders = () => [...new Set([...state.parts.keys()].map((key) => key.split("/")[2]))];
    await store().writeSnapshot();
    const first = folders();
    await store().writeSnapshot();
    expect(folders()).toHaveLength(2);
    await store().writeSnapshot();
    const left = folders();
    expect(left).toHaveLength(2);
    expect(left).not.toContain(first[0]);
    const list = JSON.parse(state.snapshot!);
    expect(list.parts.every((key: string) => state.parts.has(key))).toBe(true);
    expect(list.retired.every((key: string) => state.parts.has(key))).toBe(true);
    const corpus = await store().loadCorpus();
    expect(corpus.unreachable).toBeUndefined();
    expect(corpus.records.length).toBeGreaterThan(0);
  });

  test("a write that loses the race deletes the parts it wrote", async () => {
    const { fetch, state } = fakeStorage(["a", "b"]);
    const racing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      if (req.method === "PUT" && req.url.includes("snapshots/corpus.json")) return new Response(null, { status: 412 });
      return fetch(input, init);
    }) as typeof globalThis.fetch;
    await expect(createUploadStore({ cloud, localDir: "unused", fetch: racing }).writeSnapshot()).rejects.toThrow("snapshot write failed (412)");
    expect(state.parts.size).toBe(0);
  });

  test("a snapshot in the single-file format is still read, and the next write stores it in parts", async () => {
    const { fetch, state } = fakeStorage(["a", "b", "c"]);
    await createUploadStore({ cloud, localDir: "unused", fetch }).writeSnapshot();
    const list = JSON.parse(state.snapshot!);
    const events = list.parts.flatMap((key: string) => JSON.parse(state.parts.get(key)!));
    state.snapshot = JSON.stringify({ generatedAt: list.generatedAt, uploads: list.uploads, records: [], corpusState: { ...list.state, events }, seenUploadIds: list.seenUploadIds, lastReceivedAt: list.lastReceivedAt, lastIds: list.lastIds });
    state.parts.clear();
    const before = JSON.parse(JSON.stringify(await createUploadStore({ cloud, localDir: "unused", fetch }).loadCorpus()));
    expect(before.records.length).toBeGreaterThan(0);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch }).writeSnapshot()).toMatchObject({ uploads: 3, added: 0 });
    expect(JSON.parse(state.snapshot!).format).toBe(2);
    // The same records and upload count; only the write's time moves on.
    const after = JSON.parse(JSON.stringify(await createUploadStore({ cloud, localDir: "unused", fetch }).loadCorpus()));
    expect({ ...after, dataAsOf: undefined }).toEqual({ ...before, dataAsOf: undefined });
  });

  test("a missing part makes the corpus unreachable, never a smaller one", async () => {
    const { fetch, state } = fakeStorage(["a", "b", "c"]);
    await createUploadStore({ cloud, localDir: "unused", fetch }).writeSnapshot();
    state.parts.delete(JSON.parse(state.snapshot!).parts[0]);
    expect(await createUploadStore({ cloud, localDir: "unused", fetch }).loadCorpus()).toMatchObject({ records: [], unreachable: true });
  });
});

describe("sweepSnapshotParts", () => {
  test("deletes only part folders no list names that are older than the guard, and keeps the current and retired ones", async () => {
    const folders = {
      current: "snapshots/corpus/20261122T141012492Z-40861935/",
      retired: "snapshots/corpus/20261122T140012866Z-9e2bc02f/",
      orphan: "snapshots/corpus/20261122T130023898Z-00074976/",
      fresh: "snapshots/corpus/20261122T143500000Z-aaaaaaaa/",
      odd: "snapshots/corpus/handmade/",
    };
    const objects = new Set(Object.values(folders).flatMap((f) => [`${f}0.json`, `${f}1.json`]));
    const mark = { format: 2, parts: [`${folders.current}0.json`, `${folders.current}1.json`], retired: [`${folders.retired}0.json`, `${folders.retired}1.json`] };
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      if (url.searchParams.get("list-type") === "2") {
        const prefix = url.searchParams.get("prefix") ?? "";
        const keys = [...objects].filter((k) => k.startsWith(prefix)).map((k) => `<Contents><Key>${k}</Key></Contents>`).join("");
        return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${keys}</ListBucketResult>`);
      }
      if (url.pathname.endsWith("snapshots/corpus.json")) return Response.json(mark);
      if (req.method === "DELETE") { objects.delete(url.pathname.replace("/bucket/", "")); return new Response(null, { status: 204 }); }
      return new Response("missing", { status: 404 });
    }) as typeof globalThis.fetch;
    const store = createUploadStore({ cloud, localDir: "unused", fetch, now: () => new Date("2026-11-22T14:40:00Z") });
    expect(await store.sweepSnapshotParts(60 * 60_000)).toEqual({ folders: 1, objects: 2 });
    expect([...objects].some((k) => k.startsWith(folders.orphan))).toBe(false);
    for (const f of [folders.current, folders.retired, folders.fresh, folders.odd]) expect([...objects].filter((k) => k.startsWith(f))).toHaveLength(2);
  });

  test("a snapshot without a part list deletes nothing", async () => {
    let deletes = 0;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.method === "DELETE") deletes++;
      if (req.url.includes("snapshots/corpus.json")) return Response.json({ format: 1, records: [] });
      return new Response("<ListBucketResult><Contents><Key>snapshots/corpus/20261101T000000000Z-aaaaaaaa/0.json</Key></Contents></ListBucketResult>");
    }) as typeof globalThis.fetch;
    const store = createUploadStore({ cloud, localDir: "unused", fetch, now: () => new Date("2026-11-22T14:40:00Z") });
    expect(await store.sweepSnapshotParts()).toEqual({ folders: 0, objects: 0 });
    expect(deletes).toBe(0);
  });
});