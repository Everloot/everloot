import { expect, test } from "vitest";
import { KNOWLEDGE_KINDS } from "../src/index.js";

test("KNOWLEDGE_KINDS carries the catalog kinds after the original nine, then build", () => {
  expect(KNOWLEDGE_KINDS.slice(9)).toEqual(["achievement", "faction", "title", "quest_chain", "mount", "legacy_perk", "race", "instance", "build"]);
});

test("answer_sources allows an unavailable predicate without fabricating evidence", async () => {
  const { MCP_TOOLS } = await import("../src/mcp.js");
  const { z } = await import("zod");
  const schema = z.object(MCP_TOOLS.answer_sources.outputSchema);
  expect(schema.parse({ evidence: [], furtherReading: [], dataAsOf: null })).not.toHaveProperty("unavailable");
  expect(schema.parse({ evidence: [], furtherReading: [], dataAsOf: null, unavailable: { predicate: "price", message: "Use market_value" } }).evidence).toEqual([]);
});
