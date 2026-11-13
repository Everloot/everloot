import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ status: 200, record: vi.fn(), handler: vi.fn(), stored: vi.fn(), scopes: [] as import("../../../kb/src/coverage").RecheckScope[] }));
vi.mock("../../../kb/src/mcp-http-server", () => ({
  createMcpHttpHandler: () => async (req: Request) => {
    hoisted.handler(await req.text());
    return new Response("{}", { status: hoisted.status });
  },
}));
vi.mock("./release", () => ({ getRelease: () => ({ db: {} }) }));
vi.mock("./upload-store", () => ({ uploadStore: {} }));
vi.mock("./usage-metrics", async (importActual) => ({ ...(await importActual<typeof import("./usage-metrics")>()), recordUsage: hoisted.record }));

import { createMount, toolLoaders } from "./mcp-mount";
import { loadCoverageForTool } from "./coverage-answer";
import { RECHECK_SCOPES } from "./recheck-scopes";
import { readSettledList } from "./settled-store";
import { emptySettledList } from "../../../kb/src/settled-list";
import { createToolHandlers } from "../../../kb/src/mcp-server";
import { openDb } from "../../../kb/src/db";
import { uploadStore } from "./upload-store";
import { anonymousAggregates, encodeAggregates, parseAggregates } from "./aggregate-store";
import type { IntakeRecord } from "@everloot/protocol";
import { answerSourcesFactsFromRecords } from "../../../kb/src/answer-sources";

vi.mock("./recheck-scopes", () => ({ RECHECK_SCOPES: hoisted.scopes }));

vi.mock("./aggregate-store", async (actual) => ({ ...(await actual<typeof import("./aggregate-store")>()), loadStoredAggregates: hoisted.stored }));

vi.mock("./coverage-answer", () => ({ loadCoverageForTool: vi.fn(async () => null) }));
vi.mock("./settled-store", () => ({ readSettledList: vi.fn() }));

it("mount readers expose agreed gameplay names and released UiMap ids through generic tools", async () => {
  const records = ["a", "b", "c"].map((installId) => ({ kind: "item_seen", installId, itemId: 2589, name: "Linen Cloth" }));
  Object.assign(uploadStore, { loadCorpus: async () => ({ records, dataAsOf: "2026-11-10T00:00:00Z" }) });
  const db = openDb(":memory:");
  try {
    const h = createToolHandlers(db, toolLoaders());
    const item = await h.search_knowledge({ query: "Linen Cloth", kind: "item", limit: 3 });
    expect(item).toMatchObject({ structured: { hits: [{ gameId: 2589, sourceKind: "observed" }] } });
    const zone = await h.get_by_name({ name: "Elwynn Forest", kind: "zone" });
    expect(zone).toMatchObject({ structured: { hits: [{ gameId: 1429, sourceKind: "game-files" }] } });
  } finally { db.close(); }
});

it("lends only the persisted settled list's count and date, never its identifiers", async () => {
  const list = { ...emptySettledList("1.60.1.70450"), dataAsOf: "2026-11-06T00:00:00Z", quest: [123, 1], vendor: [456] };
  vi.mocked(readSettledList).mockResolvedValueOnce(list);
  expect(await toolLoaders().settledSummary!(list.build)).toEqual({ build: list.build, dataAsOf: list.dataAsOf, facts: 3 });
  expect(readSettledList).toHaveBeenCalledWith(list.build);
});

it("lends MCP and HTTP tools the stored-report reader, not the corpus one", async () => {
  expect(await toolLoaders().coverage!()).toBeNull();
  expect(loadCoverageForTool).toHaveBeenCalledOnce();
});

it("lends the curated recheck scopes, so the page tools honour the coverage cut-off", () => {
  expect(toolLoaders().recheck).toBe(RECHECK_SCOPES);
});

const call = (name: string) => ({ jsonrpc: "2.0", method: "tools/call", params: { name } });
function post(body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  return new Request("https://everloot.app/mcp/public", { method: "POST", body: text, headers: { "content-length": String(text.length), ...headers } });
}

beforeEach(() => { hoisted.status = 200; });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("mcp mount usage counting", () => {
  it("counts nothing by default and still passes the body to the handler", async () => {
    const res = await createMount({ path: "/mcp/public", bearer: false })(post(call("search_knowledge")));
    expect(res.status).toBe(200);
    expect(hoisted.record).not.toHaveBeenCalled();
    expect(hoisted.handler).toHaveBeenCalledWith(expect.stringContaining("search_knowledge"));
  });

  it("counts a 2xx tool call by name when enabled", async () => {
    vi.stubEnv("EVERLOOT_USAGE_METRICS", "1");
    await createMount({ path: "/mcp/public", bearer: false })(post(call("search_knowledge")));
    expect(hoisted.record).toHaveBeenCalledWith(["mcp_public.search_knowledge"]);
    expect(hoisted.handler).toHaveBeenCalledWith(expect.stringContaining("search_knowledge"));
  });

  it.each([401, 403, 429, 500])("does not count a %i response", async (status) => {
    vi.stubEnv("EVERLOOT_USAGE_METRICS", "1");
    hoisted.status = status;
    await createMount({ path: "/mcp/public", bearer: false })(post(call("search_knowledge")));
    expect(hoisted.record).not.toHaveBeenCalled();
  });

  it("does not read bodies over 1 MB or without a declared length", async () => {
    vi.stubEnv("EVERLOOT_USAGE_METRICS", "1");
    const mount = createMount({ path: "/mcp/public", bearer: false });
    await mount(post(call("search_knowledge"), { "content-length": "1048577" }));
    const noLength = new Request("https://everloot.app/mcp/public", { method: "POST", body: JSON.stringify(call("get_entity")) });
    await mount(noLength);
    expect(hoisted.record).not.toHaveBeenCalled();
  });

  it("caps a batched request at five counted calls", async () => {
    vi.stubEnv("EVERLOOT_USAGE_METRICS", "1");
    await createMount({ path: "/mcp", bearer: false })(post(Array.from({ length: 12 }, () => call("get_entity"))));
    expect(hoisted.record.mock.calls[0][0]).toHaveLength(5);
  });
});


describe("stored answer_sources facts", () => {
  const date = "2026-11-10T00:00:00Z";
  const records = ["a", "b", "c"].flatMap((installId) => [
    { kind: "item_seen", installId, itemId: 1234, name: "Synthetic Cloth", capturedAt: date },
    { kind: "npc_sighting", installId, npcId: 456, name: "Synthetic Spider", mapId: 141, x: 40, y: 61, positionKind: "npc", capturedAt: date },
    ...Array.from({ length: 4 }, (_, i) => ({ kind: "loot", installId, sourceNpcId: 456, sourceEvidence: "loot-api", items: i === 0 ? [{ itemId: 1234, count: 1 }] : [], capturedAt: date })),
    { kind: "vendor", installId, vendorNpcId: 456, items: [{ itemId: 1234, priceCopper: 10 }], capturedAt: date },
    { kind: "guild_snapshot", installId, guildName: "Unpublished Guild", realm: "Realm Four", members: [{ name: "Suppressed Player", rank: "Officer", level: 20, class: "Rogue" }] },
    { kind: "gear_snapshot", installId, character: "Suppressed Player", realm: "Realm Four", equipped: [] },
  ]);
  function stored() {
    return parseAggregates(encodeAggregates(anonymousAggregates({ uploads: 3, records: records as unknown as IntakeRecord[], dataAsOf: date }), date))!.set;
  }

  it("answers the fixed question set identically using stored facts without a corpus/publication read", async () => {
    const loadCorpus = vi.fn(async () => { throw new Error("must not read or publish corpus"); });
    Object.assign(uploadStore, { loadCorpus });
    hoisted.stored.mockResolvedValue(stored());
    const db = openDb(":memory:");
    try {
      const old = createToolHandlers(db, { corpus: async () => ({ records, dataAsOf: date }), recheck: RECHECK_SCOPES });
      const next = createToolHandlers(db, { ...toolLoaders(), gameData: undefined });
      const answers = [];
      for (const question of ["Where does Synthetic Cloth drop?", "Where is Synthetic Spider?", "Who is Unpublished Guild?", "Where is Suppressed Player?", "Who sells Synthetic Cloth?"]) {
        const args = { question, limit: 8 };
        const before = await old.answer_sources(args);
        const after = await next.answer_sources(args);
        expect(after).toEqual(before);
        answers.push(after);
      }
      expect(answers).toMatchSnapshot();
      expect(JSON.stringify(stored())).not.toMatch(/Unpublished Guild|Suppressed Player/);
      expect(JSON.stringify(answers)).not.toContain("Officer");
      expect(JSON.stringify(answers)).not.toContain("Suppressed Player was seen");
      expect(loadCorpus).not.toHaveBeenCalled();
      expect(hoisted.stored).toHaveBeenCalledWith({ strict: true });
      expect(answerSourcesFactsFromRecords(records, RECHECK_SCOPES).items.rates.length).toBeGreaterThan(0);
    } finally { db.close(); }
  });

  it("honours nonempty recheck scopes in the stored and live answer paths", async () => {
    hoisted.scopes.push({ since: "2026-11-11T00:00:00Z", source: "synthetic test", type: "drops", ids: [456] });
    const db = openDb(":memory:");
    try {
      hoisted.stored.mockResolvedValue(stored());
      const args = { question: "Where does Synthetic Cloth drop?", limit: 8 };
      const before = await createToolHandlers(db, { corpus: async () => ({ records, dataAsOf: date }), recheck: RECHECK_SCOPES }).answer_sources(args);
      const after = await createToolHandlers(db, { ...toolLoaders(), gameData: undefined }).answer_sources(args);
      expect(after).toEqual(before);
      expect(JSON.stringify(after)).not.toContain("loot windows");
    } finally { hoisted.scopes.pop(); db.close(); }
  });

  it.each(["missing", "obsolete scopes"])("keeps lore available without a corpus replay when the stored set is %s", async (failure) => {
    const set = stored();
    set.world.recheck = [{ since: "2099-01-01T00:00:00Z", source: "synthetic test", type: "npcs" }];
    hoisted.stored.mockResolvedValue(failure === "missing" ? null : set);
    const loadCorpus = vi.fn(async () => { throw new Error("no corpus replay"); });
    Object.assign(uploadStore, { loadCorpus });
    const db = openDb(":memory:");
    try {
      const result = await createToolHandlers(db, { ...toolLoaders(), gameData: undefined }).answer_sources({ question: "Where is Synthetic Spider?", limit: 8 });
      if (typeof result === "string") throw new Error("expected structured answer");
      expect(result.text).toContain("Player observations could not be read");
      expect(result.structured).toMatchObject({ evidence: [], dataAsOf: null });
      expect(loadCorpus).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
});
