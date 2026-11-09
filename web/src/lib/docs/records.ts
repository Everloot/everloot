import { ALL_RECORD_KINDS, PUBLIC_RECORD_KINDS, recordSchemas, RULES, type RecordKind } from "@everloot/protocol";
import { z } from "zod";
import { typeLabel } from "@/lib/protocol-docs";

/**
 * The record kinds as rows for the generated docs pages (/docs/api/records/<kind>), read from the same
 * zod schemas the server validates uploads with and `schema/records/<kind>.json` is written from, so the
 * page, the file and the check can never disagree.
 */

type Node = {
  type?: string | string[]; enum?: unknown[]; const?: unknown; description?: string; default?: unknown;
  minimum?: number; maximum?: number; exclusiveMinimum?: number; maxLength?: number; maxItems?: number;
  properties?: Record<string, Node>; required?: string[]; items?: Node; anyOf?: Node[];
  additionalProperties?: Node | boolean;
};

export interface RecordField {
  /** Dotted for a nested field, `items[].itemId` for one inside an array. */
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export const recordHref = (kind: RecordKind): string => `/docs/api/records/${kind}`;

/** The kind a docs address names, or undefined. */
export function recordFromSlug(slug: string): RecordKind | undefined {
  return ALL_RECORD_KINDS.find((kind) => kind === slug);
}

/** The JSON Schema of a kind, as the schema file holds it (before the $id and the rules are added). */
function recordJsonSchema(kind: RecordKind): Node {
  return z.toJSONSchema(recordSchemas[kind] as z.ZodType, { io: "input", unrepresentable: "any" }) as Node;
}

/** A nullable field is written `type: [.., "null"]` or `anyOf [.., { type: "null" }]`; this is the type without its null. */
function unwrap(node: Node): { node: Node; nullable: boolean } {
  if (Array.isArray(node.type) && node.type.includes("null")) {
    const rest = node.type.filter((t) => t !== "null");
    return { node: { ...node, type: rest.length === 1 ? rest[0] : rest }, nullable: true };
  }
  const options = node.anyOf ?? [];
  const inner = options.filter((o) => o.type !== "null");
  if (options.length > inner.length && inner.length === 1) return { node: { ...inner[0]!, description: node.description ?? inner[0]!.description }, nullable: true };
  return { node, nullable: false };
}

/** `integer, 1 or more`, `array of objects, up to 50`, `object`, `string, or null`. */
function fieldType(raw: Node): string {
  const { node, nullable } = unwrap(raw);
  let label: string;
  if (node.type === "array") {
    const item = node.items ? unwrap(node.items).node : undefined;
    label = item?.type === "object" ? "array of objects" : `array of ${item ? typeLabel(item) : "values"}`;
    if (node.maxItems !== undefined) label += `, up to ${node.maxItems}`;
  } else if (node.type === "object") {
    label = node.properties ? "object" : "object (any keys)";
  } else {
    label = typeLabel(node);
  }
  return nullable ? `${label}, or null` : label;
}

/** The fields of an object node, then the fields of each nested object and array item after their parent. */
function walk(node: Node, prefix: string, requiredAbove: boolean): RecordField[] {
  const required = new Set(node.required ?? []);
  return Object.entries(node.properties ?? {}).flatMap(([field, raw]) => {
    const name = `${prefix}${field}`;
    const isRequired = requiredAbove && required.has(field);
    const row: RecordField = { name, type: fieldType(raw), required: isRequired, description: raw.description ?? "" };
    const { node: inner } = unwrap(raw);
    if (inner.type === "object" && inner.properties) return [row, ...walk(inner, `${name}.`, isRequired)];
    const item = inner.type === "array" && inner.items ? unwrap(inner.items).node : undefined;
    if (item?.type === "object" && item.properties) return [row, ...walk(item, `${name}[].`, isRequired)];
    return [row];
  });
}

/**
 * Every field of a kind, in the schema's order, nested ones after their parent. A nested field is required
 * only when every object above it is, so a reader sees what an upload must carry, not what a part needs
 * once it is present.
 */
export function recordFields(kind: RecordKind): RecordField[] {
  return walk(recordJsonSchema(kind), "", true);
}

/** The sentences the server checks across fields, which the JSON Schema cannot express (RULES). */
export function recordRules(kind: RecordKind): readonly string[] {
  return (RULES as Record<string, readonly string[] | undefined>)[kind] ?? [];
}

export const isPublicKind = (kind: RecordKind): boolean => PUBLIC_RECORD_KINDS.includes(kind);

/** The schema's own description, when the record has one beyond the fields. */
export function recordDescription(kind: RecordKind): string | undefined {
  return recordJsonSchema(kind).description;
}
