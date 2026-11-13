import { createHash } from "node:crypto";
import { DEFAULT_NEGOTIATED_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import type { EdgeCacheStore } from "./cf-edge-cache";

interface Version { release: string; dataAsOf: string }
// No named-player, opt-in progress, market or guild answers: their current authority must be read live.
const PUBLIC_TOOLS = new Set(["answer_sources", "class_races", "talent_tree", "talent_plan", "item_categories"]);
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
function canonical(value: unknown, normalize: boolean): unknown {
  if (typeof value === "string") return normalize ? value.trim().toLowerCase().replace(/\s+/g, " ") : value;
  if (Array.isArray(value)) return value.map((x) => canonical(x, normalize));
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key], normalize)]));
  return value;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Cache tool results only; the transport still admits each call and returns the caller's own RPC id. */
export function publicMcpCache(version: () => Promise<Version | null>, suppliedStore?: EdgeCacheStore) {
  return async (req: Request, body: string, respond: () => Promise<Response>): Promise<Response> => {
    if (req.method !== "POST" || new URL(req.url).pathname !== "/mcp/public" ||
      ["authorization", "cookie", "mcp-session-id"].some((h) => req.headers.has(h)) ||
      req.headers.get("content-type")?.split(";")[0].trim() !== "application/json" ||
      !req.headers.get("accept")?.split(",").map((v) => v.trim()).includes("application/json") || !req.headers.get("accept")?.split(",").map((v) => v.trim()).includes("text/event-stream")) return respond();
    const protocol = req.headers.get("mcp-protocol-version") ?? DEFAULT_NEGOTIATED_PROTOCOL_VERSION;
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(protocol)) return respond();
    let rpc: Record<string, unknown>;
    try { const parsed: unknown = JSON.parse(body); if (!object(parsed)) return respond(); rpc = parsed; } catch { return respond(); }
    if (rpc.jsonrpc !== "2.0" || rpc.method !== "tools/call" || !["string", "number"].includes(typeof rpc.id) ||
      !object(rpc.params) || typeof rpc.params.name !== "string" || !PUBLIC_TOOLS.has(rpc.params.name) ||
      !object(rpc.params.arguments)) return respond();
    const store = suppliedStore ?? (globalThis as unknown as { caches?: { default?: EdgeCacheStore } }).caches?.default;
    if (!store) return respond();
    let key: Request; let before: Version | null;
    try {
      before = await version();
      if (!before?.release || !before.dataAsOf) return respond();
      // Keep the exact text too: capitalization affects entity extraction and text echoed in the answer.
      const hash = digest([protocol, rpc.params.name, canonical(rpc.params.arguments, true), canonical(rpc.params.arguments, false), before]);
      key = new Request(`${new URL(req.url).origin}/__mcp-result/${hash}`);
      const hit = await store.match(key);
      if (hit) {
        const saved: unknown = await hit.json();
        if (object(saved) && object(saved.result) && object(saved.headers)) {
          return Response.json({ jsonrpc: "2.0", id: rpc.id, result: saved.result }, { headers: saved.headers as Record<string, string> });
        }
      }
    } catch { return respond(); }
    const response = await respond();
    if (response.status !== 200 || response.headers.has("set-cookie") || !response.headers.get("content-type")?.includes("application/json")) return response;
    try {
      const envelope: unknown = await response.clone().json();
      if (!object(envelope) || envelope.error || !object(envelope.result) || envelope.result.isError ||
        (object(envelope.result.structuredContent) && envelope.result.structuredContent.error)) return response;
      if (rpc.params && object(rpc.params) && rpc.params.name === "answer_sources" &&
        (!object(envelope.result.structuredContent) || envelope.result.structuredContent.dataAsOf !== before?.dataAsOf)) return response;
      if (JSON.stringify(before) !== JSON.stringify(await version())) return response;
      // CORS belongs to the live caller, not to the cached caller's Origin.
      const headers = Object.fromEntries([...response.headers].filter(([name]) => !name.startsWith("access-control-") && !["content-length", "content-encoding"].includes(name)));
      await store.put(key, Response.json({ result: envelope.result, headers }, { headers: { "cache-control": "public, max-age=600" } }));
    } catch { /* A cache outage never changes the live answer. */ }
    return response;
  };
}
