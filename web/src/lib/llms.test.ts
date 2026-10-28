import { MCP_PROMPT_NAMES, MCP_RESOURCE_TEMPLATE_URIS, MCP_RESOURCE_URIS, MCP_TOOL_NAMES } from "@everloot/protocol";
import { expect, test, vi } from "vitest";
import { liveToolNames } from "@/lib/guild-switch";
import { GET as llmsFull } from "@/app/llms-full.txt/route";
import { GET as llms } from "@/app/llms.txt/route";
import { tools, toolHref } from "@/data/tools";
import { FULL_VERSION, llmsFullTxt, llmsTxt } from "./llms";

const registered = liveToolNames();

test("both files list every MCP tool the protocol declares", async () => {
  expect(registered.length).toBeGreaterThan(0);
  for (const name of registered) {
    expect(llmsTxt()).toContain(name);
    expect(await llmsFullTxt()).toContain(`- ${name}: `);
  }
});

test("the guild ladder's two tools are listed only while EVERLOOT_GUILDS is on, and the count follows", async () => {
  expect(llmsTxt()).not.toContain("guild_search");
  expect(await llmsFullTxt()).not.toContain("guild_rankings");
  expect(llmsTxt()).toContain(`${MCP_TOOL_NAMES.length - 2} tools:`);
  vi.stubEnv("EVERLOOT_GUILDS", "1");
  try {
    expect(llmsTxt()).toContain("guild_search");
    expect(llmsTxt()).toContain(`${MCP_TOOL_NAMES.length} tools:`);
    expect(await llmsFullTxt()).toContain("- guild_rankings: ");
  } finally { vi.unstubAllEnvs(); }
});

test("both files list every MCP resource and prompt the protocol declares", async () => {
  expect(MCP_RESOURCE_URIS.length).toBeGreaterThan(0);
  for (const uri of MCP_RESOURCE_URIS) {
    expect(llmsTxt()).toContain(uri);
    expect(await llmsFullTxt()).toContain(`- ${uri}: `);
  }
  for (const uri of MCP_RESOURCE_TEMPLATE_URIS) expect(await llmsFullTxt()).toContain(`- ${uri}: `);
  expect(MCP_PROMPT_NAMES.length).toBeGreaterThan(0);
  for (const name of MCP_PROMPT_NAMES) {
    expect(llmsTxt()).toContain(name);
    expect(await llmsFullTxt()).toContain(`- ${name}: `);
  }
});

test("both files list every live and collecting tool, the changes pages, connect and the open endpoints", async () => {
  for (const text of [llmsTxt(), await llmsFullTxt()]) {
    for (const tool of tools.filter((t) => t.status === "live" || t.status === "collecting")) {
      expect(text).toContain(`https://everloot.app${toolHref(tool)})`);
    }
    for (const needle of ["https://everloot.app/changes)", "https://everloot.app/changes/feed.xml", "https://everloot.app/docs)", "https://everloot.app/api/corpus/public", "https://everloot.app/mcp/public", "https://everloot.app/wow-forever", "https://everloot.app/map)", "https://everloot.app/addon)"]) {
      expect(text).toContain(needle);
    }
    expect(text).toContain("Data limitations");
    expect(text).toContain("Not affiliated with or endorsed by Blizzard Entertainment");
  }
});

test("the map line says nothing about game art, which the map shows when its pictures are set", async () => {
  for (const text of [llmsTxt(), await llmsFullTxt()]) expect(text).not.toMatch(/no game art/i);
});

test("a coming-soon tool is not advertised as a tool", () => {
  for (const tool of tools.filter((t) => t.status === "coming-soon")) expect(llmsTxt()).not.toContain(`https://everloot.app${toolHref(tool)})`);
});

test("the full file carries the launch quote with its source and the licences", async () => {
  const full = await llmsFullTxt([]);
  expect(full).toContain("launches globally on November 4, 2026");
  expect(full).toContain("news.blizzard.com");
  expect(full).toContain("No WoW: Forever build is recorded yet.");
  expect(full).toContain("Blizzard's, not under Everloot's licence");
});

test("the routes answer as plain text", async () => {
  for (const handler of [llms, llmsFull]) {
    const res = await handler();
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect((await res.text()).startsWith("# Everloot")).toBe(true);
  }
});

test("AI assistants are pointed at the MCP server for questions, and the raw corpus is described as bulk data", () => {
  const text = llmsTxt();
  const section = text.slice(text.indexOf("## For AI assistants and developers"));
  expect(section.indexOf("/mcp/public")).toBeLessThan(section.indexOf("/api/corpus/public"));
  expect(section).toContain("the way for an AI assistant to answer a question");
  expect(section).toContain("to answer a question, use the MCP server");
});

test("llms.txt and llms-full.txt carry the licence and credit headers", async () => {
  for (const res of [llms(), await llmsFull()]) {
    expect(res.headers.get("x-everloot-licence")).toBe("CC BY-SA 4.0");
    expect(res.headers.get("x-everloot-credit")).toBe("Data from Everloot (https://everloot.app), CC BY-SA 4.0.");
  }
});

test("llms-full.txt is a superset of llms.txt: every line of the short file is in the full one, but the pointer to itself", async () => {
  const full = new Set((await llmsFullTxt()).split("\n"));
  const missing = llmsTxt().split("\n").filter((line) => line.trim() && !FULL_VERSION.includes(line) && !full.has(line));
  expect(missing).toEqual([]);
  expect(await llmsFullTxt()).not.toContain("## Full version");
});

test("both files give the page addresses to cite, the credit line and the operator in /about's words", async () => {
  for (const text of [llmsTxt(), await llmsFullTxt()]) {
    const section = text.slice(text.indexOf("## Linking to Everloot"));
    for (const pattern of ["/database/items/{itemId}", "/database/npcs/{npcId}", "/database/quests/{questId}", "/database/zones/{mapId}-{zone-name}", "/tools/talents/{class}", "/.well-known/mcp/server-card.json"]) {
      expect(section).toContain(`https://everloot.app${pattern}`);
    }
    expect(section).toContain("Credit line for Everloot's own data: Data from Everloot (https://everloot.app), CC BY-SA 4.0.");
    expect(text).toContain("Everloot is run by R21 Media Group, LLC.");
    expect(text).not.toContain("run by its maintainer");
  }
});