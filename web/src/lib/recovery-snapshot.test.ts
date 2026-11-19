import { expect, test } from "vitest";
import { createUploadStore, type CloudConfig } from "./upload-store";

const cloud: CloudConfig = { r2AccountId: "acct", r2AccessKeyId: "key", r2SecretAccessKey: "secret",
  r2Bucket: "bucket", supabaseUrl: "https://db.test", supabaseServiceKey: "service" };
const row = { kind: "loot", installId: "install-one", eventId: "event-one", capturedAt: "2026-10-07T00:00:00Z",
  sourceNpcId: 1, items: [{ itemId: 2, count: 1 }] };

test.each([false, true])("recovery snapshot conflicts survive subsequent replay, rebuild=%s", async rebuild => {
  let saved: unknown;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.includes("snapshots/corpus.json")) {
      if (req.method === "PUT") { saved = await req.json(); return new Response(null, { status: 200 }); }
      return Response.json({ uploads: 1, records: [row], conflictTombstones: ["install-one|event-one"] }, { headers: { etag: '"old"' } });
    }
    if (req.url.includes("/rest/v1/uploads")) return Response.json([{ id: "new", object_key: "uploads/new.json", received_at: "2026-10-08T00:00:00Z" }]);
    return Response.json({ records: [row] });
  }) as typeof globalThis.fetch;
  const store = createUploadStore({ cloud, localDir: "unused", fetch });
  expect((await store.loadCorpus()).records).toEqual([]);
  await store.writeSnapshot({ rebuild });
  expect(saved).toMatchObject({ format: 2, state: { conflicts: ['["install-one","event-one"]'] } });
});

test("legacy watermark updates do not turn a partial index into a complete inventory", async () => {
  let snapshot: Record<string, unknown> = { uploads: 2, records: [], lastReceivedAt: "2026-10-02", lastIds: ["B"] };
  const index = ["A", "B", "C"].map((id, i) => ({ id, object_key: `uploads/${id}.json`, received_at: `2026-10-0${i + 1}` }));
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.includes("snapshots/corpus.json")) {
      if (req.method === "PUT") { snapshot = await req.json(); return new Response(null); }
      return Response.json(snapshot, { headers: { etag: '"current"' } });
    }
    if (req.url.includes("/rest/v1/uploads")) {
      const since = new URL(req.url).searchParams.get("received_at")?.slice(4);
      return Response.json(index.filter(r => !since || r.received_at >= since));
    }
    return Response.json({ records: [] });
  }) as typeof globalThis.fetch;
  const store = createUploadStore({ cloud, localDir: "unused", fetch });
  expect(await store.writeSnapshot()).toMatchObject({ uploads: 3, added: 1 });
  expect(await store.writeSnapshot()).toMatchObject({ uploads: 3, added: 0 });
});

test("snapshot reads request an uncompressed representation for a strong conditional validator", async () => {
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.includes("snapshots/corpus.json")) {
      if (req.method === "PUT") {
        return new Response(null, { status: req.headers.get("if-match") === '"current"' ? 200 : 412 });
      }
      return Response.json({ uploads: 0, records: [] }, {
        headers: { etag: req.headers.get("accept-encoding") === "identity" ? '"current"' : 'W/"current"' },
      });
    }
    return Response.json([]);
  }) as typeof globalThis.fetch;
  await expect(createUploadStore({ cloud, localDir: "unused", fetch }).writeSnapshot()).resolves.toMatchObject({ uploads: 0, added: 0 });
});
