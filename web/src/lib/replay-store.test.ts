import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createUploadStore, type CloudConfig } from "./upload-store";
import { loadUploadRecords } from "../../../kb/src/load-uploads";

const row = (id = "epoch:1", count = 1) => ({ kind: "loot" as const, installId: "install-one",
  eventId: id, capturedAt: "2026-10-07T00:00:00Z", sourceNpcId: 42, items: [{ itemId: 5, count }] });
const payload = (records = [row()]) => ({ addonVersion: "0.2.0", records });
test("local store and MCP agree after full-file replays and an old-plus-new file", async () => {
  const localDir = mkdtempSync(join(tmpdir(), "replay-store-"));
  const store = createUploadStore({ cloud: null, localDir, cacheMs: 0 });
  await store.putUpload("a", "install-one", payload());
  await store.putUpload("b", "install-one", payload([row(), row("epoch:2")]));
  expect((await store.loadCorpus()).records).toHaveLength(2);
  expect(loadUploadRecords(join(localDir, "uploads"))).toEqual((await store.loadCorpus()).records);
  await store.putUpload("c", "install-one", payload([row("epoch:1", 9)]));
  await store.putUpload("d", "install-one", payload());
  expect((await store.loadCorpus()).records).toEqual([row("epoch:2")]);
});

const cloud: CloudConfig = { r2AccountId: "acct", r2AccessKeyId: "key", r2SecretAccessKey: "secret",
  r2Bucket: "bucket", supabaseUrl: "https://db.test", supabaseServiceKey: "svc" };
function fixture() {
  const objects = new Map<string, string>();
  const index: {id: string; object_key: string; received_at: string}[] = [];
  let revision = 0;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.startsWith("https://db.test")) return Response.json(index);
    const key = new URL(req.url).pathname.replace("/bucket/", "");
    if (req.method === "GET") return objects.has(key)
      ? new Response(objects.get(key), { headers: { etag: `"${revision}"` } })
      : new Response(null, { status: 404 });
    // As R2 does, the precondition and the write are one step: the body is read first, so no await falls between
    // them and two writers cannot both pass the check before either stores.
    const body = await req.text();
    if (req.headers.get("if-match") !== (objects.has(key) ? `"${revision}"` : null) ||
        (!objects.has(key) && req.headers.get("if-none-match") !== "*")) return new Response(null, { status: 412 });
    objects.set(key, body); revision++;
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const add = (id: string, records = [row()]) => {
    objects.set(`uploads/${id}.json`, JSON.stringify(payload(records)));
    index.push({ id, object_key: `uploads/${id}.json`, received_at: "2026-10-07T00:00:00Z" });
  };
  return { objects, fetcher, add };
}
test("incremental snapshot, conflict replay and full rebuild have identical event state", async () => {
  const f = fixture(); f.add("a");
  const store = createUploadStore({ cloud, localDir: "unused", fetch: f.fetcher, cacheMs: 0 });
  await store.writeSnapshot();
  f.add("b", [row(), row("epoch:2")]); await store.writeSnapshot();
  f.add("c", [row("epoch:1", 9)]); await store.writeSnapshot();
  f.add("d"); await store.writeSnapshot();
  const before = JSON.parse(f.objects.get("snapshots/corpus.json")!);
  expect(before.records).toEqual([]);
  expect(before.corpusState.events.map((e: { record: unknown }) => e.record)).toEqual([row("epoch:2")]);
  expect((await store.loadCorpus()).records).toEqual([row("epoch:2")]);
  await store.writeSnapshot({ rebuild: true });
  expect(JSON.parse(f.objects.get("snapshots/corpus.json")!).corpusState).toEqual(before.corpusState);
});
test("concurrent snapshot writers cannot overwrite each other's conflict state", async () => {
  const f = fixture(); f.add("a");
  const stores = [1, 2].map(() => createUploadStore({ cloud, localDir: "unused", fetch: f.fetcher }));
  const results = await Promise.allSettled(stores.map((s) => s.writeSnapshot()));
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});
