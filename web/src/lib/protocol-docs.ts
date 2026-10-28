import { API_ROUTES, MCP_TOOLS, PLAYER_DATA_TOOLS, STRUCTURED_TOOLS, type ApiRoute, type McpToolName } from "@everloot/protocol";
import { liveToolNames } from "@/lib/guild-switch";
import { z } from "zod";

/**
 * The protocol as rows for the connect page: one parameter table per MCP tool and one row per API
 * endpoint, read from the same definitions the server registers and the OpenAPI document is built from.
 */

export interface ParamRow {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

type JsonSchemaNode = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  maxLength?: number;
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
};

/** A short, human type for one parameter: `integer 1 to 100`, `one of: a, b`, `string, up to 80 characters`. */
export function typeLabel(node: JsonSchemaNode): string {
  if (node.enum) return `one of: ${node.enum.map(String).join(", ")}`;
  if (node.const !== undefined) return `exactly ${String(node.const)}`;
  if (node.anyOf) return node.anyOf.map(typeLabel).join(" or ");
  const type = Array.isArray(node.type) ? node.type.join(" or ") : (node.type ?? "value");
  const parts = [type];
  const integer = type === "integer";
  // zod writes .int() as the safe-integer range; those bounds say nothing a reader needs.
  const bound = (n: number | undefined) => (n === undefined || Math.abs(n) >= Number.MAX_SAFE_INTEGER ? undefined : n);
  const min = node.exclusiveMinimum !== undefined ? (integer ? node.exclusiveMinimum + 1 : undefined) : bound(node.minimum);
  const max = bound(node.maximum);
  if (!integer && node.exclusiveMinimum !== undefined) parts.push(`above ${node.exclusiveMinimum}`);
  if (min !== undefined && max !== undefined) parts.push(`${min} to ${max}`);
  else if (min !== undefined) parts.push(`${min} or more`);
  else if (max !== undefined) parts.push(`up to ${max}`);
  if (node.maxLength !== undefined) parts.push(`up to ${node.maxLength} characters`);
  if (node.default !== undefined) parts.push(`default ${String(node.default)}`);
  return parts.join(", ");
}

/** The parameters of one MCP tool, in declaration order. */
export function toolParams(name: McpToolName): ParamRow[] {
  const json = z.toJSONSchema(z.object(MCP_TOOLS[name].inputSchema), { io: "input" }) as { properties?: Record<string, JsonSchemaNode>; required?: string[] };
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([param, node]) => ({
    name: param,
    type: typeLabel(node),
    required: required.has(param),
    description: node.description ?? "",
  }));
}

/** A short type for one answer field: scalars as for parameters, `object`, `array of objects`, `... or null`. */
function outputTypeLabel(node: JsonSchemaNode & { properties?: unknown }): string {
  // zod writes a nullable scalar as type ["string", "null"] and a nullable object as anyOf [..., { type: "null" }].
  if (Array.isArray(node.type) && node.type.includes("null")) {
    const rest = node.type.filter((t) => t !== "null");
    return `${outputTypeLabel({ ...node, type: rest.length === 1 ? rest[0] : rest })}, or null`;
  }
  const options = node.anyOf ?? [];
  const nullable = options.some((o) => o.type === "null");
  const inner = nullable ? options.filter((o) => o.type !== "null") : [];
  const base = nullable && inner.length === 1 ? inner[0] : node;
  let label: string;
  if (base.type === "array") label = base.items?.type === "object" ? "array of objects" : `array of ${base.items ? outputTypeLabel(base.items) : "values"}`;
  else if (base.type === "object") label = "object";
  else label = typeLabel(base);
  return nullable ? `${label}, or null` : label;
}

/** The top-level fields of one tool's structuredContent, in declaration order. */
export function toolOutput(name: McpToolName): ParamRow[] {
  const def = MCP_TOOLS[name];
  if (!("outputSchema" in def)) return [];
  const json = z.toJSONSchema(z.object(def.outputSchema), { io: "output" }) as { properties?: Record<string, JsonSchemaNode>; required?: string[] };
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([field, node]) => ({
    name: field,
    type: outputTypeLabel(node),
    required: required.has(field),
    description: node.description ?? "",
  }));
}

export interface ToolDoc {
  name: McpToolName;
  title: string;
  description: string;
  params: ParamRow[];
  /** The top-level fields of the structured answer. */
  output: ParamRow[];
  /** Whether the answer is built on player uploads and ends with the data age and the credit line. */
  playerData: boolean;
  /** Whether the tool also returns structuredContent of a declared shape, beside the text. */
  structured: boolean;
}

export function toolDocs(): ToolDoc[] {
  return liveToolNames().map((name) => ({
    name,
    title: MCP_TOOLS[name].title,
    description: MCP_TOOLS[name].description,
    params: toolParams(name),
    output: toolOutput(name),
    playerData: PLAYER_DATA_TOOLS.includes(name),
    structured: STRUCTURED_TOOLS.includes(name),
  }));
}

export const ACCESS_LABEL: Record<ApiRoute["access"], string> = {
  open: "open",
  "rate-limited": "per-IP limit",
  "key-or-rate-limited": "per-IP limit, or a free key",
  cron: "internal",
};

export const DATA_LABEL: Record<ApiRoute["data"], string> = {
  observed: "observed in play",
  "game-files": "in game files, unconfirmed",
  mixed: "both, labelled per row",
  none: "no data",
};

export function routeDocs(): ApiRoute[] {
  return [...API_ROUTES];
}
