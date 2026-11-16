import { expect, test, vi } from "vitest";
import { isReportDate, storedAuctionReport, writeAuctionReports } from "./auction-report-store";
import { STAMP } from "./stored-view-freshness";
const cloud = { r2AccountId: "account", r2AccessKeyId: "key", r2SecretAccessKey: "secret", r2Bucket: "bucket" };
test("invalid dates stay out of storage and missing snapshots do not replay data", async () => {
 const fetch = vi.fn();
 expect(isReportDate("2026-02-30")).toBe(false);
 expect(await storedAuctionReport("../../x", { cloud, fetch })).toBeNull(); expect(fetch).not.toHaveBeenCalled();
 expect(await storedAuctionReport("2026-11-14", { cloud: null })).toBeNull();
});
test("a matching daily stamp skips expensive building", async () => {
 const build = vi.fn();
 const fetch = vi.fn().mockResolvedValue(new Response(null, { headers: { [STAMP]: "2026-11-15" } }));
 expect(await writeAuctionReports(new Date("2026-11-15T12:00Z"), { cloud, fetch, build })).toEqual({ written: false });
 expect(build).not.toHaveBeenCalled();
});
test("an unreadable archive index cannot erase previously published dates", async () => {
 const build = vi.fn(); const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { headers: { [STAMP]: "2026-11-14" } })).mockResolvedValue(new Response(null, { status: 503 }));
 await expect(writeAuctionReports(new Date("2026-11-15"), { cloud, fetch, build })).rejects.toThrow("unreadable");
 expect(build).not.toHaveBeenCalled();
});
test("midnight creates missing reports, retains old archives and commits the index last", async () => {
 const old = "2026-10-01";
 const calls: { path: string; method: string; body?: string }[] = [];
 const fetch: typeof globalThis.fetch = vi.fn(async (input) => {
  const req = input as Request; const path = new URL(req.url).pathname;
  const body = req.method === "PUT" ? await req.clone().text() : undefined;
  calls.push({ path, method: req.method, body });
  if (req.method === "HEAD") return new Response(null, { headers: { [STAMP]: "2026-11-14" } });
  if (req.method === "GET") return Response.json({ version: 1, dates: [old] });
  return new Response(null);
 });
 const report = { date: "2026-11-14", goods: 1 } as import("./auction-report").AuctionReport;
 const build = vi.fn().mockResolvedValue([report]);
 expect(await writeAuctionReports(new Date("2026-11-15"), { cloud, fetch, build })).toEqual({ written: true, reports: 1 });
 expect(build).toHaveBeenCalledOnce();
 expect(calls.filter(c => c.method === "PUT").map(c => c.path)).toEqual(["/bucket/snapshots/auction-reports/2026-11-14.json", "/bucket/snapshots/auction-reports/index.json"]);
 expect(JSON.parse(calls.at(-1)!.body!).dates).toEqual([old, "2026-11-14"]);
});
