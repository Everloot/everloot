import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

/**
 * GET /schema/<file>.json: the protocol's JSON Schema files, served from the installed @everloot/protocol
 * package so the site and the schemas can never disagree. index.json lists them; records/<kind>.json,
 * api/<name>.json, mcp/<tool>.json, upload.json and limits.json are the files. The $id on each file is
 * this URL. next.config.js traces the folder into the function.
 */
export const dynamic = "force-static";

const SAFE = /^(?:[a-z_]+|records\/[a-z_]+|api\/[a-zA-Z]+|mcp\/[a-z_]+)\.json$/;

// Resolved from the working directory, as the other file reads do: the bundler would turn an import.meta.url into a module id.
// PROTOCOL_SCHEMA_DIR points elsewhere on the Cloudflare Worker, where the files ship as text modules (wrangler.jsonc).
const schemaDir = () => process.env.PROTOCOL_SCHEMA_DIR?.trim() || join(process.cwd(), "node_modules", "@everloot", "protocol", "schema");

export async function GET(_req: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const file = path.join("/");
  if (!SAFE.test(file)) return NextResponse.json({ ok: false, error: "No such schema file." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  let body: string;
  try {
    body = await readFile(join(schemaDir(), file), "utf8");
  } catch {
    return NextResponse.json({ ok: false, error: "No such schema file." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/schema+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
