import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { BUILD_PATTERN } from "@/lib/settled-cache";
import { readSettledList } from "@/lib/settled-store";

/**
 * GET /api/coverage/settled?build=<client build> — the settled list for one client build (kb/src/settled-list.ts):
 * per upload row kind, the ids whose facts are settled, sorted and delta-encoded. The Desktop App and the upload page
 * leave those rows out of an upload. Only facts the site already shows are in it, and never their values.
 * A build the cron has not looked at yet gets an empty list, so nothing is skipped on a new patch. ETag and
 * `If-None-Match` let the app revalidate its daily copy for nothing.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const build = new URL(req.url).searchParams.get("build") ?? "";
  if (!BUILD_PATTERN.test(build) || build.length > 32) {
    return NextResponse.json({ ok: false, error: "build must be a client build such as 1.60.1.70450" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  let body: string;
  try {
    body = JSON.stringify(await readSettledList(build));
  } catch {
    // Unknown is not empty: an app keeps the copy it has rather than caching an empty list.
    return NextResponse.json({ ok: false, error: "Storage unreachable. Keep the list you have and retry later." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
  const headers = { "CDN-Cache-Control": "public, max-age=600", etag, "cache-control": "public, max-age=600, s-maxage=600, stale-while-revalidate=3600" };
  const match = req.headers.get("if-none-match");
  if (match && match.split(",").map((t) => t.trim().replace(/^W\//, "")).includes(etag)) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(body, { status: 200, headers: { ...headers, "content-type": "application/json" } });
}
