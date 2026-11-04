import { expect, test } from "vitest";
import { MCP_TOOLS } from "../src/index.js";

test("every input field of every tool is described", () => {
  for (const [name, tool] of Object.entries(MCP_TOOLS)) {
    for (const [field, schema] of Object.entries(tool.inputSchema)) expect(schema.description, `${name}.${field}`).toMatch(/\S/);
  }
});

test("every description opens with a verb in the third person", () => {
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
