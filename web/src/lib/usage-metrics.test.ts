import { describe, expect, it, vi } from "vitest";
import { mcpToolMetrics, recordUsage } from "./usage-metrics";

const env = { EVERLOOT_USAGE_METRICS: "1", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" };

describe("mcpToolMetrics", () => {
  it("names known tools and collapses unknown ones", () => {
    const body = JSON.stringify([
      { jsonrpc: "2.0", method: "tools/call", params: { name: "search_knowledge", arguments: { query: "secret words" } } },
      { jsonrpc: "2.0", method: "tools/call", params: { name: "made_up_name_123" } },
      { jsonrpc: "2.0", method: "tools/list" },
    ]);
    expect(mcpToolMetrics(body, "mcp_public")).toEqual(["mcp_public.search_knowledge", "mcp_public.other"]);
  });

  it("knows every tool the protocol publishes, answer_sources included", () => {
    const body = JSON.stringify(["answer_sources", "market_value", "talent_tree"].map((name) => ({ jsonrpc: "2.0", method: "tools/call", params: { name } })));
    expect(mcpToolMetrics(body, "mcp")).toEqual(["mcp.answer_sources", "mcp.market_value", "mcp.talent_tree"]);
  });

  it("ignores malformed bodies", () => {
    expect(mcpToolMetrics("not json", "mcp")).toEqual([]);
  });
});

describe("recordUsage", () => {
  it("does nothing unless EVERLOOT_USAGE_METRICS=1", async () => {
    const f = vi.fn();
    recordUsage("api.intake", { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: "s" }, f as unknown as typeof fetch);
    await new Promise((r) => setTimeout(r, 0));
    expect(f).not.toHaveBeenCalled();
  });

  it("sends only the metric name", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    recordUsage("api.intake", env, f as unknown as typeof fetch);
    await vi.waitFor(() => expect(f).toHaveBeenCalledOnce());
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/rest/v1/rpc/bump_usage_counter");
    expect(init.body).toBe(JSON.stringify({ p_metric: "api.intake" }));
  });

  it("rejects invalid metric names and swallows fetch errors", async () => {
    const f = vi.fn(async () => { throw new Error("down"); });
    recordUsage(["Bad Name", "api.ok"], env, f as unknown as typeof fetch);
    await vi.waitFor(() => expect(f).toHaveBeenCalledOnce());
  });
});
