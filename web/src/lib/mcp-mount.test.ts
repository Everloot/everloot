import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ status: 200, record: vi.fn(), handler: vi.fn() }));
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
