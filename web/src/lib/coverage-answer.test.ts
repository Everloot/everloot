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
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
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
