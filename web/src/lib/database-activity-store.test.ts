import { expect, test, vi } from "vitest";
import { loadDatabaseActivity, writeDatabaseActivity } from "./database-activity-store";
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
  await expect(writeDatabaseActivity({ added: 0, dataAsOf: "current" }, { cloud, build, fetch: unavailable })).rejects.toThrow("unreadable");
  expect(build).not.toHaveBeenCalled();
  expect(unavailable).toHaveBeenCalledTimes(2);
});
