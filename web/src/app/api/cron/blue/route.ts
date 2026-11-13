import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { readBlueStore, writeBlueStore } from "@/lib/blue-store";
import { ingestBluePosts } from "../../../../../../kb/src/blue-posts";
import { parseOverrides } from "../../../../../../kb/src/blue-forum";
import accounts from "../../../../../../kb/curated/blue-accounts.json";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// A run that outlasts about half a minute is cut off by the platform before it saves anything, so its whole pass is
// repeated and never advances. The pass stops starting requests after this long and saves its place instead; the next
// run (10 minutes later) carries on. One request may still be in flight at the deadline, so its own timeout follows.
const DEADLINE_MS = 15_000;
const REQUEST_TIMEOUT_MS = 8_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await ingestBluePosts({
      store: await readBlueStore(),
      overrides: parseOverrides(accounts),
      now: new Date(),
      minIntervalMs: 8 * 60_000,
      deadlineMs: DEADLINE_MS,
      fetcher: (url, init) => fetch(url, { ...init, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
    });
    await writeBlueStore(result.store);
    if (result.added.length) revalidateTag("blue");
    const summary = { fetched: Object.values(result.requests).reduce((sum, n) => sum + n, 0), added: result.added.length, requests: result.requests };
    // Counts expose source failures and rate limits without logging signed storage URLs or headers.
    console.info("blue tracker", { ...summary, errors: result.errors.length });
    for (const error of result.errors) console.warn("blue source failed", error);
    return NextResponse.json({ ok: result.errors.length === 0, ...summary }, { status: result.errors.length ? 502 : 200 });
  } catch {
    return NextResponse.json({ ok: false, error: "blue tracker failed" }, { status: 500 });
  }
}
