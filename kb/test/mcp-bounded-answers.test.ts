import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { z } from "zod";
import { ANSWER_BYTES, COVERAGE_PAGE, MCP_TOOLS, PLAN_ROWS } from "@everloot/protocol";
import { answerBytes } from "../src/answer-budget.js";
import { BRIDGE_PLAN, PLAN_REVISION, renderTracker, type PlanAnswer } from "../src/bridge-plan.js";
import type { CoverageAnswer } from "../src/coverage-tool.js";
import { COVERAGE_FIELDS, COVERAGE_TYPES, type CoverageCell, type CoverageReport, type CoverageType } from "../src/coverage.js";
import { createToolHandlers } from "../src/mcp-server.js";
import type { DB } from "../src/db.js";

/** A typical broad answer stays under this, as the JSON-RPC result a client receives: text plus structured content. */
const BUDGET = 12_000;
const wire = (answer: { text: string; structured: unknown }) =>
  Buffer.byteLength(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: answer.text }], structuredContent: answer.structured } }));

const asOf = "2026-11-10T07:50:15.827Z";
const cell = (expected: number): CoverageCell => ({ expected, observed: 108, denominator: expected, reported: 108, recheck: 2, confirmed: 11, settled: 3 });
/** Larger than the live score: 45 released zones, every type and field, each zone's reported list at its 200 cap. */
function bigReport(zoneCount = 45, needsPerZone = 200): CoverageReport {
  const zones = Array.from({ length: zoneCount }, (_, i) => {
    const mapId = 1400 + i;
    return {
      mapId, name: `Stranglethorn Vale ${i}`, installs: 12,
      types: Object.fromEntries(COVERAGE_TYPES.map((t) => [t, cell(2607)])) as Record<CoverageType, CoverageCell>,
      fields: COVERAGE_TYPES.flatMap((type) => COVERAGE_FIELDS[type].map(({ field }) => ({ type, field, ...cell(324) }))),
      needs: Array.from({ length: needsPerZone }, (_, n) => ({
        type: COVERAGE_TYPES[n % COVERAGE_TYPES.length]!, field: COVERAGE_FIELDS[COVERAGE_TYPES[n % COVERAGE_TYPES.length]!][0]!.field,
        label: `NPC ${mapId * 1000 + n} · item ${n}`, voters: 2, need: 1, href: `/database/npcs/${mapId * 1000 + n}`,
      })),
      needsTotal: needsPerZone + 600,
    };
  });
  return {
    schema: "everloot.coverage/1", build: "1.60.1.70862", dataAsOf: asOf, installs: 14,
    method: "A fact is one field of one entity, such as a quest's turn-in or an NPC's level. It is confirmed when 3 installs agree on it and settled when 5 agree, the third at least 14 days ago, with no other value reported since. A pin settles when all 5 stood within 5 map units of the median, and a drop rate when its 95% interval is narrow enough. Installs that share a Polestar character or address count once. A zone's denominator is the larger of the facts expected there and the facts players reported.",
    expected: { dataAsOf: "2026-11-10T01:10:19.253Z" },
    totals: Object.fromEntries(COVERAGE_TYPES.map((t) => [t, cell(2607 * zoneCount)])) as Record<CoverageType, CoverageCell>,
    zones,
    unplaced: { installs: 0, types: Object.fromEntries(COVERAGE_TYPES.map((t) => [t, cell(0)])) as Record<CoverageType, CoverageCell>, fields: [], needs: [], needsTotal: 0 },
    locate: { quests: [], npcs: [] },
  };
}
const big = bigReport();
const coverage = (args: object, report = big) =>
  createToolHandlers({} as DB, { coverage: async () => report, settledSummary: async (build) => ({ build, dataAsOf: asOf, facts: 1 }) })
    .coverage(args as never) as Promise<CoverageAnswer>;
const output = z.object(MCP_TOOLS.coverage.outputSchema);

test("broad coverage answers stay under the budget by default and keep scope, date and denominator", async () => {
  for (const args of [{}, { type: "quests" }, { type: "drops" }, { zone: 1429 + 0 }, { zone: 1400 }, { zone: 1400, type: "drops" }, { detail: true }, { detail: true, type: "quests" }]) {
    const answer = await coverage(args);
    expect(wire(answer), JSON.stringify(args)).toBeLessThan(BUDGET);
    expect(output.parse(answer.structured)).toBeTruthy();
    expect(answer.text).toContain("Scope: ");
    expect(answer.text).toContain(`Data as of ${asOf}`);
    expect(answer.text).toContain("Denominator = max(expected, observed)");
    expect(answer.text).toMatch(/\nMore: https:\/\/everloot\.app\/database\/coverage$/);
  }
  // The audit's 82 KB call: every zone for quests.
  const quests = await coverage({ type: "quests" });
  expect(quests.text).toContain(`quests: 135/${2607 * 45} settled`);
  expect(quests.structured.page).toMatchObject({ detail: false, list: "zones", total: 45, offset: 0, limit: COVERAGE_PAGE.summaryZones, nextOffset: COVERAGE_PAGE.summaryZones });
  expect(quests.structured.page!.totals).toMatchObject({ denominator: 2607 * 45, expected: 2607 * 45, settled: 135 });
  expect(quests.text).toContain(`Continue: ${45 - COVERAGE_PAGE.summaryZones} more zones; pass offset=${COVERAGE_PAGE.summaryZones} with the same arguments.`);
});

/** Follows nextOffset from offset 0 and returns every page. */
async function pages(args: object) {
  const out = [];
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const answer = await coverage({ ...args, offset });
    out.push(answer);
    offset = answer.structured.page!.nextOffset;
    expect(out.length).toBeLessThan(100);
  }
  return out;
}

test("following nextOffset returns every zone exactly once, in the summary and in detail", async () => {
  const ids = big.zones.map((zone) => zone.mapId);
  for (const args of [{}, { type: "vendors" }, { detail: true }, { detail: true, limit: 7 }]) {
    const all = await pages(args);
    const seen = all.flatMap((a) => a.structured.page!.zones.map((zone) => zone.mapId));
    expect(seen, JSON.stringify(args)).toEqual(ids);
    // Every zone section appears in exactly one text too.
    for (const id of ids) expect(all.filter((a) => a.text.includes(`(zone ${id});`)).length).toBe(1);
    expect(all.at(-1)!.text).not.toContain("Continue:");
  }
});

test("one zone's reported entries page by offset, each exactly once, and a capped zone in a long list says how to read the rest", async () => {
  const zone = big.zones[3]!;
  for (const type of [undefined, "npcs"] as const) {
    const expected = zone.needs.filter((n) => !type || n.type === type).map((n) => n.label);
    const all = await pages({ zone: zone.mapId, ...(type ? { type } : {}) });
    expect(all.every((a) => a.structured.page!.list === "entries" && a.structured.page!.total === expected.length)).toBe(true);
    const seen = all.flatMap((a) => [...a.text.matchAll(/^ {2}\w+\.[\w-]+: (NPC \d+ · item \d+);/gm)].map((m) => m[1]));
    expect(seen).toEqual(expected);
    for (const a of all) expect(wire(a)).toBeLessThan(BUDGET);
  }
  const detail = await coverage({ detail: true });
  expect(detail.text).toContain(`${200 - COVERAGE_PAGE.entriesPerZone} more entries here: call coverage with zone=1400, offset=${COVERAGE_PAGE.entriesPerZone}.`);
  // That pointer continues exactly where the zone's first entries stop.
  const rest = await coverage({ zone: 1400, offset: COVERAGE_PAGE.entriesPerZone });
  expect(rest.text).toContain(`showing entries ${COVERAGE_PAGE.entriesPerZone + 1}–`);
});

test("a small answer is unchanged: one zone with everything on one page has no paging lines", async () => {
  const small = bigReport(2, 2);
  const answer = await coverage({ zone: 1400, type: "npcs" }, small);
  expect(answer.text).toContain("Reported fields needing installs: showing 1 matching entries from 2/602 listed across all types");
  expect(answer.text).toContain("  npcs.name: 3/324 settled");
  expect(answer.text).toContain("  npcs.name: NPC 1400001 · item 1; 2/3 agreeing installs; 1 more needed; https://everloot.app/database/npcs/1400001");
  expect(answer.text).not.toMatch(/Showing |Continue:|detail=true/);
  expect(answer.structured.page).toMatchObject({ detail: true, list: "entries", total: 1, offset: 0 });
  expect(answer.structured.page!.nextOffset).toBeUndefined();
});

test("an offset past the end is said, never an empty measured list", async () => {
  const answer = await coverage({ offset: 90 });
  expect(answer.text).toContain("Showing none of 45 zones (offset 90 is past the end)");
  expect(answer.structured.page).toMatchObject({ total: 45, offset: 90, zones: [] });
  expect(answer.structured.page).toMatchObject({ measured: true, totals: { denominator: 2607 * 9 * 45 } });
});

test("the largest limits stay under ANSWER_BYTES on every page, and nextOffset counts the items each page holds", async () => {
  const zone = big.zones[0]!;
  for (const args of [{ limit: COVERAGE_PAGE.max }, { detail: true, limit: 7 }, { detail: true, limit: COVERAGE_PAGE.max }, { detail: true, type: "quests", limit: COVERAGE_PAGE.max },
    { zone: zone.mapId, limit: COVERAGE_PAGE.max }, { zone: zone.mapId, type: "npcs", limit: COVERAGE_PAGE.max }]) {
    const all = await pages(args);
    for (const a of all) {
      expect(answerBytes(a), JSON.stringify({ ...args, offset: a.structured.page!.offset })).toBeLessThanOrEqual(ANSWER_BYTES);
      expect(wire(a)).toBeLessThan(ANSWER_BYTES + 64);
      expect(output.parse(a.structured)).toBeTruthy();
      const p = a.structured.page!;
      const held = p.list === "zones" ? p.zones.length : [...a.text.matchAll(/^ {2}\w+\.[\w-]+: NPC \d+ · item \d+;/gm)].length;
      if (p.nextOffset !== undefined) expect(p.nextOffset).toBe(p.offset + held);
      expect(p.limit).toBe(args.limit);
    }
    // Trimmed pages still add up to every item exactly once.
    const zonesSeen = all.flatMap((a) => a.structured.page!.zones.map((z) => z.mapId));
    if (all[0]!.structured.page!.list === "zones") expect(zonesSeen, JSON.stringify(args)).toEqual(big.zones.map((z) => z.mapId));
    else {
      const type = (args as { type?: string }).type;
      const seen = all.flatMap((a) => [...a.text.matchAll(/^ {2}\w+\.[\w-]+: (NPC \d+ · item \d+);/gm)].map((m) => m[1]));
      expect(seen).toEqual(zone.needs.filter((n) => !type || n.type === type).map((n) => n.label));
    }
  }
  // The review's cases, which overran the budget before the byte cut.
  expect((await coverage({ detail: true, limit: 7 })).structured.page!.nextOffset).toBeLessThan(7);
  expect((await coverage({ zone: 1400, limit: 50 })).structured.page!.nextOffset).toBeLessThan(50);
});

test("a zone filter with no released zone is unmeasured in the text and the structured content alike", async () => {
  for (const args of [{ zone: 9999 }, { zone: 9999, type: "npcs" }, { zone: 9999, detail: false }]) {
    const answer = await coverage(args);
    expect(output.parse(answer.structured)).toBeTruthy();
    expect(answer.text).toContain("No released zone matches this filter; no counts measured for this scope.");
    expect(answer.text).not.toMatch(/Scoped entity-field totals|All scoped zones and types|\d+\/\d+ settled/);
    expect(answer.structured.page).toMatchObject({ measured: false, totals: null, types: [], zones: [], needsInstalls: null, total: 0 });
  }
  expect((await coverage({ zone: 1400 })).structured.page).toMatchObject({ measured: true, totals: { denominator: 2607 * 9 } });
});

const plan = (args: object) => createToolHandlers({} as DB).everloot_plan(args as never) as PlanAnswer;
const planOut = z.object(MCP_TOOLS.everloot_plan.outputSchema);

test("everloot_plan with no arguments is main's answer: the whole TRACKER.md text and every row, plus index", async () => {
  const answer = await plan({});
  planOut.parse(answer.structured);
  // docs/TRACKER.md is unchanged from main, and main's everloot_plan returned exactly its text.
  const disk = readFileSync(new URL("../../docs/TRACKER.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  expect(answer.text).toBe(renderTracker());
  expect(answer.text.trim()).toBe(disk.trim());
  expect(answer.structured.rows).toEqual(BRIDGE_PLAN);
  expect(answer.structured.counts).toEqual({
    live: BRIDGE_PLAN.filter((r) => r.status === "live").length, next: BRIDGE_PLAN.filter((r) => r.status === "next").length,
    waiting: BRIDGE_PLAN.filter((r) => r.status === "waiting").length, shape: BRIDGE_PLAN.filter((r) => r.status === "shape").length,
  });
  expect(answer.structured.index).toEqual(BRIDGE_PLAN.map(({ done: _done, ...row }) => row));
  expect(Object.keys(answer.structured).sort()).toEqual(["counts", "index", "rows"]);
  // Explicit undefined, as a parsed empty input can hold, is no argument too.
  expect(await plan({ status: undefined, offset: undefined })).toEqual(answer);
});

test("everloot_plan pages are summaries unless detail is asked for, under the budget, with the tracker revision", async () => {
  const answer = await plan({ detail: false });
  expect(answerBytes(answer)).toBeLessThanOrEqual(ANSWER_BYTES);
  planOut.parse(answer.structured);
  expect(answer.structured.rows).toEqual([]);
  expect(answer.structured.index).toHaveLength(Math.min(PLAN_ROWS.summary, BRIDGE_PLAN.length));
  expect(answer.structured.counts.live + answer.structured.counts.next + answer.structured.counts.waiting + answer.structured.counts.shape).toBe(BRIDGE_PLAN.length);
  expect(answer.text).toContain(`Everloot implementation tracker: ${BRIDGE_PLAN.length} rows;`);
  expect(answer.text).toContain("https://github.com/Everloot/everloot/blob/main/docs/TRACKER.md");
  expect(answer.text).not.toContain(BRIDGE_PLAN[0]!.done);
  expect(PLAN_REVISION).toMatch(/^[0-9a-f]{8}$/);
  for (const args of [{ detail: false }, { offset: 0 }, { status: "shape" }, { detail: true }, { status: "next", detail: true }, { limit: 3 }]) {
    const a = await plan(args);
    expect(a.text, JSON.stringify(args)).toContain(`Tracker revision ${PLAN_REVISION}; date unknown (the tracker records none).`);
    expect(a.structured).toMatchObject({ revision: PLAN_REVISION, dataAsOf: null });
  }
});

test("everloot_plan pages return every row exactly once, with its done text in detail, at most ANSWER_BYTES each", async () => {
  for (const args of [{ detail: false }, { detail: true }, { status: "shape" }, { status: "next", detail: true, limit: 4 },
    { limit: PLAN_ROWS.max }, { detail: true, limit: PLAN_ROWS.max }, { status: "next", detail: true, limit: PLAN_ROWS.max }]) {
    const status = (args as { status?: string }).status;
    const expected = ["live", "next", "waiting", "shape"].filter((s) => !status || s === status).flatMap((s) => BRIDGE_PLAN.filter((r) => r.status === s));
    const seen = [];
    let offset: number | undefined = 0;
    while (offset !== undefined) {
      const answer = await plan({ ...args, offset });
      planOut.parse(answer.structured);
      expect(answerBytes(answer), JSON.stringify({ ...args, offset })).toBeLessThanOrEqual(ANSWER_BYTES);
      expect(answer.structured.total).toBe(expected.length);
      const held = (args as { detail?: boolean }).detail ? answer.structured.rows : answer.structured.index!;
      seen.push(...held);
      for (const row of answer.structured.rows) expect(answer.text).toContain(row.done);
      if (answer.structured.nextOffset !== undefined) expect(answer.structured.nextOffset).toBe(offset + held.length);
      offset = answer.structured.nextOffset;
    }
    expect(seen.map((r) => r.id), JSON.stringify(args)).toEqual(expected.map((r) => r.id));
  }
  // The review's case: 100 rows with detail ran to 37 KB before the byte cut.
  expect((await plan({ detail: true, limit: 100 })).structured.nextOffset).toBeLessThan(100);
});
