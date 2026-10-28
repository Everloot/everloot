import { API_SCHEMAS, SITE, type ApiQueryParam, type ApiRoute, type ApiSchemaName, type McpToolName } from "@everloot/protocol";
import { z } from "zod";
import type { CodeTab } from "@/components/docs/DocsClient";
import { typeLabel } from "@/lib/protocol-docs";

/**
 * Code samples and example answers for the generated reference pages, built from the protocol: the
 * request from a route's parameters, the answer from its response schema. Values are the schema's own
 * examples where it gives them, otherwise placeholders of the right type, so an example is a shape,
 * not a fact.
 */

type Node = {
  type?: string | string[]; enum?: unknown[]; const?: unknown; examples?: unknown[]; default?: unknown; minimum?: number;
  properties?: Record<string, Node>; items?: Node; anyOf?: Node[]; oneOf?: Node[]; additionalProperties?: Node | boolean;
  format?: string; $ref?: string; $defs?: Record<string, Node>; definitions?: Record<string, Node>;
};

/** One example value for a JSON Schema node. Arrays get one item; open maps get one key. */
export function sample(node: Node | undefined, defs: Record<string, Node> = {}, depth = 0): unknown {
  if (!node || depth > 8) return null;
  if (node.$ref) return sample(defs[node.$ref.split("/").pop()!], defs, depth + 1);
  if (node.examples?.length) return node.examples[0];
  if (node.const !== undefined) return node.const;
  if (node.enum?.length) return node.enum[0];
  if (node.default !== undefined) return node.default;
  const options = node.anyOf ?? node.oneOf;
  if (options) return sample(options.find((o) => o.type !== "null") ?? options[0], defs, depth + 1);
  const type = Array.isArray(node.type) ? node.type.find((t) => t !== "null") : node.type;
  switch (type) {
    case "object": {
      if (node.properties) return Object.fromEntries(Object.entries(node.properties).map(([k, v]) => [k, sample(v, defs, depth + 1)]));
      if (node.additionalProperties && typeof node.additionalProperties === "object") return { key: sample(node.additionalProperties, defs, depth + 1) };
      return {};
    }
    case "array": return node.items ? [sample(node.items, defs, depth + 1)] : [];
    case "integer": return node.minimum !== undefined && node.minimum > 0 ? node.minimum : 0;
    case "number": return 0;
    case "boolean": return true;
    case "string": return node.format === "date-time" ? "2026-11-04T12:00:00.000Z" : node.format === "uri" ? SITE : "string";
    default: return null;
  }
}

export function schemaSample(name: ApiSchemaName): unknown {
  const json = z.toJSONSchema(API_SCHEMAS[name] as z.ZodType, { io: "output", unrepresentable: "any" }) as Node;
  return sample(json, json.$defs ?? json.definitions ?? {});
}

/** The top-level fields of a response schema, as parameter rows. */
export function schemaFields(name: ApiSchemaName): { name: string; type: string; required: boolean; description: string }[] {
  const json = z.toJSONSchema(API_SCHEMAS[name] as z.ZodType, { io: "output", unrepresentable: "any" }) as Node & { required?: string[] };
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([field, node]) => ({
    name: field,
    type: fieldType(node),
    required: required.has(field),
    description: (node as { description?: string }).description ?? "",
  }));
}

function fieldType(node: Node): string {
  const options = node.anyOf ?? [];
  const nullable = options.some((o) => o.type === "null") || (Array.isArray(node.type) && node.type.includes("null"));
  const found = options.find((o) => o.type !== "null") ?? node;
  // "or null" is said once, at the end, so the type itself is read without its null.
  const base = Array.isArray(found.type) ? { ...found, type: found.type.filter((t) => t !== "null") } : found;
  const type = Array.isArray(base.type) ? base.type.join(" or ") : base.type;
  const label = type === "array" ? (base.items?.type === "object" ? "array of objects" : `array of ${base.items?.type ?? "values"}`) : type === "object" ? "object" : typeLabel({ ...base, type } as Parameters<typeof typeLabel>[0]);
  return nullable ? `${label}, or null` : label;
}

function paramValue(param: ApiQueryParam): string {
  const schema = param.schema as Node;
  const value = sample(schema);
  return String(value === null || value === "string" ? param.name : value);
}

/** The example request URL: path parameters filled in, required query parameters and a small page. */
export function exampleUrl(route: ApiRoute): string {
  let path = route.path;
  for (const param of route.pathParams ?? []) {
    const value = route.path === "/api/tooltip/{type}/{id}" && param.name === "id" ? "19019" : route.path === "/api/tools/{tool}" && param.name === "tool" ? "get_by_name" : paramValue(param);
    path = path.replace(`{${param.name}}`, encodeURIComponent(value));
  }
  const query = new URLSearchParams();
  for (const param of route.query ?? []) if (param.required) query.set(param.name, paramValue(param));
  if (route.path === "/api/tools/{tool}") query.set("name", "Hogger");
  if (route.paged) query.set("limit", "10");
  const qs = query.toString();
  return `${SITE}${path}${qs ? `?${qs}` : ""}`;
}

/** curl, JavaScript and Python for one endpoint. */
export function requestSamples(route: ApiRoute): CodeTab[] {
  const url = exampleUrl(route);
  if (route.method === "POST") {
    return [
      { label: "cURL", lang: "bash", code: `curl --request POST "${url}" \\\n  --header "content-type: application/json" \\\n  --data @upload.json` },
      { label: "JavaScript", lang: "js", code: `const body = await readFile("upload.json", "utf8");\nconst res = await fetch("${url}", {\n  method: "POST",\n  headers: { "content-type": "application/json" },\n  body,\n});\nconsole.log(await res.json());` },
      { label: "Python", lang: "python", code: `import requests\n\nwith open("upload.json", "rb") as f:\n    res = requests.post("${url}", data=f, headers={"content-type": "application/json"})\nprint(res.json())` },
    ];
  }
  return [
    { label: "cURL", lang: "bash", code: `curl "${url}"` },
    { label: "JavaScript", lang: "js", code: `const res = await fetch("${url}");\nconst data = await res.json();\nconsole.log(data);` },
    { label: "Python", lang: "python", code: `import requests\n\nres = requests.get("${url}")\nprint(res.json())` },
  ];
}

/** The answer a status really gives where the schema alone would show a healthy one. */
function sampleFor(route: ApiRoute, status: string, schema: ApiSchemaName): unknown {
  const value = schemaSample(schema);
  if (route.path === "/api/health" && status === "503") {
    return { ...(value as object), ok: false, snapshot: { status: "stale", updatedAt: "2026-11-04T10:30:00.000Z", ageSeconds: 5400 } };
  }
  return value;
}

/** An example answer per documented status code that has a schema, and both answers of the market prices. */
export function responseSamples(route: ApiRoute): CodeTab[] {
  const tabs = Object.entries(route.responses).flatMap(([status, response]) =>
    response.schema ? [{ label: status, lang: "json", code: JSON.stringify(sampleFor(route, status, response.schema), null, 2) }] : []);
  if (route.path === "/api/market/prices") {
    tabs.splice(1, 0, { label: "200, no realm", lang: "json", code: JSON.stringify(schemaSample("marketRealmsResponse"), null, 2) });
    tabs[0] = { ...tabs[0]!, label: "200, with realm" };
  }
  return tabs;
}

/**
 * A believable call for each tool: well-known ids from the original game (Linen Cloth, Hogger, Wanted: Hogger)
 * and plain stand-ins (`YourRealm`) where the value is the reader's own.
 */
export const TOOL_ARGS: Record<McpToolName, Record<string, string | number>> = {
  coverage: { zone: 1429, type: "quests" },
  search_knowledge: { query: "Thunderfury" },
  get_entity: { id: 146235 },
  get_by_name: { name: "Hogger" },
  search: { query: "Hogger" },
  fetch: { id: "146235" },
  answer_sources: { question: "Where does Hogger spawn?" },
  profession_path: { profession: "Alchemy", toSkill: 150 },
  recipe_thresholds: { profession: "Alchemy" },
  item_page: { itemId: 2589 },
  npc_page: { npcId: 448 },
  object_page: { objectId: 1618 },
  quest_page: { questId: 176 },
  vendor_page: { vendorNpcId: 295 },
  world_map_near: { zone: "Elwynn Forest", x: 42, y: 65 },
  entity_relations: { kind: "item", id: 2589 },
  item_categories: { quality: "epic" },
  talent_tree: { class: "mage" },
  talent_plan: { code: "YOUR-SHARE-CODE" },
  class_races: { class: "warlock", faction: "horde" },
  collection_gap: { collection: "mounts", ownerInstallId: "your-install-id" },
  completion_progress: { ownerInstallId: "your-install-id" },
  guild_board: { guildName: "Your Guild", realm: "YourRealm" },
  guild_search: { query: "Your" },
  guild_rankings: {},
  auction_history: { realm: "YourRealm", itemId: 2589 },
  market_value: { realm: "YourRealm", itemId: 2589 },
  gold_ledger: { character: "YourCharacter", realm: "YourRealm" },
  population: {},
  recent_changes: { game: "forever" },
  ecosystem_projects: { board: "rising" },
  everloot_plan: {},
};

/** The JSON-RPC call and the plain HTTP GET for one MCP tool. */
export function toolSamples(name: McpToolName): CodeTab[] {
  const args = TOOL_ARGS[name];
  const rpc = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const qs = new URLSearchParams(Object.entries(args).map(([k, v]) => [k, String(v)])).toString();
  return [
    { label: "cURL (MCP)", lang: "bash", code: `curl ${SITE}/mcp/public \\\n  --header "content-type: application/json" \\\n  --header "accept: application/json, text/event-stream" \\\n  --data '${rpc.replaceAll("'", "'\\''")}'` },
    { label: "HTTP GET", lang: "bash", code: `curl "${SITE}/api/tools/${name}${qs ? `?${qs}` : ""}"` },
  ];
}
