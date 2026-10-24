import { API_ROUTES } from "@everloot/protocol";
import { liveToolNames } from "@/lib/guild-switch";
import { expect, test } from "vitest";
import { routeDocs, toolDocs, toolOutput, toolParams, typeLabel } from "./protocol-docs";

test("every tool gets a parameter table in declaration order, with required flags and descriptions", () => {
  const docs = toolDocs();
  expect(docs.map((d) => d.name)).toEqual(liveToolNames());
  const search = docs.find((d) => d.name === "search_knowledge")!;
  expect(search.params.map((p) => p.name)).toEqual(["query", "kind", "version", "limit"]);
  expect(search.params[0]).toMatchObject({ required: true, type: "string, up to 1000 characters" });
  expect(search.params[3]).toMatchObject({ required: false, type: "integer, 1 to 25, default 8" });
  expect(search.playerData).toBe(false);
  expect(docs.find((d) => d.name === "item_page")!.playerData).toBe(true);
  expect(search.structured).toBe(true);
  expect(docs.find((d) => d.name === "item_page")!.structured).toBe(true);
  expect(docs.filter((d) => !d.structured).map((d) => d.name)).toEqual(["coverage"]);
  // The answer table: structured tools have fields; coverage returns text only.
  for (const d of docs.filter((d) => d.structured)) expect(d.output.length, d.name).toBeGreaterThan(0);
  expect(toolOutput("coverage")).toEqual([]);
  expect(toolParams("coverage").map((p) => [p.name, p.required])).toEqual([["zone", false], ["type", false]]);
  const item = toolOutput("item_page");
  expect(item.map((f) => f.name)).toEqual(["connected", "dataAsOf", "reason", "url", "page"]);
  expect(item[0]).toMatchObject({ type: "boolean", required: true });
  expect(item[1]).toMatchObject({ type: "string, or null", required: true });
  expect(item[3]).toMatchObject({ type: "string", required: false });
  expect(item[4]).toMatchObject({ type: "object", required: false });
  expect(toolOutput("search_knowledge")[0]).toMatchObject({ name: "hits", type: "array of objects", required: true });
  expect(toolOutput("everloot_plan").map((f) => f.name)).toEqual(["rows", "counts"]);
  expect(toolParams("everloot_plan")).toEqual([]);
});

test("type labels read as plain words", () => {
  expect(typeLabel({ type: "integer", exclusiveMinimum: 0 })).toBe("integer, 1 or more");
  expect(typeLabel({ type: "number", minimum: 0, maximum: 100 })).toBe("number, 0 to 100");
  expect(typeLabel({ enum: ["a", "b"] })).toBe("one of: a, b");
  expect(typeLabel({ type: "boolean" })).toBe("boolean");
  const near = toolParams("world_map_near");
  expect(near.find((p) => p.name === "radius")!.type).toBe("number, above 0, up to 5000, default 500");
  expect(near.find((p) => p.name === "zone")!.type).toBe("string, up to 80 characters");
});

test("the route docs are the protocol's catalogue", () => {
  expect(routeDocs()).toEqual([...API_ROUTES]);
});
