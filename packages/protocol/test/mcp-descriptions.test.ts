import { expect, test } from "vitest";
import { MCP_TOOLS } from "../src/index.js";

test("tool descriptions fit the listings' 2,000-character description budget", () => {
  expect(Object.keys(MCP_TOOLS)).toHaveLength(32);
  for (const [name, tool] of Object.entries(MCP_TOOLS)) expect(tool.description.length, name).toBeLessThanOrEqual(2000);
});

test("the generic decision tree names its next tools", () => {
  const next = {
    answer_sources: ["search_knowledge", "item_page", "npc_page", "quest_page"],
    search_knowledge: ["get_by_name", "get_entity", "fetch", "item_page", "npc_page", "quest_page", "world_map_near"],
    get_by_name: ["search_knowledge", "get_entity", "item_page"],
    get_entity: ["fetch", "item_page"], fetch: ["get_entity"],
    item_page: ["search_knowledge", "entity_relations", "market_value"],
    npc_page: ["search_knowledge", "vendor_page", "world_map_near"],
    quest_page: ["search_knowledge", "get_entity", "entity_relations"],
    market_value: ["auction_history", "vendor_page"], auction_history: ["market_value"],
    profession_path: ["recipe_thresholds", "market_value"], population: ["class_races"],
  } as const;
  for (const [name, tools] of Object.entries(next)) {
    for (const tool of tools) expect(MCP_TOOLS[name as keyof typeof MCP_TOOLS].description, name).toContain(tool);
  }
});

test("descriptions distinguish identities, evidence and price methods", () => {
  for (const name of ["search_knowledge", "get_by_name", "get_entity"] as const) {
    expect(MCP_TOOLS[name].description).toContain("recordId");
    expect(MCP_TOOLS[name].description).toContain("gameId");
  }
  expect(MCP_TOOLS.answer_sources.description).toContain("requested fact");
  expect(MCP_TOOLS.profession_path.description).toMatch(/median.*unscoped/);
  for (const name of ["market_value", "auction_history"] as const) {
    expect(MCP_TOOLS[name].description).toContain("two words");
    expect(MCP_TOOLS[name].description).toContain("candidates");
    expect(MCP_TOOLS[name].description).toContain("house");
    expect(MCP_TOOLS[name].description).toContain("most units listed");
    expect(MCP_TOOLS[name].description).toContain("Alliance, Horde, Neutral");
  }
  expect(MCP_TOOLS.population.description).toContain("own installs");
});

test("every input field of every tool is described", () => {
  for (const [name, tool] of Object.entries(MCP_TOOLS)) {
    for (const [field, schema] of Object.entries(tool.inputSchema)) expect(schema.description, `${name}.${field}`).toMatch(/\S/);
  }
});

test("every description opens with one of the approved verbs", () => {
  const VERBS = /^(Returns|Searches|Finds|Lists|Reads|Decodes|Compares|Fetches|Looks up|Gives|Shows|Ranks|Counts|Answers)\b/;
  for (const [name, tool] of Object.entries(MCP_TOOLS)) expect(tool.description, name).toMatch(VERBS);
});

test("the ChatGPT contract words stay", () => {
  expect(MCP_TOOLS.search.description).toMatch(/ChatGPT/);
  expect(MCP_TOOLS.fetch.inputSchema.id.description).toBe("An id from a search result.");
});

test("the kind parameters name the catalog kinds and say they come from the game files", () => {
  for (const kind of [MCP_TOOLS.search_knowledge.inputSchema.kind, MCP_TOOLS.get_by_name.inputSchema.kind]) {
    for (const name of ["achievement", "faction", "title", "quest_chain", "mount", "legacy_perk", "race", "instance"]) expect(kind.description).toContain(name);
    expect(kind.description).toMatch(/game files/);
  }
});
