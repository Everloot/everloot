import { readFileSync } from "node:fs";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { expect, test } from "vitest";
import { BRIDGE_PLAN, handlePlan, planIds, renderTracker } from "../src/bridge-plan.js";
import { openDb } from "../src/db.js";
import { startHttpBridge } from "../src/mcp-http.js";

test("every tracker row has a unique id", () => {
  const ids = planIds();
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain("mcp.everloot_plan");
  expect(ids).toContain("mcp.http_local");
  expect(ids).toContain("ops.beta_guild");
});

test("the markdown file is the plan, not a second list", () => {
  // A Windows checkout with core.autocrlf writes CRLF; the content is what must match.
  const disk = readFileSync(new URL("../../docs/TRACKER.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  expect(disk.trim()).toBe(renderTracker().trim());
  expect(renderTracker()).toContain("not the Forever beta character");
  for (const args of [{}, { detail: true, limit: 100 }]) expect(handlePlan(args).text).not.toContain("Hakoovak");
  // The note travels with the reference rows it is about.
  expect(handlePlan({ status: "shape" }).text).toContain("not the Forever beta character");
});

test("live, next, waiting, and shape rows are all present", () => {
  const counts = Object.fromEntries(
    (["live", "next", "waiting", "shape"] as const).map((status) => [
      status,
      BRIDGE_PLAN.filter((row) => row.status === status).length,
    ]),
  );
  expect(counts.live).toBeGreaterThan(0);
  expect(counts.next).toBeGreaterThan(0);
  expect(counts.waiting).toBeGreaterThan(0);
  expect(counts.shape).toBeGreaterThan(0);
});

test("every live and next row says how far it is proven", () => {
  for (const row of BRIDGE_PLAN.filter((r) => r.status === "live" || r.status === "next")) {
    expect(row.proof, row.id).toBeDefined();
  }
  expect(renderTracker()).toContain("| Id | Name | Proven | Done when |");
});

test("rows match the code and the launch scope", () => {
  const row = (id: string) => BRIDGE_PLAN.find((r) => r.id === id);
  // The addon has never run in the Forever client, so it is not Live.
  expect(row("addon.skeleton")?.status).not.toBe("live");
  expect(row("site.home")?.done).toContain("https://everloot.app");
  // MCP tools read the web's sanitized public corpus first, not a raw upload folder.
  for (const r of BRIDGE_PLAN) expect(r.done, r.id).not.toContain("The tool reads EVERLOOT_UPLOADS when it is set");
  for (const id of ["site.signin", "site.sharing", "ops.health", "ops.quotas", "app.uploader", "app.companion"]) {
    expect(row(id), id).toBeDefined();
  }
  // Merged 2026-10-10: companion uploader and /ask bridge (#18-#20), gold quest/vendor/flight (#10), /mcp route (#17).
  expect(row("app.uploader")?.proof).toBe("code");
  expect(row("app.companion")?.proof).toBe("code");
  expect(row("tool.gold_ledger")?.done).not.toMatch(/Left: quest, vendor/);
  // Addon 0.2.4 records mailed auction sales.
  expect(row("tool.gold_ledger")?.done).not.toMatch(/Left: auction,/);
  expect(row("mcp.public_https")?.done).toContain("/mcp");
  // Production /mcp answers since 2026-10-10 (#26 R2 release fetch); provider adapters merged in #23.
  expect(row("mcp.public_https")?.proof).toBe("deployed");
  expect(row("mcp.public_https")?.done).not.toMatch(/answers 503/);
  expect(row("app.companion")?.done).not.toMatch(/adapters are next/);
});

test("loopback HTTP MCP answers initialize and lists everloot_plan", async () => {
  const db = openDb(":memory:");
  const http = await startHttpBridge(db, 0);
  const { port } = http.address() as AddressInfo;
  try {
    const init = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "everloot-test", version: "0" },
        },
      }),
    });
    expect(init.status).toBe(200);
    const initBody = await init.json();
    expect(initBody.result.serverInfo.name).toBe("everloot-knowledge");

    const listed = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(listed.status).toBe(200);
    const tools = await listed.json();
    const names = tools.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("everloot_plan");
    expect(names).toContain("search_knowledge");
    expect(names).toContain("profession_path");
    expect(names).toContain("item_page");
    expect(names).toContain("npc_page");
    expect(names).toContain("quest_page");
    expect(names).toContain("vendor_page");
    expect(names).toContain("collection_gap");
    expect(names).toContain("guild_board");
    expect(names).toContain("auction_history");
    expect(names).toContain("market_value");
  } finally {
    http.close();
    await once(http, "close");
  }
});
