import { NextResponse } from "next/server";
import { MCP_TOOLS, SITE, type McpToolName } from "@everloot/protocol";
import { z } from "zod";
import { createToolHandlers, registeredToolNames, type ToolHandlers } from "../../../../../../kb/src/mcp-server";
import { admit, attributionHeaders } from "@/lib/data-guard";
import { toolLoaders } from "@/lib/mcp-mount";
import { myBuildsRoute } from "@/lib/my-builds-tool";
import { getRelease } from "@/lib/release";
import { MY_BUILDS, savedBuildsOn } from "@/lib/saved-builds";
import { argumentsFromQuery } from "@/lib/tool-query";
import { ledgerMetrics } from "@/lib/question-ledger";
import { recordUsage } from "@/lib/usage-metrics";

/**
 * GET /api/tools/{tool}: one MCP tool's answer over plain HTTP, for developers without an MCP client.
 * The same handlers the MCP mounts call, reading the same release and store, so a tool answers the same
 * both ways. Arguments come from the query string and are read with the tool's own input schema, after
 * the plain-text coercion a URL needs: a number parameter takes "19019", a boolean "true" or "false".
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

function refuse(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status, headers: NO_STORE });
}

let handlers: ToolHandlers | null = null;
let handlersGuilds = false;

export async function GET(req: Request, context: { params: Promise<{ tool: string }> }) {
  const { tool } = await context.params;
  // The player's own builds: read with their session or key, not the public quota. Unknown while the switch is off.
  if (tool === MY_BUILDS && savedBuildsOn()) return myBuildsRoute(req);
  // The tools this deployment answers: the guild ladder's two only while EVERLOOT_GUILDS is on.
  const loaders = toolLoaders();
  const names = registeredToolNames(loaders);
  if (!(names as string[]).includes(tool)) return refuse(404, `No tool named ${tool}. Tools: ${names.join(", ")}.`);
  const name = tool as McpToolName;
  // The same key surface and per-IP quota as the other per-row JSON endpoints (/api/edges, /api/items).
  const admitted = await admit(req, "drops");
  if (admitted instanceof Response) return admitted;
  const parsed = z.object(MCP_TOOLS[name].inputSchema).safeParse(argumentsFromQuery(name, new URL(req.url).searchParams));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ");
    return refuse(400, `${issues}. The parameters are described at ${SITE}/schema/mcp/${name}.json.`);
  }
  const release = await getRelease();
  if (!release) return refuse(503, "Knowledge release unavailable. The answer is unrecorded, not zero.");
  // Built again when the switch changes, so the guild tools never answer from a reader the switch has withdrawn.
  if (!handlers || handlersGuilds !== Boolean(loaders.guilds)) {
    handlers = createToolHandlers(release.db, loaders);
    handlersGuilds = Boolean(loaders.guilds);
  }
  recordUsage("api.tools");
  let answer;
  try {
    answer = await (handlers[name] as (a: unknown) => ReturnType<ToolHandlers[McpToolName]>)(parsed.data);
  } catch (err) {
    return refuse(400, err instanceof Error ? err.message : "The tool refused the arguments.");
  }
  const text = typeof answer === "string" ? answer : answer.text;
  const structured = typeof answer === "string" ? { text } : answer.structured;
  // The question ledger: whether a lookup found anything, as a counter named by the tool alone.
  recordUsage(ledgerMetrics(name, structured));
  return NextResponse.json(
    { tool: name, arguments: parsed.data, answer: structured, text, schema: `${SITE}/schema/mcp/${name}.json` },
    { headers: { ...NO_STORE, ...attributionHeaders() } },
  );
}
