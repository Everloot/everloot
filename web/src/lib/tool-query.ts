import { MCP_TOOLS, type McpToolName } from "@everloot/protocol";
import { z } from "zod";

/**
 * A query string as an MCP tool's arguments, for GET /api/tools/{tool}. A URL carries only text, so a
 * parameter the tool's input schema declares as a number or a boolean is read from its text; everything
 * else, and anything the schema does not name, stays a string for the schema to judge.
 */

type JsonType = { type?: string | string[]; enum?: unknown[] };

export function argumentsFromQuery(tool: McpToolName, params: URLSearchParams): Record<string, unknown> {
  const json = z.toJSONSchema(z.object(MCP_TOOLS[tool].inputSchema), { io: "input" }) as { properties?: Record<string, JsonType> };
  const args: Record<string, unknown> = {};
  for (const [name, raw] of params.entries()) {
    const node = json.properties?.[name];
    if (!node) { args[name] = raw; continue; }
    const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
    // A choice from a fixed list is matched without regard to case or surrounding spaces: a model that writes
    // "Classic" for the version means "classic", and the schema still refuses anything that is not on the list.
    const choice = node.enum?.find((v) => typeof v === "string" && v.toLowerCase() === raw.trim().toLowerCase());
    if (typeof choice === "string") args[name] = choice;
    else if ((types.includes("integer") || types.includes("number")) && raw.trim() !== "" && Number.isFinite(Number(raw))) args[name] = Number(raw);
    else if (types.includes("boolean") && (raw === "true" || raw === "false")) args[name] = raw === "true";
    else args[name] = raw;
  }
  return args;
}
