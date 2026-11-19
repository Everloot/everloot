import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createUploadStore, type CloudConfig } from "./upload-store";
import { loadUploadRecords } from "@kb/load-uploads";

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
  const revisions = new Map<string, number>();
  let revision = 0;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.startsWith("https://db.test")) return Response.json(index);
    const key = new URL(req.url).pathname.replace("/bucket/", "");
    if (req.method === "GET") return objects.has(key)
      ? new Response(objects.get(key), { headers: { etag: `"${revisions.get(key)}"` } })
      : new Response(null, { status: 404 });
    if (req.method === "DELETE") { objects.delete(key); return new Response(null, { status: 204 }); }
    // As R2 does, the precondition and the write are one step: the body is read first, so no await falls between
    // them and two writers cannot both pass the check before either stores. A write with no precondition always lands.
    const body = await req.text();
    const conditional = req.headers.has("if-match") || req.headers.has("if-none-match");
    if (conditional && (req.headers.get("if-match") !== (objects.has(key) ? `"${revisions.get(key)}"` : null) ||
        (!objects.has(key) && req.headers.get("if-none-match") !== "*"))) return new Response(null, { status: 412 });
    objects.set(key, body); revisions.set(key, ++revision);
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
  // The stored state: the part list's state with the events of its parts.
  const stored = () => {
    const list = JSON.parse(f.objects.get("snapshots/corpus.json")!);
    expect(list.format).toBe(2);
    expect(list.records).toBeUndefined();
    return { ...list.state, events: list.parts.flatMap((key: string) => JSON.parse(f.objects.get(key)!)) };
  };
  const before = stored();
  expect(before.events.map((e: { record: unknown }) => e.record)).toEqual([row("epoch:2")]);
  expect((await store.loadCorpus()).records).toEqual([row("epoch:2")]);
  await store.writeSnapshot({ rebuild: true });
  expect(stored()).toEqual(before);
});
test("concurrent snapshot writers cannot overwrite each other's conflict state", async () => {
  const f = fixture(); f.add("a");
  const stores = [1, 2].map(() => createUploadStore({ cloud, localDir: "unused", fetch: f.fetcher }));
  const results = await Promise.allSettled(stores.map((s) => s.writeSnapshot()));
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});
