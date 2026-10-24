import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCP_TOOL_NAMES } from "@everloot/protocol";

/** The keyless list with EVERLOOT_GUILDS off: the protocol's tools less the guild ladder's two. */
const PUBLIC_NAMES = MCP_TOOL_NAMES.filter((name) => name !== "guild_search" && name !== "guild_rankings");
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { MY_BUILDS_REFUSAL } from "@/lib/saved-builds";
import { openDb } from "../../../../../kb/src/db";
import { replaceSourceRows } from "../../../../../kb/src/entities";
import { snapshot } from "../../../../../kb/src/snapshot";

const deps = vi.hoisted(() => ({ mcp: vi.fn(), loadCorpus: vi.fn() }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { mcp: deps.mcp } }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { loadCorpus: deps.loadCorpus } }));

let release = "";
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-public-mcp-"));
  const source = openDb(join(dir, "source.sqlite"));
  await replaceSourceRows(source, "curated", ["lore_page"], [{ kind: "lore_page", extId: "1", name: "Thrall",
    body: "Warchief of the Horde", gameVersion: "lore", sourceUrl: "https://example.test/thrall", retrievedAt: "2023-11-13" }]);
  release = join(dir, "release", "release.sqlite");
  snapshot(source, release, new Date("2026-10-10T00:00:00Z"));
  source.close();
});
beforeEach(() => {
  deps.mcp.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  deps.loadCorpus.mockReset().mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-10T06:30:00.000Z" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function route(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("./route");
}
const initialize = () => new Request("https://everloot.app/mcp/public", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "chatgpt", version: "1" } } }),
});

test("closed unless EVERLOOT_MCP_PUBLIC=1", async () => {
  const { POST } = await route({ KB_SNAPSHOT_PATH: release, EVERLOOT_MCP_PUBLIC: "" });
  expect((await POST(initialize())).status).toBe(404);
  expect(deps.mcp).not.toHaveBeenCalled();
});

test("open: no bearer needed, the shared per-IP quota is consumed first", async () => {
  const { POST } = await route({ KB_SNAPSHOT_PATH: release, EVERLOOT_MCP_PUBLIC: "1", EVERLOOT_MCP_TOKEN: "" });
  const res = await POST(initialize());
  expect(res.status).toBe(200);
  expect((await res.json()).result.serverInfo.name).toBe("everloot-knowledge");
  expect(deps.mcp).toHaveBeenCalledTimes(1);
});

test("a spent quota is 429 with retry-after; a quota outage fails closed", async () => {
  deps.mcp.mockResolvedValueOnce({ allowed: false, retryAfter: 90 });
  const { POST } = await route({ KB_SNAPSHOT_PATH: release, EVERLOOT_MCP_PUBLIC: "1" });
  const limited = await POST(initialize());
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("90");
  deps.mcp.mockRejectedValueOnce(new Error("Quota storage unavailable"));
  expect((await POST(initialize())).status).toBe(503);
});

test("every answer carries the licence and credit line in its headers", async () => {
  const { POST } = await route({ KB_SNAPSHOT_PATH: release, EVERLOOT_MCP_PUBLIC: "1" });
  const res = await POST(initialize());
  expect(res.status).toBe(200);
  expect(res.headers.get("x-everloot-licence")).toBe("CC BY-SA 4.0");
  expect(res.headers.get("x-everloot-credit")).toBe("Data from Everloot (https://everloot.app), CC BY-SA 4.0.");
  expect((await res.json()).result.instructions).toContain("Data from Everloot (https://everloot.app), CC BY-SA 4.0.");
});

describe("my_builds, the account tool", () => {
  const KEY = `evl_${"a".repeat(64)}`;
  const rpc = (method: string, params: object, key?: string) => new Request("https://everloot.app/mcp/public", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }),
  });
  /** Supabase: every key is live; `scopes` decides read:own, and own_builds_for_key answers with no builds. */
  function database(scopes: string[]) {
    const send = vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/rpc/consume_api_key")) return Response.json([{ allowed: true, retry_after: 0, key_ref: crypto.randomUUID() }]);
      if (path.includes("/api_keys?")) return Response.json([{ scopes, expires_at: null }]);
      if (path.includes("/rpc/own_builds_for_key")) {
        return Response.json([scopes.includes("read:own")
          ? { refusal: null, retry_after: 0, characters: [], builds: [] }
          : { refusal: "no_scope", retry_after: 0, characters: null, builds: null }]);
      }
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal("fetch", send);
    return send;
  }
  const env = (savedBuilds: string) => ({ KB_SNAPSHOT_PATH: release, EVERLOOT_MCP_PUBLIC: "1", EVERLOOT_DATA_GUARD: "1", EVERLOOT_SAVED_BUILDS: savedBuilds,
    SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "service" });
  const listed = async (res: Response) => ((await res.json()).result.tools as { name: string }[]).map((t) => t.name);
  afterEach(() => vi.unstubAllGlobals());

  test("the keyless list is exactly the protocol's tools, and a call is refused in words", async () => {
    const send = database(["read:public", "read:own"]);
    const { POST } = await route(env("1"));
    expect(await listed(await POST(rpc("tools/list", {})))).toEqual(PUBLIC_NAMES);
    const called = (await (await POST(rpc("tools/call", { name: "my_builds", arguments: {} }))).json()).result;
    expect(called).toEqual({ content: [{ type: "text", text: MY_BUILDS_REFUSAL }], isError: true });
    expect(send).not.toHaveBeenCalled();
  });

  test("a key without read:own sees the public list and gets the refusal", async () => {
    database(["read:public"]);
    const { POST } = await route(env("1"));
    expect(await listed(await POST(rpc("tools/list", {}, KEY)))).toEqual(PUBLIC_NAMES);
    const called = (await (await POST(rpc("tools/call", { name: "my_builds", arguments: {} }, KEY))).json()).result;
    expect(called.isError).toBe(true);
    expect(called.content[0].text).toBe(MY_BUILDS_REFUSAL);
  });

  test("with the switch off even a read:own key sees the public list only", async () => {
    database(["read:public", "read:own"]);
    const { POST } = await route(env(""));
    expect(await listed(await POST(rpc("tools/list", {}, KEY)))).toEqual(PUBLIC_NAMES);
  });

  test("a read:own key gets my_builds after the public tools, and it answers", async () => {
    const send = database(["read:public", "read:own"]);
    const { POST } = await route(env("1"));
    expect(await listed(await POST(rpc("tools/list", {}, KEY)))).toEqual([...PUBLIC_NAMES, "my_builds"]);
    const called = (await (await POST(rpc("tools/call", { name: "my_builds", arguments: {} }, KEY))).json()).result;
    expect(called.isError).not.toBe(true);
    expect(called.content[0].text).toContain("No saved builds yet.");
    expect(send.mock.calls.map((c) => String(c[0]))).toContainEqual(expect.stringContaining("/rpc/own_builds_for_key"));
  });
});

test("guard on: a free key spends its own allowance instead of the per-IP one; a refused caller is pointed at it", async () => {
  const send = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    Response.json([{ allowed: true, retry_after: 0, key_ref: crypto.randomUUID() }]));
  vi.stubGlobal("fetch", send);
  try {
    const { POST } = await route({ KB_SNAPSHOT_PATH: release, EVERLOOT_MCP_PUBLIC: "1", EVERLOOT_DATA_GUARD: "1",
      SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "service" });
    const keyed = initialize();
    keyed.headers.set("authorization", `Bearer evl_${"a".repeat(64)}`);
    expect((await POST(keyed)).status).toBe(200);
    expect(deps.mcp).not.toHaveBeenCalled();
    expect(String(send.mock.calls[0][0])).toContain("/rpc/consume_api_key");
    deps.mcp.mockResolvedValueOnce({ allowed: false, retryAfter: 90 });
    const limited = await POST(initialize());
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toContain("https://everloot.app/docs/api/keys");
  } finally { vi.unstubAllGlobals(); }
});
