/** Bounded, read-only launch check. Run from web/: npx tsx scripts/check-public-mcp.mts.
 * Prints statuses and validation results, never response bodies or caller credentials.
 * Schema success is not proof of factual accuracy or an in-app ChatGPT acceptance pass.
 */
import { MCP_TOOL_NAMES, MCP_TOOLS } from "@everloot/protocol";
import { z } from "zod";
import { encodeBuild } from "../src/lib/talents/share";

const endpoint = "https://everloot.app/mcp/public";
let id = 0;
let halted = false;
async function rpc(method: string, params: object) {
  const response = await fetch(endpoint, {
    method: "POST", signal: AbortSignal.timeout(45_000),
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": "everloot-launch-check/1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  }).catch(() => { halted = true; throw new Error("Network request failed; remaining requests skipped"); });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500) halted = true;
    throw new Error(`HTTP ${response.status}; retry-after ${response.headers.get("retry-after") ?? "absent"}`);
  }
  const text = await response.text();
  const json = response.headers.get("content-type")?.includes("text/event-stream")
    ? text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n") : text;
  const result = JSON.parse(json);
  if (result.error) throw new Error(`JSON-RPC error ${result.error.code}`);
  return result.result;
}

const cases: Record<string, object> = {
  search_knowledge: { query: "Thrall", limit: 1 }, get_by_name: { name: "Thrall" },
  search: { query: "Thrall" }, answer_sources: { question: "Which bosses are in Deadmines?" },
  profession_path: { profession: "Alchemy", toSkill: 10 }, recipe_thresholds: { profession: "Alchemy" },
  item_page: { itemId: 2589 }, npc_page: { npcId: 639 }, object_page: { objectId: 1731 }, quest_page: { questId: 166 },
  vendor_page: { vendorNpcId: 1257 }, world_map_near: { zone: "1429", x: 40, y: 60 },
  entity_relations: { kind: "item", id: 19019 }, item_categories: {}, talent_tree: { class: "mage" },
  class_races: { class: "mage" }, collection_gap: { collection: "Mounts", ownerInstallId: "launch-check-unrecorded" },
  completion_progress: { ownerInstallId: "launch-check-unrecorded" },
  guild_board: { guildName: "Everloot launch check", realm: "Unrecorded launch check" },
  guild_search: { query: "Everloot launch check" }, guild_rankings: {},
  auction_history: { realm: "Unrecorded launch check", itemId: 2589 }, market_value: { realm: "Unrecorded launch check", itemId: 2589 },
  gold_ledger: { character: "Unrecorded launch check", realm: "Unrecorded launch check" },
  coverage: {}, population: {}, recent_changes: { limit: 1 }, ecosystem_projects: { limit: 1 }, everloot_plan: {},
};

let failures = 0;
console.log(`Public MCP check: ${new Date().toISOString()}\n`);
console.log("| Check | Result |\n|---|---|");
async function check(label: string, run: () => Promise<void>) {
  if (halted) { console.log(`| ${label} | SKIP: prior access denial, throttle or service failure |`); return; }
  try { await run(); console.log(`| ${label} | PASS |`); }
  catch (error) { failures++; console.log(`| ${label} | FAIL: ${error instanceof Error ? error.message.replace(/[|\r\n]/g, " ") : "request failed"} |`); }
}

await check("initialize", async () => {
  const result = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "everloot-launch-check", version: "1" } });
  if (result.serverInfo?.name !== "everloot-knowledge") throw new Error("Unexpected server identity");
});
await check("tools/list: names, read-only annotations and schemas", async () => {
  const result = await rpc("tools/list", {});
  const names = result.tools.map((tool: { name: string }) => tool.name).sort();
  if (JSON.stringify(names) !== JSON.stringify([...MCP_TOOL_NAMES].sort())) throw new Error("Tool list differs from protocol");
  for (const tool of result.tools) {
    if (!tool.title || tool.annotations?.readOnlyHint !== true) throw new Error(`Incomplete descriptor: ${tool.name}`);
    if ("outputSchema" in MCP_TOOLS[tool.name as keyof typeof MCP_TOOLS] && !tool.outputSchema) throw new Error(`Missing output schema: ${tool.name}`);
  }
});

// Use real search IDs instead of assuming release-specific record IDs.
await check("search/fetch lookup IDs", async () => {
  const search = await rpc("tools/call", { name: "search", arguments: { query: "Thrall" } });
  const record = search.structuredContent?.results?.[0];
  if (!record?.id) throw new Error("No lore search result");
  cases.fetch = { id: String(record.id) };
  cases.get_entity = { id: Number(record.id) };
});
for (const name of MCP_TOOL_NAMES) {
  await check(name, async () => {
    if (!cases[name]) throw new Error("No safe case available");
    const input = z.object(MCP_TOOLS[name].inputSchema).strict().safeParse(cases[name]);
    if (!input.success) throw new Error(`Probe input differs from protocol: ${name}`);
    const result = await rpc("tools/call", { name, arguments: input.data });
    if (result.isError) throw new Error("Tool returned an error");
    const definition = MCP_TOOLS[name];
    if ("outputSchema" in definition) {
      const parsed = z.object(definition.outputSchema).strict().safeParse(result.structuredContent);
      if (!parsed.success) throw new Error(`Output schema mismatch at ${parsed.error.issues[0]?.path.join(".") || "root"}`);
    }
    if (!result.content?.some((part: { type: string; text?: string }) => part.type === "text" && part.text)) throw new Error("No text fallback");
    if (name === "talent_tree") {
      const build = result.structuredContent?.build;
      if (typeof build !== "string") throw new Error("No current talent build");
      cases.talent_plan = { code: encodeBuild({ classSlug: "mage", specId: 0, build, ranks: {} }) };
    }
    if (name === "talent_plan" && result.structuredContent?.ok !== true) throw new Error("Current-build empty plan was not readable");
  });
}
await check("talent_plan: invalid share code is refused", async () => {
  const result = await rpc("tools/call", { name: "talent_plan", arguments: { code: "invalid-launch-check-code" } });
  const parsed = z.object(MCP_TOOLS.talent_plan.outputSchema).safeParse(result.structuredContent);
  if (!parsed.success || parsed.data.ok !== false || !parsed.data.message) throw new Error("Invalid plan was not explicitly refused");
});
await check("unknown item: no invented name or drops", async () => {
  const result = await rpc("tools/call", { name: "item_page", arguments: { itemId: 999999999 } });
  const parsed = z.object(MCP_TOOLS.item_page.outputSchema).strict().safeParse(result.structuredContent);
  if (!parsed.success || parsed.data.page?.name || parsed.data.page?.drops.length) throw new Error("Unknown item was not left unrecorded");
});
console.log(`\n${failures ? `${failures} failed checks` : "All checks passed"}. Empty-data responses require separate content review; this check does not create player observations.`);
process.exitCode = failures ? 1 : 0;
