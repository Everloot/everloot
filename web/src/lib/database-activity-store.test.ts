import { expect, test, vi } from "vitest";
import { DATABASE_ACTIVITY_INVENTORY_KEY, loadDatabaseActivity, writeDatabaseActivity } from "./database-activity-store";
import { STAMP } from "./stored-view-freshness";
const cloud = { r2AccountId: "synthetic", r2AccessKeyId: "synthetic", r2SecretAccessKey: "synthetic", r2Bucket: "synthetic" };
const file = { version: 1 as const, generatedAt: new Date().toISOString(), dataAsOf: "current", publicKeys: [], entries: [] };

test("idle skips only a matching stamp without building or loading the corpus", async () => {
  const build = vi.fn();
  const fetch = vi.fn(async () => new Response(null, { headers: { [STAMP]: "current" } }));
  expect(await writeDatabaseActivity({ added: 0, dataAsOf: "current" }, { cloud, build, fetch })).toEqual({ written: false });
  expect(build).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
});

test("stale/unstamped idle writes are stamped and failed writes retry next run", async () => {
  let storedStamp = "old", fail = true;
  const fetch = vi.fn(async (req: RequestInfo | URL) => {
    const r = req as Request;
    if (r.method === "HEAD") return new Response(null, { headers: { [STAMP]: storedStamp } });
    if (r.method === "PUT") {
      if (r.url.includes(DATABASE_ACTIVITY_INVENTORY_KEY)) return new Response();
      expect(r.headers.get(STAMP)).toBe("current");
      if (fail) return new Response(null, { status: 503 });
      storedStamp = r.headers.get(STAMP)!;
      return new Response();
    }
    return Response.json(file);
  });
  const build = vi.fn(async () => file);
  await expect(writeDatabaseActivity({ added: 0, dataAsOf: "current" }, { cloud, build, fetch })).rejects.toThrow("503");
  fail = false;
  expect(await writeDatabaseActivity({ added: 0, dataAsOf: "current" }, { cloud, build, fetch })).toEqual({ written: true, entries: 0 });
  expect(build).toHaveBeenCalledTimes(2);
  expect(await writeDatabaseActivity({ added: 0, dataAsOf: "current" }, { cloud, build, fetch })).toEqual({ written: false });
});

test("unreadable data is never retained as a successful empty read", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ bad: true })).mockResolvedValueOnce(Response.json(file));
  expect(await loadDatabaseActivity({ cloud, fetch })).toBeNull();
  expect(await loadDatabaseActivity({ cloud, fetch })).toEqual(file);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("missing or unstamped views build; unreadable previous history is preserved for retry", async () => {
  const build = vi.fn(async () => file);
  const fetch = vi.fn(async (input: RequestInfo | URL) => (input as Request).method === "PUT" ? new Response() : new Response(null, { status: 404 }));
  expect(await writeDatabaseActivity({ added: 0, dataAsOf: "current" }, { cloud, build, fetch })).toMatchObject({ written: true });
  const unstamped = vi.fn(async (input: RequestInfo | URL) => (input as Request).method === "PUT" ? new Response() : Response.json(file));
  expect(await writeDatabaseActivity({ added: 0, dataAsOf: "current" }, { cloud, build, fetch: unstamped })).toMatchObject({ written: true });
  build.mockClear();
  const unavailable = vi.fn(async () => new Response(null, { status: 503 }));
  expect(await writeDatabaseActivity({ added: 0, dataAsOf: "current" }, { cloud, build, fetch: unavailable })).toEqual({ written: false });
  expect(build).not.toHaveBeenCalled();
  expect(unavailable).toHaveBeenCalledTimes(2);
});


test("failed HEAD falls back to freshness GET, retaining a separate previous-view read", async () => {
  const build = vi.fn(async () => file);
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const r = input as Request;
    if (r.method === "HEAD") return new Response(null, { status: 503 });
    return r.method === "PUT" ? new Response() : Response.json({ ...file, dataAsOf: "old" });
  });
  await writeDatabaseActivity({ added: 0, dataAsOf: "current" }, { cloud, build, fetch });
  expect(fetch.mock.calls.filter(([r]) => (r as Request).method === "GET")).toHaveLength(3);
  expect(build).toHaveBeenCalledOnce();
});

test("readers fetch only the public object; inventory and public payloads are separate", async () => {
  const bodies = new Map<string, unknown>();
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const r = input as Request;
    if (r.method === "PUT") { bodies.set(r.url.split("?")[0], JSON.parse(await r.text())); return new Response(); }
    return new Response(null, { status: 404 });
  });
  const privateFile = { ...file, codeVersion: 1, publicKeys: ["item:42"], everPublic: ["item:42"] };
  await writeDatabaseActivity({ added: 1, dataAsOf: "current" }, { cloud, build: async () => privateFile, fetch });
  expect([...bodies.values()].find((v) => "everPublic" in (v as object))).toEqual(privateFile);
  const publicFile = [...bodies.entries()].find(([url]) => !url.includes(DATABASE_ACTIVITY_INVENTORY_KEY))![1];
  expect(publicFile).not.toHaveProperty("publicKeys");
  expect(publicFile).not.toHaveProperty("everPublic");
  const read = vi.fn(async () => Response.json(publicFile));
  expect(await loadDatabaseActivity({ cloud, fetch: read })).not.toBeNull();
  expect(read).toHaveBeenCalledOnce();
  expect((read.mock.calls[0] as unknown as [Request])[0].url).not.toContain("inventory");
});

test("a failed public write retries from canonical inventory without losing publication history", async () => {
  const inventory = { ...file, codeVersion: 1, publicKeys: ["item:42"], everPublic: ["item:42"] };
  let stored: unknown = null, fail = true;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const r = input as Request, privateObject = r.url.includes(DATABASE_ACTIVITY_INVENTORY_KEY);
    if (r.method === "PUT") {
      if (privateObject) { stored = JSON.parse(await r.text()); return new Response(); }
      return new Response(null, { status: fail ? 503 : 200 });
    }
    return privateObject && stored ? Response.json(stored) : new Response(null, { status: 404 });
  });
  await expect(writeDatabaseActivity({ added: 1, dataAsOf: "current" }, { cloud, fetch, build: async () => inventory })).rejects.toThrow("503");
  fail = false;
  const build = vi.fn(async () => inventory);
  await writeDatabaseActivity({ added: 1, dataAsOf: "current" }, { cloud, fetch, build });
  expect(build).toHaveBeenCalledWith(inventory);
});

test("missing private history cannot silently reset the inventory", async () => {
  const build = vi.fn();
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    if ((input as Request).url.includes(DATABASE_ACTIVITY_INVENTORY_KEY)) return new Response(null, { status: 404 });
    return Response.json({ version: 1, generatedAt: file.generatedAt, dataAsOf: file.dataAsOf, entries: [] });
  });
  await expect(writeDatabaseActivity({ added: 1, dataAsOf: "current" }, { cloud, build, fetch })).rejects.toThrow("inventory is missing");
  expect(build).not.toHaveBeenCalled();
});
