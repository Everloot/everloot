import { describe, expect, test } from "vitest";
import { createUploadStore, type CloudConfig } from "./upload-store";

const cloud: CloudConfig = { r2AccountId: "acct", r2AccessKeyId: "key", r2SecretAccessKey: "secret", r2Bucket: "bucket", supabaseUrl: "https://db.test", supabaseServiceKey: "service" };
const loot = (i: number) => ({ kind: "loot", installId: `install-${i % 3}`, eventId: `event-${i}`, capturedAt: "2026-10-07T00:00:00.000Z", sourceNpcId: i, items: [{ itemId: 2, count: 1 }] });
const index = (ids: string[]) => ids.map((id, i) => ({ id, object_key: `uploads/${id}.json`, received_at: `2026-10-0${i + 1}T00:00:00.000Z` }));

/** An R2 and index that keep what the store writes: the snapshot as stored bytes, the uploads as they are. */
function fakeStorage(ids: string[], persisted: { snapshot?: string; probe?: string[] } = {}) {
  const uploads = new Map(ids.map((id, i) => [id, { records: [loot(i)] }]));
  const state = { snapshot: persisted.snapshot, puts: 0 };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
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
