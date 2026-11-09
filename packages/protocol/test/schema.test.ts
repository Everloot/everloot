import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { emit } from "../scripts/emit-schema.js";
import { ALL_RECORD_KINDS, MCP_PROMPT_NAMES, MCP_RESOURCE_TEMPLATE_URIS, MCP_RESOURCE_URIS, MCP_TOOL_NAMES, PUBLIC_RECORD_KINDS, recordSchemas, RULES, STRUCTURED_TOOLS, UPLOAD_LIMITS, PROTOCOL_VERSION } from "../src/index.js";

const COMMITTED = join(import.meta.dirname, "..", "schema");

/** The property names and required list of a kind's zod shape, through its refinements. */
function zodShape(kind: keyof typeof recordSchemas): { properties: string[]; required: string[] } {
  const json = z.toJSONSchema(recordSchemas[kind], { io: "input" }) as { properties: Record<string, unknown>; required?: string[] };
  return { properties: Object.keys(json.properties).sort(), required: [...(json.required ?? [])].sort() };
}

describe("schema files", () => {
  const out = mkdtempSync(join(tmpdir(), "everloot-protocol-"));
  emit(out);

  test("every kind has a file whose properties and required list match its zod shape", () => {
    const files = readdirSync(join(out, "records")).map((f) => f.replace(/\.json$/, "")).sort();
    expect(files).toEqual([...ALL_RECORD_KINDS].sort());
    for (const kind of ALL_RECORD_KINDS) {
      const file = JSON.parse(readFileSync(join(out, "records", `${kind}.json`), "utf8")) as { $schema: string; properties: Record<string, unknown>; required?: string[]; description: string };
      expect(file.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(Object.keys(file.properties).sort()).toEqual(zodShape(kind).properties);
      expect([...(file.required ?? [])].sort()).toEqual(zodShape(kind).required);
      expect(file.description).toContain(kind);
    }
  });

  test("the server's cross-field rules are written into the descriptions", () => {
    for (const [kind, rules] of Object.entries(RULES)) {
      const file = JSON.parse(readFileSync(join(out, "records", `${kind}.json`), "utf8")) as { description: string };
      for (const rule of rules) expect(file.description).toContain(rule);
    }
  });

  test("the envelope, limits and index are written", () => {
    const upload = JSON.parse(readFileSync(join(out, "upload.json"), "utf8")) as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(upload.properties).sort()).toEqual(["addonVersion", "clientBuild", "protocol", "records", "source"]);
    expect(upload.required.sort()).toEqual(["addonVersion", "records"]);
    expect(JSON.parse(readFileSync(join(out, "limits.json"), "utf8"))).toEqual(UPLOAD_LIMITS);
    const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8")) as { protocol: string; kinds: string[]; publicKinds: string[] };
    expect(index.protocol).toBe(PROTOCOL_VERSION);
    expect(index.kinds).toEqual([...ALL_RECORD_KINDS].sort());
    expect(index.publicKinds).toEqual([...PUBLIC_RECORD_KINDS].sort());
  });

  test("the items response file types each item, so a generated client gets fields, not any", () => {
    const file = JSON.parse(readFileSync(join(out, "api", "itemsResponse.json"), "utf8")) as { properties: { items: { items: { properties: Record<string, unknown>; required: string[]; additionalProperties: unknown } } } };
    const item = file.properties.items.items;
    expect(Object.keys(item.properties)).toEqual(["itemId", "class", "subclass", "slot", "quality"]);
    expect(item.required).toEqual(["itemId", "class", "subclass", "slot", "quality"]);
    expect(item.additionalProperties).toBe(false);
  });

  test("every MCP tool file has its input schema, and an output schema exactly where the tool declares one", () => {
    for (const name of MCP_TOOL_NAMES) {
      const file = JSON.parse(readFileSync(join(out, "mcp", `${name}.json`), "utf8")) as { inputSchema: { type: string }; outputSchema?: { properties: Record<string, unknown> } };
      expect(file.inputSchema.type).toBe("object");
      expect(file.outputSchema !== undefined).toBe(STRUCTURED_TOOLS.includes(name));
    }
    const search = JSON.parse(readFileSync(join(out, "mcp", "search_knowledge.json"), "utf8")) as { outputSchema: { properties: { hits: { items: { required: string[] } } } } };
    expect(search.outputSchema.properties.hits.items.required).toContain("sourceUrl");
  });

  test("the resources file lists every resource, and the JSON one carries the schema of its contents", () => {
    const file = JSON.parse(readFileSync(join(out, "mcp", "resources.json"), "utf8")) as { resources: { uri: string; mimeType: string; contents?: { required: string[] } }[] };
    expect(file.resources.map((r) => r.uri)).toEqual(MCP_RESOURCE_URIS);
    for (const resource of file.resources) expect(resource.contents !== undefined).toBe(resource.mimeType === "application/json");
    expect(file.resources[0].contents?.required).toEqual(["gameFiles", "registry", "credit"]);
    const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8")) as { mcpResources: string[]; mcpPrompts: string[] };
    expect(index.mcpResources).toEqual(MCP_RESOURCE_URIS);
    expect(index.mcpPrompts).toEqual(MCP_PROMPT_NAMES);
    const withTemplates = JSON.parse(readFileSync(join(out, "mcp", "resources.json"), "utf8")) as { templates: { uriTemplate: string; tool: string; contents: string }[] };
    expect(withTemplates.templates.map((t) => t.uriTemplate)).toEqual(MCP_RESOURCE_TEMPLATE_URIS);
    expect(withTemplates.templates[0]).toMatchObject({ tool: "item_page", contents: "https://everloot.app/schema/mcp/item_page.json#/outputSchema" });
    const prompts = JSON.parse(readFileSync(join(out, "mcp", "prompts.json"), "utf8")) as { prompts: { name: string; arguments: { name: string; required: boolean }[] }[] };
    expect(prompts.prompts.map((p) => p.name)).toEqual(MCP_PROMPT_NAMES);
    expect(prompts.prompts[0].arguments).toEqual([{ name: "question", description: "The question, in the player's words.", required: true }]);
  });

  test("the committed schema/ folder is what the emitter writes today", () => {
    // `npm run build` regenerates it; CI fails on a difference. Skipped on a checkout that never built.
    if (!existsSync(COMMITTED)) return;
    const walk = (dir: string, prefix = ""): Record<string, string> => Object.fromEntries(
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
        ? Object.entries(walk(join(dir, entry.name), `${prefix}${entry.name}/`))
        : [[`${prefix}${entry.name}`, readFileSync(join(dir, entry.name), "utf8")]]),
    );
    expect(walk(COMMITTED)).toEqual(walk(out));
  });
});
