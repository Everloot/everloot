import { afterEach, expect, test, vi } from "vitest";
import { writeItemView, buildItemView } from "./item-view-store";
import { writeAggregates, anonymousAggregates } from "./aggregate-store";
import { writeProfessions, buildProfessions } from "./profession-store";
import { writeMapPins, buildMapPins } from "./map-pins-store";
import { writeAuctionHistory, buildAuctionHistory } from "./auction-history-store";

const cloud = { r2AccountId: "acct", r2AccessKeyId: "id", r2SecretAccessKey: "secret", r2Bucket: "uploads" };
const dataAsOf = "2026-11-10T00:00:00.000Z";
const corpus = { uploads: 0, records: [], dataAsOf };
const stamp = "x-amz-meta-data-as-of";
const writers = [
  { name: "items", write: (added: number, fetch: typeof globalThis.fetch) => writeItemView({ added, dataAsOf }, { cloud, fetch, build: () => buildItemView(dataAsOf, new Date(), corpus) }) },
  { name: "aggregates", write: (added: number, fetch: typeof globalThis.fetch) => writeAggregates({ added, dataAsOf }, { cloud, fetch, build: async () => anonymousAggregates(corpus) }) },
  { name: "professions", write: (added: number, fetch: typeof globalThis.fetch) => writeProfessions({ added, dataAsOf }, { cloud, fetch, build: async () => buildProfessions(corpus) }) },
  { name: "map pins", write: (added: number, fetch: typeof globalThis.fetch) => writeMapPins({ added, dataAsOf }, { cloud, fetch, build: async () => buildMapPins(corpus) }) },
  { name: "auction history", write: (added: number, fetch: typeof globalThis.fetch) => writeAuctionHistory({ added, dataAsOf }, { cloud, fetch, build: async () => buildAuctionHistory(corpus) }) },
];
afterEach(() => vi.restoreAllMocks());

for (const { name, write } of writers) {
  test(`${name}: an idle run retries a failed PUT, then skips the current object`, async () => {
    let stored = "older";
    let fail = true;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const req = input as Request;
      if (req.method === "HEAD") return new Response(null, { headers: { [stamp]: stored } });
      if (fail) { fail = false; return new Response(null, { status: 503 }); }
      stored = req.headers.get(stamp)!;
      return new Response(null);
    });
    await expect(write(1, fetch)).rejects.toThrow("write failed");
    expect(await write(0, fetch)).toMatchObject({ written: true });
    expect(stored).toBe(dataAsOf);
    expect(await write(0, fetch)).toEqual({ written: false });
    expect(fetch.mock.calls.map(([req]) => (req as Request).method)).toEqual(["PUT", "HEAD", "PUT", "HEAD"]);
  });

  test(`${name}: an unstamped object is rewritten once`, async () => {
    let stored: string | null = null;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const req = input as Request;
      if (req.method === "HEAD") return new Response(null, { headers: stored ? { [stamp]: stored } : {} });
      stored = req.headers.get(stamp);
      return new Response(null);
    });
    expect(await write(0, fetch)).toMatchObject({ written: true });
    expect(stored).toBe(dataAsOf);
    expect(await write(0, fetch)).toEqual({ written: false });
  });

  test(`${name}: repeated HEAD failures read the successfully written body without rebuilding`, async () => {
    let body = "";
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const req = input as Request;
      if (req.method === "HEAD") throw new Error("HEAD unavailable");
      if (req.method === "GET") return new Response(body);
      body = await req.text();
      return new Response(null);
    });
    expect(await write(1, fetch)).toMatchObject({ written: true });
    expect(await write(0, fetch)).toEqual({ written: false });
    expect(await write(0, fetch)).toEqual({ written: false });
    expect(fetch.mock.calls.map(([req]) => (req as Request).method)).toEqual(["PUT", "HEAD", "GET", "HEAD", "GET"]);
  });

  test.each(["matching", "stale", "missing"])(`${name}: HEAD %s`, async (mode) => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => (input as Request).method === "HEAD"
      ? new Response(null, { status: mode === "missing" ? 404 : 200, headers: { [stamp]: mode === "matching" ? dataAsOf : "older" } })
      : new Response(null));
    expect(await write(0, fetch)).toMatchObject({ written: mode !== "matching" });
    expect(fetch.mock.calls.map(([req]) => (req as Request).method)).toEqual(mode === "matching" ? ["HEAD"] : ["HEAD", "PUT"]);
  });

  for (const headFailure of ["network", "503"]) {
    test.each(["matching body", "stale body", "matching metadata", "stale metadata", "missing", "503", "network", "invalid"])(`${name}: HEAD ${headFailure}, GET %s`, async (mode) => {
      const log = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetch = vi.fn(async (input: RequestInfo | URL) => {
        const req = input as Request;
        if (req.method === "HEAD") {
          if (headFailure === "network") throw new Error("offline");
          return new Response(null, { status: 503 });
        }
        if (req.method === "PUT") return new Response(null);
        if (mode === "network") throw new Error("offline");
        if (mode === "503" || mode === "missing") return new Response(null, { status: mode === "503" ? 503 : 404 });
        if (mode.endsWith("metadata")) return new Response("invalid", { headers: { [stamp]: mode.startsWith("matching") ? dataAsOf : "older" } });
        // Exercise the actual on-disk envelope for each writer.
        const value = { dataAsOf: mode.startsWith("matching") ? dataAsOf : "older" };
        return new Response(mode === "invalid" ? "{}" : JSON.stringify(name === "items" || name === "auction history" ? value : { set: value }));
      });
      const written = mode.startsWith("stale") || mode === "missing";
      for (let run = 0; run < 2; run++) expect(await write(0, fetch)).toMatchObject({ written });
      expect(fetch.mock.calls.map(([req]) => (req as Request).method)).toEqual(Array.from({ length: 2 }, () => written ? ["HEAD", "GET", "PUT"] : ["HEAD", "GET"]).flat());
      if (["503", "network", "invalid"].includes(mode)) expect(log).toHaveBeenCalledTimes(2);
    });
  }
}
