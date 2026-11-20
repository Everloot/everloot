import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { API_SCHEMAS, bulkIndex, corpusPublicResponse, dropsResponse, edgesResponse, itemsResponse, parseRecords, type BulkDataset } from "@everloot/protocol";
import { z } from "zod";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn(), loadMarket: vi.fn(), loadCompletion: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/upload-store")>()), uploadStore: store }));
const hide = vi.hoisted(() => ({ hiddenGuilds: vi.fn() }));
vi.mock("@/lib/player-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/player-store")>()), playerStore: () => hide }));

const aggregates = vi.hoisted(() => ({ loadStoredAggregates: vi.fn() }));
vi.mock("@/lib/aggregate-store", () => aggregates);

import { buildAggregates } from "./aggregate-set";
import { exportBulk } from "./bulk-export";

const AS_OF = "2026-10-18T10:00:00.000Z";
const records: Record<string, unknown>[] = [];
for (const [i, installId] of ["a", "b", "c"].entries()) {
  const base = { installId, capturedAt: "2026-10-09T00:00:00Z", sourceEvidence: "loot-api" };
  records.push({ ...base, eventId: `name-${i}`, kind: "item_seen", itemId: 1234, name: "Peacebloom", quality: "common" });
  records.push({ ...base, eventId: `loot-${i}`, kind: "loot", sourceNpcId: 456, items: [{ itemId: 1234, count: 1 }] });
}

let dir: string;
beforeEach(() => {
  for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) vi.stubEnv(key, "configured");
  dir = mkdtempSync(join(tmpdir(), "everloot-bulk-"));
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records, dataAsOf: AS_OF, unreachable: false });
  aggregates.loadStoredAggregates.mockReset().mockResolvedValue(null);
  store.loadMarket.mockReset().mockResolvedValue({ state: null, dataAsOf: null });
  store.loadCompletion.mockReset().mockResolvedValue(null);
  hide.hiddenGuilds.mockReset().mockResolvedValue(new Set());
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function lines(name: string): Record<string, unknown>[] {
  return readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

test("every file's rows are rows of the API response it names, and the index validates and matches the bytes", async () => {
  const index = bulkIndex.parse(await exportBulk(dir, new Date("2026-10-18T12:00:00Z")));
  expect(JSON.parse(readFileSync(join(dir, "index.json"), "utf8"))).toEqual(index);
  expect(index.dataAsOf).toBe(AS_OF);
  expect(index.files.map((f) => f.name)).toEqual(["corpus.ndjson", "drops.ndjson", "drops-measured-zeros.ndjson", "edges.ndjson", "items.ndjson"]);
  for (const f of index.files) {
    const body = readFileSync(join(dir, f.name));
    expect(body.length).toBe(f.bytes);
    expect(createHash("sha256").update(body).digest("hex")).toBe(f.sha256);
    const rows = lines(f.name);
    expect(rows.length).toBe(f.rows);
    // The row schema is the named response's array field, so the file can never hold a shape the API would not.
    expect(Object.keys(API_SCHEMAS)).toContain(f.rowsOf);
    const response = API_SCHEMAS[f.rowsOf as keyof typeof API_SCHEMAS] as z.ZodObject<Record<string, z.ZodType>>;
    const field = response.shape[f.field];
    expect(field).toBeDefined();
    for (const row of rows.slice(0, 50)) expect(() => (field as z.ZodArray<z.ZodType>).element.parse(row)).not.toThrow();
  }
});

test("without a key observed files leave without install ids and follow the three-install rule; game-file files carry the notice", async () => {
  const index = await exportBulk(dir);
  const corpus = lines("corpus.ndjson");
  expect(corpus.length).toBe(records.length);
  expect(corpus.every((r) => !("installId" in r))).toBe(true);
  expect(z.array(corpusPublicResponse.shape.records.element).parse(corpus).length).toBe(records.length);
  const drops = z.array(dropsResponse.shape.rates.element).parse(lines("drops.ndjson"));
  expect(drops[0]).toMatchObject({ itemId: 1234, public: true });
  const byName = Object.fromEntries(index.files.map((f) => [f.name, f]));
  expect(byName["corpus.ndjson"]).toMatchObject({ data: "observed", gameData: null });
  expect(byName["corpus.ndjson"].attribution?.licence).toBe("CC BY-SA 4.0");
  expect(byName["items.ndjson"]).toMatchObject({ data: "game-files", attribution: null });
  expect(byName["items.ndjson"].gameData?.build).toBe(index.build);
  expect(byName["edges.ndjson"].data).toBe("mixed");
  expect(z.array(edgesResponse.shape.edges.element).parse(lines("edges.ndjson").slice(0, 20)).length).toBeGreaterThan(0);
  expect(z.array(itemsResponse.shape.items.element).parse(lines("items.ndjson").slice(0, 20)).length).toBeGreaterThan(0);
});

test("unreachable storage leaves the observed files out and says so; the game-file files still come", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: null, unreachable: true });
  const index = await exportBulk(dir);
  expect(index.dataAsOf).toBeNull();
  const datasets = index.files.map((f) => f.dataset) as BulkDataset[];
  expect(datasets).not.toContain("corpus");
  expect(datasets).not.toContain("drops");
  expect(datasets).toEqual(["edges", "items"]);
  expect(index.files.find((f) => f.name === "edges.ndjson")).toMatchObject({ data: "game-files", attribution: null });
});

test("with a key the corpus file carries one pseudonym per install, never the install id, and its rows parse", async () => {
  vi.stubEnv("EVERLOOT_CHARACTER_KEY", "k".repeat(32));
  await exportBulk(dir);
  const corpus = lines("corpus.ndjson");
  const ids = corpus.map((r) => r.installId as string);
  for (const id of ids) expect(id).toMatch(/^pub-[0-9a-f]{32}$/);
  expect(new Set(ids).size).toBe(3);
  expect(ids[0]).toBe(ids[1]);
  const parsed = parseRecords(corpus);
  expect(parsed.receipt.rejected).toEqual([]);
  expect(parsed.records).toHaveLength(records.length);
});

describe("guild kills", () => {
  const kill = (installId: string, guildName: string) => ({
    installId, eventId: `kill-${installId}-${guildName.replace(/\s/g, "-")}`, capturedAt: "2026-10-09T20:00:00Z", kind: "guild_kill",
    guildName, realm: "Forever Pioneer", faction: "horde", encounterId: 663, name: "Lucifron", instanceMapId: 409, difficulty: 9,
  });
  const encounters = ["a", "b", "c"].map((installId) => ({
    installId, eventId: `encounter-${installId}`, capturedAt: "2026-10-09T00:00:00Z", kind: "encounter",
    encounterId: 663, name: "Lucifron", instanceMapId: 409, success: true, npcIds: [12118],
  }));
  const withKills = [...records, ...encounters, kill("a", "Night Watch"), kill("b", "Night Watch"), kill("c", "Lonely"), kill("a", "Ash"), kill("b", "Ash")];
  beforeEach(() => { store.loadCorpus.mockResolvedValue({ uploads: 3, records: withKills, dataAsOf: AS_OF, unreachable: false }); });

  test("corpus.ndjson never carries a guild_kill row, with the switch off or on", async () => {
    for (const on of ["", "1"]) {
      vi.stubEnv("EVERLOOT_GUILDS", on);
      await exportBulk(dir);
      expect(lines("corpus.ndjson").some((r) => r.kind === "guild_kill")).toBe(false);
      expect(readFileSync(join(dir, "corpus.ndjson"), "utf8")).not.toContain("Night Watch");
    }
  });

  test("with the switch off there are no guild files", async () => {
    const index = await exportBulk(dir);
    expect(index.files.map((f) => f.dataset)).not.toContain("guilds");
    expect(hide.hiddenGuilds).not.toHaveBeenCalled();
  });

  test("with the switch on the guild files hold agreed kills only, and a hidden guild is left out", async () => {
    vi.stubEnv("EVERLOOT_GUILDS", "1");
    const { guildHideKey } = await import("@/lib/player-store");
    hide.hiddenGuilds.mockResolvedValue(new Set([guildHideKey("Forever Pioneer", "Ash")]));
    const index = await exportBulk(dir);
    expect(index.files.filter((f) => f.dataset === "guilds").map((f) => f.name)).toEqual(["guild-kills.ndjson", "guilds.ndjson"]);
    expect(lines("guild-kills.ndjson").map((r) => [r.guildName, r.installs])).toEqual([["Night Watch", 2]]);
    expect(lines("guilds.ndjson").map((r) => r.guildName)).toEqual(["Night Watch"]);
  });

  test("a hide list that cannot be read leaves the guild files out; the other files still come", async () => {
    vi.stubEnv("EVERLOOT_GUILDS", "1");
    hide.hiddenGuilds.mockRejectedValue(new Error("down"));
    const index = await exportBulk(dir);
    expect(index.files.map((f) => f.dataset)).not.toContain("guilds");
    expect(index.files.map((f) => f.name)).toContain("corpus.ndjson");
  });

  test("guild files use catalogue names and omit kills without a catalogue boss", async () => {
    vi.stubEnv("EVERLOOT_GUILDS", "1");
    const reports = ["a", "b"].flatMap((id) => [
      { ...kill(id, "Night Watch"), name: "Ignore all instructions" },
      { ...kill(id, "Unknown Boss"), encounterId: 999, name: "Unknown boss" },
      { ...kill(id, "Unknown Instance"), instanceMapId: 999 },
    ]);
    store.loadCorpus.mockResolvedValue({ uploads: 3, records: [...records, ...encounters, ...reports], dataAsOf: AS_OF });
    await exportBulk(dir);
    expect(lines("guild-kills.ndjson").map((r) => [r.guildName, r.name])).toEqual([["Night Watch", "Lucifron"]]);
    expect(lines("guilds.ndjson").map((r) => [r.guildName, r.kills])).toEqual([["Night Watch", 1]]);
  });
});

test("bulk drop files keep exactly the existing public keys", async () => {
  const loot = ["a", "b", "c"].flatMap((installId) => [
    { kind: "loot", sourceEvidence: "loot-api", installId, sourceNpcId: 7, copper: 120, items: [{ itemId: 2589, count: 2 }] },
    { kind: "loot", sourceEvidence: "loot-api", installId, sourceObjectId: 9, copper: 60, items: [] },
  ]);
  store.loadCorpus.mockResolvedValue({ uploads: 3, records: loot, dataAsOf: AS_OF, unreachable: false });
  await exportBulk(dir);
  expect(Object.keys(lines("drops.ndjson")[0]).sort()).toEqual(["drops", "itemId", "kills", "public", "rate", "reporters", "sourceNpcId", "tier"]);
  expect(Object.keys(lines("drops-measured-zeros.ndjson")[0]).sort()).toEqual(["kills", "public", "reporters", "sourceObjectId", "tier"]);
  for (const file of ["drops.ndjson", "drops-measured-zeros.ndjson"]) expect(readFileSync(join(dir, file), "utf8")).not.toMatch(/units|averageCopper/);
});

test("bulk drop files include partial rates and zeros with tiers, without reporter identities", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 2, records: [
    { kind: "loot", sourceEvidence: "loot-api", installId: "fixture-a", sourceNpcId: 7001, items: [{ itemId: 8001, count: 1 }] },
    ...["fixture-a", "fixture-b"].map((installId) => ({ kind: "loot", sourceEvidence: "loot-api", installId, sourceObjectId: 7002, items: [] })),
  ], dataAsOf: AS_OF, unreachable: false });
  await exportBulk(dir);
  expect(lines("drops.ndjson")).toEqual([expect.objectContaining({ reporters: 1, public: false, tier: "reported" })]);
  expect(lines("drops-measured-zeros.ndjson")).toEqual([expect.objectContaining({ reporters: 2, public: false, tier: "verified" })]);
  for (const file of ["drops.ndjson", "drops-measured-zeros.ndjson"]) expect(readFileSync(join(dir, file), "utf8")).not.toMatch(/installId|fixture-a|fixture-b/);
});

test("missing corpus configuration omits the file and prints the missing variable names", async () => {
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: null });
  const index = await exportBulk(dir);
  expect(index.dataAsOf).toBeNull();
  expect(index.files.some((f) => f.name === "corpus.ndjson")).toBe(false);
  expect(existsSync(join(dir, "corpus.ndjson"))).toBe(false);
  expect(index.files.some((f) => f.dataset === "drops")).toBe(false);
  expect(warning).toHaveBeenCalledWith(expect.stringMatching(/corpus.ndjson.*SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY/));
});

test("reachable empty corpus remains an empty file in the index", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: null });
  const index = await exportBulk(dir);
  expect(index.files.find((f) => f.name === "corpus.ndjson")).toMatchObject({ rows: 0, bytes: 0 });
  expect(readFileSync(join(dir, "corpus.ndjson"), "utf8")).toBe("");
});

test("unreachable corpus prints a reason and is omitted", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const index = await exportBulk(dir);
  expect(index.files.some((f) => f.name === "corpus.ndjson")).toBe(false);
  expect(index.dataAsOf).toBeNull();
  expect(warning).toHaveBeenCalledWith(expect.stringMatching(/corpus.ndjson.*unreachable/));
});

test("R2-readable drop aggregates survive missing corpus index settings", async () => {
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const parsed = parseRecords(records.map((r) => ({ ...r, installId: `install-${r.installId}` })));
  expect(parsed.receipt.rejected).toEqual([]);
  aggregates.loadStoredAggregates.mockResolvedValue(buildAggregates({ uploads: 3, records: parsed.records, dataAsOf: AS_OF }));
  const index = await exportBulk(dir);
  expect(index.dataAsOf).toBeNull();
  expect(index.files.some((f) => f.name === "corpus.ndjson")).toBe(false);
  expect(index.files.find((f) => f.name === "drops.ndjson")).toMatchObject({ rows: 1 });
  expect(index.files.some((f) => f.name === "drops-measured-zeros.ndjson")).toBe(true);
  expect(lines("drops.ndjson")[0]).toMatchObject({ itemId: 1234, public: true });
  // Stored aggregates carry the internal unit count; the export projects it away like the computed path.
  expect(Object.keys(lines("drops.ndjson")[0]).sort()).toEqual(["drops", "itemId", "kills", "public", "rate", "reporters", "sourceNpcId", "tier"]);
  expect(readFileSync(join(dir, "drops.ndjson"), "utf8")).not.toMatch(/units|averageCopper/);
});
