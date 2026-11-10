import { expect, test } from "vitest";
import { z } from "zod";
import { MCP_TOOLS } from "@everloot/protocol";
import { computeCoverage } from "../src/coverage.js";
import { createToolHandlers } from "../src/mcp-server.js";
import type { DB } from "../src/db.js";

const asOf = "2026-10-22T00:00:00.000Z";
const report = () => computeCoverage({
  asOf, build: "test-build",
  zones: [{ mapId: 1429, name: "Elwynn Forest" }, { mapId: 1411, name: "Durotar" }],
  records: Array.from({ length: 2 }, (_, i) => ({
    kind: "npc_sighting", installId: `private-install-${i}`, npcId: 123,
    name: "UNCONFIRMED NAME", playerName: "PRIVATE PLAYER", mapId: 1429,
    x: 42, y: 65, positionKind: "interaction", capturedAt: asOf,
  })),
  expected: { version: 1, dataAsOf: asOf, zones: [
    { zone: "1429", types: { npc: 10 }, fields: { npc: { name: 10 } } },
  ] },
});
const call = (args = {}, loader = async () => report()) => createToolHandlers({} as DB, { coverage: loader }).coverage(args);

test("coverage declares optional zone and type and text-only read-only output", () => {
  const def = MCP_TOOLS.coverage;
  const input = z.object(def.inputSchema);
  expect(input.parse({})).toEqual({});
  expect(input.parse({ zone: 1429, type: "npcs" })).toEqual({ zone: 1429, type: "npcs" });
  expect(input.safeParse({ zone: -1 }).success).toBe(false);
  expect(input.safeParse({ type: "players" }).success).toBe(false);
  expect(def.annotations.readOnlyHint).toBe(true);
  expect("outputSchema" in def).toBe(false);
});

test("coverage gives dated counts, field grain, method, installs, and safe reported lists", async () => {
  const text = await call();
  expect(text).toContain("all released zones; all types");
  expect(text).toContain(asOf);
  expect(text).toContain("2 distinct folded installs");
  expect(text).toContain("max(expected, observed)");
  expect(text).toContain("0/10 settled; 0/10 confirmed");
  expect(text).toContain("npcs.name");
  expect(text).toContain("NPC 123");
  expect(text).toContain("2/3 agreeing installs; 1 more needed");
  expect(text).toContain("https://everloot.app/database/coverage");
  expect(text).toMatch(/\nMore: https:\/\/everloot\.app\/database\/coverage$/);
  expect(text).not.toMatch(/UNCONFIRMED NAME|PRIVATE PLAYER|private-install/);
});

test("zone and type independently filter counts, fields and lists and say the scope", async () => {
  const text = await call({ zone: 1429, type: "npcs" });
  expect(text).toContain("zone 1429; type npcs");
  expect(text).not.toContain("Durotar");
  expect(text).not.toContain("pins.position");
  expect(await call({ type: "npcs" })).toContain("Durotar");
  expect(await call({ zone: 1429 })).toContain("pins.position");
});

test("confirmed, settled and game-file counts use the score without exposing raw records", async () => {
  const r = computeCoverage({
    asOf, zones: [{ mapId: 1429, name: "Elwynn Forest" }],
    records: Array.from({ length: 5 }, (_, i) => ({
      kind: "npc_sighting", installId: `private-${i}`, npcId: 123, name: "Agreed name",
      mapId: 1429, x: 42, y: 65, positionKind: "interaction", capturedAt: "2026-10-01T00:00:00.000Z",
    })),
    fileEntrances: [{ instanceMapIds: [36], zone: 1429 }],
  });
  const text = await call({}, async () => r);
  expect(text).toContain("5 distinct folded installs");
  expect(text).toContain("npcs: 1/[?] settled; 1/[?] confirmed");
  expect(text).toContain("entrances: 0/3 settled; 0/3 confirmed");
  expect(text).toContain("entrances.position: 0/1 settled; 0/1 confirmed");
  expect(text).not.toContain("private-");
});

test("unknown denominators, dates and build read [?], never a measured zero", async () => {
  const r = structuredClone(report());
  r.dataAsOf = null; r.build = null; r.expected = null;
  r.zones.find((z) => z.mapId === 1429)!.types.npcs.denominator = null;
  const text = await call({ zone: 1429 }, async () => r);
  expect(text).toContain("Data as of [?]");
  expect(text).toContain("build [?]");
  expect(text).toContain("0/[?] settled");
});

test("unavailable, disconnected and unknown zones are explicit", async () => {
  expect(await createToolHandlers({} as DB).coverage({})).toContain("not connected");
  expect(await call({}, async () => { throw new Error("private failure"); })).toContain("unavailable");
  expect(await call({ zone: 9999 })).toContain("No released zone matches");
});

test("scoped totals keep whole-fact settled-list counts separate, dated and counts-only", async () => {
  const text = await createToolHandlers({} as DB, {
    coverage: async () => report(),
    settledSummary: async (build) => ({ build, dataAsOf: "2026-10-21T12:00:00Z", facts: 17 }),
  }).coverage({ zone: 1429, type: "npcs" });
  expect(text).toContain("Whole-fact settled list: 17 facts; build test-build; data as of 2026-10-21T12:00:00Z");
  expect(text).toContain("entire build, before zone/type filters");
  expect(text).toContain("Scoped entity-field totals: 0 settled; 0 confirmed (includes settled); 1 still reported");
  expect(text).toContain("Fields needing one or two more installs: 1");
  expect(text).toContain("distinct agreeing installs [?] (not stored in the list)");
});

test("undated, wrong-build and failed settled lists are unknown, dated empty lists measure zero", async () => {
  for (const settledSummary of [
    async (build: string) => ({ build, dataAsOf: null, facts: 0 }),
    async () => ({ build: "wrong", dataAsOf: asOf, facts: 99 }),
    async () => { throw new Error("private failure"); },
  ]) {
    const text = await createToolHandlers({} as DB, { coverage: async () => report(), settledSummary }).coverage({});
    expect(text).toContain("Whole-fact settled list: [?] facts");
    expect(text).not.toMatch(/99 facts|private failure/);
  }
  const text = await createToolHandlers({} as DB, {
    coverage: async () => report(), settledSummary: async (build) => ({ build, dataAsOf: asOf, facts: 0 }),
  }).coverage({});
  expect(text).toContain("Whole-fact settled list: 0 facts");
});

test("a capped list never invents an exhaustive type-filtered needs count", async () => {
  const r = report();
  r.zones[0]!.needsTotal = 999;
  const text = await call({ zone: r.zones[0]!.mapId, type: "npcs" }, async () => r);
  expect(text).toContain("Fields needing one or two more installs: [?]");
});

test("the date line says whether the score is the stored report or computed live, and stays as it was when the host does not say", async () => {
  expect(await call({}, async () => ({ ...report(), source: "stored" as const }))).toContain(`Data as of ${asOf} (stored report, written by the snapshot cron for this build); build test-build`);
  expect(await call({}, async () => ({ ...report(), source: "live" as const }))).toContain(`Data as of ${asOf} (computed from the corpus now: no stored report for this build was usable); build test-build`);
  expect(await call()).toContain(`Data as of ${asOf}; build test-build`);
});
