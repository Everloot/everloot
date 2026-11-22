import { expect, test, vi } from "vitest";
import { DISPATCH_KEY, dispatchHealth, tokenExpiry, VIEWS_RUN_KEY, viewsHealth, writeViewsRun } from "./stored-views-status";

const cloud = { r2AccountId: "acct", r2AccessKeyId: "synthetic-id", r2SecretAccessKey: "synthetic-secret", r2Bucket: "bucket" };
const now = () => Date.parse("2026-11-22T13:00:00Z");
const serve = (files: Record<string, unknown>) => vi.fn(async (input: RequestInfo | URL) => {
  const req = input as Request;
  const key = new URL(req.url).pathname.replace("/bucket/", "");
  if (req.method === "PUT") return new Response(null, { status: 200 });
  return key in files ? Response.json(files[key]) : new Response("missing", { status: 404 });
});

test("GitHub's token expiry header reads as ISO time, in UTC or with an offset", () => {
  expect(tokenExpiry("2026-12-22 06:42:29 UTC")).toBe("2026-12-22T06:42:29.000Z");
  expect(tokenExpiry("2026-12-22 06:42:29 -0700")).toBe("2026-12-22T13:42:29.000Z");
  expect(tokenExpiry(null)).toBeNull();
  expect(tokenExpiry("soon")).toBeNull();
});

test("views are current after a clean run inside 90 minutes, failing with failed steps, behind past it, missing before the first", async () => {
  const run = (finishedAt: string, failed: string[] = []) => ({ [VIEWS_RUN_KEY]: { finishedAt, dataAsOf: "2026-11-22T12:40:10Z", failed, seconds: 30, timings: {} } });
  expect(await viewsHealth({ cloud, now, fetch: serve(run("2026-11-22T12:45:00Z")) })).toEqual({
    status: "current", finishedAt: "2026-11-22T12:45:00Z", ageSeconds: 900, dataAsOf: "2026-11-22T12:40:10Z", failed: [],
  });
  expect(await viewsHealth({ cloud, now, fetch: serve(run("2026-11-22T12:45:00Z", ["coverage"])) })).toMatchObject({ status: "failing", failed: ["coverage"] });
  expect(await viewsHealth({ cloud, now, fetch: serve(run("2026-11-22T11:29:00Z")) })).toMatchObject({ status: "behind", ageSeconds: 5460 });
  expect(await viewsHealth({ cloud, now, fetch: serve({}) })).toMatchObject({ status: "missing" });
  expect(await viewsHealth({ cloud, now, fetch: vi.fn(async () => new Response("no", { status: 500 })) })).toMatchObject({ status: "unavailable" });
  expect(await viewsHealth({ cloud: null })).toMatchObject({ status: "local" });
});

test("the last start says whether GitHub took it and how many days the token has left", async () => {
  const record = { at: "2026-11-22T12:50:20Z", httpStatus: 204, sent: true, tokenExpiresAt: "2026-12-22T06:42:29.000Z" };
  expect(await dispatchHealth({ cloud, now, fetch: serve({ [DISPATCH_KEY]: record }) })).toEqual({
    status: "sent", at: "2026-11-22T12:50:20Z", httpStatus: 204, tokenExpiresAt: "2026-12-22T06:42:29.000Z", tokenDaysLeft: 29,
  });
  expect(await dispatchHealth({ cloud, now, fetch: serve({ [DISPATCH_KEY]: { ...record, httpStatus: 401, sent: false, tokenExpiresAt: null } }) }))
    .toMatchObject({ status: "refused", httpStatus: 401, tokenDaysLeft: null });
  expect(await dispatchHealth({ cloud, now, fetch: serve({}) })).toMatchObject({ status: "none" });
});

test("the job's heartbeat is a signed PUT of the run to its own key", async () => {
  const fetch = serve({});
  await writeViewsRun({ finishedAt: "2026-11-22T13:00:00Z", dataAsOf: null, failed: [], seconds: 1, timings: {} }, { cloud, fetch });
  const req = fetch.mock.calls[0][0] as Request;
  expect(req.method).toBe("PUT");
  expect(new URL(req.url).pathname).toBe(`/bucket/${VIEWS_RUN_KEY}`);
  expect(req.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256/);
});
