import { afterEach, expect, test, vi } from "vitest";
import { COVERAGE_SCHEMA, COVERAGE_TYPES } from "../../../kb/src/coverage";
import { coverageKey, forgetCoverageSummary, loadCoverageSummary, summarizeCoverage } from "./coverage-summary";

const cloud = { r2AccountId: "acct", r2AccessKeyId: "id", r2SecretAccessKey: "secret", r2Bucket: "b" };
const BUILD = "1.60.1.70862";

const cell = (confirmed: number) => ({ expected: null, observed: confirmed, denominator: null, reported: 0, recheck: 0, confirmed, settled: 0 });
/** A stored score with the shape the cron writes: per-type totals and per-zone needsTotal. */
const score = (over: Record<string, unknown> = {}) => ({
  schema: COVERAGE_SCHEMA, build: BUILD, dataAsOf: "2026-11-10T07:50:00.000Z", installs: 14,
  totals: Object.fromEntries(COVERAGE_TYPES.map((t, i) => [t, cell(i === 0 ? 5 : 1)])),
  zones: [{ mapId: 1, name: "A", needsTotal: 7 }, { mapId: 2, name: "B", needsTotal: 0 }, { mapId: 3, name: "C", needsTotal: 4 }],
  ...over,
});

afterEach(() => forgetCoverageSummary());

test("the summary is installs, confirmed facts over every type, facts waiting over every zone, and the data date", () => {
  expect(summarizeCoverage(score())).toEqual({ installs: 14, confirmed: 5 + (COVERAGE_TYPES.length - 1), waiting: 11, dataAsOf: "2026-11-10T07:50:00.000Z", build: BUILD });
});

test("a score that cannot be read is null, never zero", () => {
  expect(summarizeCoverage(null)).toBeNull();
  expect(summarizeCoverage("nope")).toBeNull();
  expect(summarizeCoverage(score({ schema: "other/1" }))).toBeNull();
  expect(summarizeCoverage(score({ installs: "14" }))).toBeNull();
  expect(summarizeCoverage(score({ zones: [] }))).toBeNull();
  expect(summarizeCoverage(score({ zones: [{ mapId: 1 }] }))).toBeNull();
  expect(summarizeCoverage(score({ totals: { quests: cell(1) } }))).toBeNull();
});

test("a measured zero stays zero, and an undated score has no date rather than a made-up one", () => {
  const zero = summarizeCoverage(score({ installs: 0, totals: Object.fromEntries(COVERAGE_TYPES.map((t) => [t, cell(0)])), zones: [{ mapId: 1, needsTotal: 0 }], dataAsOf: null }));
  expect(zero).toEqual({ installs: 0, confirmed: 0, waiting: 0, dataAsOf: null, build: BUILD });
  expect(summarizeCoverage(score({ dataAsOf: "soon" }))?.dataAsOf).toBeNull();
});

const reply = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

test("it reads the stored score for the build once, and again only after five minutes, with the ETag", async () => {
  const fetcher = vi.fn(async () => reply(score(), { headers: { etag: '"v1"' } }));
  expect(await loadCoverageSummary({ cloud, fetch: fetcher, now: () => 0, build: BUILD })).toMatchObject({ installs: 14 });
  const sent = (fetcher.mock.calls[0] as unknown as [Request])[0];
  expect(sent.url).toBe(`https://acct.r2.cloudflarestorage.com/b/${coverageKey(BUILD)}`);
  expect(sent.method).toBe("GET");
  await loadCoverageSummary({ cloud, fetch: fetcher, now: () => 299_000, build: BUILD });
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValueOnce(new Response(null, { status: 304 }));
  expect(await loadCoverageSummary({ cloud, fetch: fetcher, now: () => 301_000, build: BUILD })).toMatchObject({ installs: 14 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect((fetcher.mock.calls[1] as unknown as [Request])[0].headers.get("if-none-match")).toBe('"v1"');
});

test("storage not configured, a missing file, an unreadable body or a failed read is null: unrecorded", async () => {
  expect(await loadCoverageSummary({ cloud: null, build: BUILD })).toBeNull();
  expect(await loadCoverageSummary({ cloud, fetch: async () => new Response("", { status: 404 }), now: () => 0, build: BUILD })).toBeNull();
  forgetCoverageSummary();
  expect(await loadCoverageSummary({ cloud, fetch: async () => new Response("not json", { status: 200 }), now: () => 0, build: BUILD })).toBeNull();
  forgetCoverageSummary();
  expect(await loadCoverageSummary({ cloud, fetch: async () => { throw new Error("offline"); }, now: () => 0, build: BUILD })).toBeNull();
});

test("a failed re-read keeps the last good summary, which carries its own date, and asks again after a minute", async () => {
  const fetcher = vi.fn(async () => reply(score()));
  await loadCoverageSummary({ cloud, fetch: fetcher, now: () => 0, build: BUILD });
  fetcher.mockResolvedValueOnce(new Response("", { status: 503 }));
  expect(await loadCoverageSummary({ cloud, fetch: fetcher, now: () => 400_000, build: BUILD })).toMatchObject({ dataAsOf: "2026-11-10T07:50:00.000Z" });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await loadCoverageSummary({ cloud, fetch: fetcher, now: () => 400_000 + 61_000, build: BUILD });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test("another build is read on its own, not from the last build's copy", async () => {
  const fetcher = vi.fn(async () => reply(score({ build: "2.0.0.1", installs: 3 })));
  await loadCoverageSummary({ cloud, fetch: fetcher, now: () => 0, build: BUILD });
  expect(await loadCoverageSummary({ cloud, fetch: fetcher, now: () => 1, build: "2.0.0.1" })).toMatchObject({ build: "2.0.0.1", installs: 3 });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
