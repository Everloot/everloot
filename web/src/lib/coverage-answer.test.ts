import { afterEach, expect, test, vi } from "vitest";
import { computeCoverage } from "../../../kb/src/coverage";
import { answerCoverage } from "../../../kb/src/coverage-tool";
import { loadCoverageForTool } from "./coverage-answer";
import { forgetCoverageSummary, loadCoverageSummary, loadStoredCoverage, readStoredReport } from "./coverage-summary";

vi.mock("./coverage-compute", () => ({ loadCoverage: vi.fn() }));

const cloud = { r2AccountId: "acct", r2AccessKeyId: "id", r2SecretAccessKey: "secret", r2Bucket: "b" };
const BUILD = "1.60.1.70862";
const asOf = "2026-11-10T07:50:00.000Z";

/** A real score, as the cron stores it: 5 installs agree on one NPC, 2 report another (one more is needed). */
const report = (build = BUILD) => computeCoverage({
  asOf, build, zones: [{ mapId: 1429, name: "Elwynn Forest" }],
  records: [
    ...Array.from({ length: 5 }, (_, i) => ({ kind: "npc_sighting", installId: `a-${i}`, npcId: 123, name: "Agreed", mapId: 1429, x: 42, y: 65, positionKind: "interaction", capturedAt: "2026-10-01T00:00:00.000Z" })),
    ...Array.from({ length: 2 }, (_, i) => ({ kind: "npc_sighting", installId: `b-${i}`, npcId: 456, name: "Waiting", mapId: 1429, x: 10, y: 20, positionKind: "interaction", capturedAt: asOf })),
  ],
});
const reply = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });
const deps = (fetcher: typeof fetch) => ({ cloud, fetch: fetcher, now: () => 0, build: BUILD });
const live = () => vi.fn(async () => ({ ...report(), dataAsOf: "2026-11-09T00:00:00.000Z" }));

afterEach(() => forgetCoverageSummary());

test("the tool and the home page read the same stored report, so the numbers agree and the corpus is not replayed", async () => {
  const fetcher = vi.fn(async () => reply(report()));
  const summary = await loadCoverageSummary(deps(fetcher));
  const replay = live();
  const loaded = await loadCoverageForTool({ stored: () => loadStoredCoverage(deps(fetcher)), live: replay });
  expect(summary!.confirmed).toBeGreaterThan(0);
  expect(summary!.waiting).toBeGreaterThan(0);
  const text = await answerCoverage({}, async () => loaded);
  expect(text).toContain(`${summary!.installs} distinct folded installs`);
  expect(text).toContain(`${summary!.confirmed} confirmed (includes settled)`);
  expect(text).toContain(`Fields needing one or two more installs: ${summary!.waiting} `);
  expect(text).toContain(`Data as of ${summary!.dataAsOf} (stored report`);
  expect(replay).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("with no usable stored report the tool computes the score live and says so", async () => {
  for (const fetcher of [
    async () => new Response("", { status: 404 }),
    async () => new Response("not json", { status: 200 }),
    async () => { throw new Error("offline"); },
  ]) {
    forgetCoverageSummary();
    const replay = live();
    const loaded = await loadCoverageForTool({ stored: () => loadStoredCoverage(deps(fetcher)), live: replay });
    expect(replay).toHaveBeenCalledOnce();
    expect(loaded).toMatchObject({ source: "live", dataAsOf: "2026-11-09T00:00:00.000Z" });
    expect(await answerCoverage({}, async () => loaded)).toContain("Data as of 2026-11-09T00:00:00.000Z (computed from the corpus now");
  }
});

test("a stored report for another build is not used, though the home page still counts its own key", async () => {
  const fetcher = vi.fn(async () => reply(report("1.60.1.70450")));
  expect(await loadStoredCoverage(deps(fetcher))).toBeNull();
  expect(await loadCoverageSummary(deps(fetcher))).toMatchObject({ build: "1.60.1.70450" });
  const replay = live();
  expect(await loadCoverageForTool({ stored: () => loadStoredCoverage(deps(fetcher)), live: replay })).toMatchObject({ source: "live" });
  expect(replay).toHaveBeenCalledOnce();
});

test("a stored report missing something the tool prints is unusable, not a partial answer", () => {
  expect(readStoredReport(report(), BUILD)).toMatchObject({ installs: 7, build: BUILD });
  expect(readStoredReport(report(), "other")).toBeNull();
  expect(readStoredReport({ ...report(), method: undefined }, BUILD)).toBeNull();
  expect(readStoredReport({ ...report(), unplaced: null }, BUILD)).toBeNull();
  expect(readStoredReport({ ...report(), zones: [{ ...report().zones[0], fields: "x" }] }, BUILD)).toBeNull();
  expect(readStoredReport({ ...report(), zones: [{ ...report().zones[0], types: {} }] }, BUILD)).toBeNull();
});

test("nothing stored and nothing live is unknown", async () => {
  expect(await loadCoverageForTool({ stored: async () => null, live: async () => null })).toBeNull();
});

/** Warm the per-instance cache at t=0, then let the keep window lapse so the next read goes back to storage. */
const warm = async (fetcher: typeof fetch) => { await loadCoverageSummary({ cloud, fetch: fetcher, now: () => 0, build: BUILD }); };
const at = (fetcher: typeof fetch, now: number) => ({ cloud, fetch: fetcher, now: () => now, build: BUILD });

test("a warmed cache whose refresh fails is not served as stored: the tool computes live, and the stored answer returns on recovery", async () => {
  const ok = JSON.stringify(report());
  let down = false;
  const fetcher = vi.fn(async () => (down ? new Response("", { status: 503 }) : new Response(ok, { status: 200 })));
  await warm(fetcher);
  expect(await loadCoverageForTool({ stored: () => loadStoredCoverage(at(fetcher, 200_000)), live: live() })).toMatchObject({ source: "stored" });

  down = true;
  const replay = live();
  const during = await loadCoverageForTool({ stored: () => loadStoredCoverage(at(fetcher, 400_000)), live: replay });
  expect(during).toMatchObject({ source: "live", dataAsOf: "2026-11-09T00:00:00.000Z" });
  expect(replay).toHaveBeenCalledOnce();
  expect(await answerCoverage({}, async () => during)).toContain("(computed from the corpus now");
  // still down a minute later, and the retry has not turned the old report into a fresh one
  expect(await loadStoredCoverage(at(fetcher, 400_000 + 61_000))).toBeNull();

  down = false;
  const after = live();
  expect(await loadCoverageForTool({ stored: () => loadStoredCoverage(at(fetcher, 400_000 + 122_000)), live: after })).toMatchObject({ source: "stored", installs: 7 });
  expect(after).not.toHaveBeenCalled();
});

test("a network failure on refresh behaves the same, and the tool says unavailable when live fails too", async () => {
  const fetcher = vi.fn(async () => reply(report()));
  await warm(fetcher);
  fetcher.mockRejectedValue(new Error("offline"));
  expect(await loadStoredCoverage(at(fetcher, 400_000))).toBeNull();
  expect(await loadCoverageForTool({ stored: () => loadStoredCoverage(at(fetcher, 400_000)), live: async () => null })).toBeNull();
});

test("an unchanged file (304) keeps the stored report fresh, and the home page keeps its dated summary through the same outage", async () => {
  const fetcher = vi.fn(async () => reply(report(), { headers: { etag: '"v1"' } }));
  await warm(fetcher);
  fetcher.mockResolvedValueOnce(new Response(null, { status: 304 }));
  expect(await loadStoredCoverage(at(fetcher, 301_000))).toMatchObject({ installs: 7 });

  fetcher.mockResolvedValue(new Response("", { status: 503 }));
  expect(await loadStoredCoverage(at(fetcher, 700_000))).toBeNull();
  expect(await loadCoverageSummary(at(fetcher, 700_000))).toMatchObject({ installs: 7, dataAsOf: asOf });
});
