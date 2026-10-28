import { API_ROUTES, API_SCHEMAS, PROTOCOL_VERSION } from "@everloot/protocol";
import { liveToolNames } from "@/lib/guild-switch";
import { expect, test } from "vitest";
import { GET } from "@/app/api/openapi.json/route";
import { openApiDocument } from "./openapi";

type Op = { operationId: string; summary: string; tags: string[]; parameters?: { name: string; in: string }[]; responses: Record<string, { content?: { "application/json": { schema: { $ref: string } } } }>; requestBody?: { content: { "application/json": { schema: { $ref: string } } } } };
const doc = openApiDocument() as { openapi: string; info: { version: string }; paths: Record<string, Record<string, Op>>; components: { schemas: Record<string, unknown> }; "x-everloot": { mcp: { tools: string[] } } };

test("describes every route in the protocol's catalogue, and nothing else", () => {
  expect(doc.openapi).toBe("3.1.0");
  expect(doc.info.version).toBe(PROTOCOL_VERSION);
  const listed = Object.entries(doc.paths).flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`)).sort();
  expect(listed).toEqual(API_ROUTES.map((r) => `${r.method} ${r.path}`).sort());
});

test("every $ref points at a component schema, and every component is a protocol schema", () => {
  const refs = new Set<string>();
  for (const ops of Object.values(doc.paths)) {
    for (const op of Object.values(ops)) {
      for (const response of Object.values(op.responses)) {
        const ref = response.content?.["application/json"].schema.$ref;
        if (ref) refs.add(ref);
      }
      const body = op.requestBody?.content["application/json"].schema.$ref;
      if (body) refs.add(body);
    }
  }
  expect(refs.size).toBeGreaterThan(5);
  for (const ref of refs) {
    const name = ref.replace("#/components/schemas/", "");
    expect(doc.components.schemas).toHaveProperty(name);
  }
  expect(Object.keys(doc.components.schemas).sort()).toEqual(Object.keys(API_SCHEMAS).sort());
  for (const schema of Object.values(doc.components.schemas)) expect(schema).not.toHaveProperty("$schema");
});

test("query parameters, operation ids and tags are well formed", () => {
  const ids = new Set<string>();
  for (const ops of Object.values(doc.paths)) {
    for (const op of Object.values(ops)) {
      expect(op.operationId).toMatch(/^(get|post)[A-Z][A-Za-z]+$/);
      expect(ids.has(op.operationId)).toBe(false);
      ids.add(op.operationId);
      expect(op.summary.length).toBeGreaterThan(10);
      expect(op.tags).toHaveLength(1);
      for (const p of op.parameters ?? []) expect(["query", "path"]).toContain(p.in);
    }
  }
  const corpus = doc.paths["/api/corpus/public"].get;
  expect(corpus.parameters?.map((p) => p.name)).toEqual(["kinds", "offset", "limit"]);
  expect(doc["x-everloot"].mcp.tools).toEqual(liveToolNames());
  expect(doc["x-everloot"].mcp.tools).not.toContain("guild_search");
});

test("the route serves the document as cacheable JSON that round-trips", async () => {
  const response = await GET();
  expect(response.headers.get("cache-control")).toContain("public");
  const body = await response.json();
  expect(body.openapi).toBe("3.1.0");
  expect(JSON.parse(JSON.stringify(doc))).toEqual(body);
});
