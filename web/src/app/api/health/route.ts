import { NextResponse } from "next/server";
import { uploadStore, type SnapshotHealth } from "@/lib/upload-store";
import { dispatchHealth, viewsHealth, type DispatchHealth, type ViewsHealth } from "@/lib/stored-views-status";
export const dynamic = "force-dynamic";
let cached: { at: number; snapshot: SnapshotHealth; views: ViewsHealth; viewsDispatch: DispatchHealth } | undefined;
export async function GET() {
  if (!cached || Date.now() - cached.at > 60_000) {
    // snapshotHealth measures the cron heartbeat; idle corpus data keeps its original dataAsOf.
    const [snapshot, views, viewsDispatch] = await Promise.all([uploadStore.snapshotHealth(), viewsHealth(), dispatchHealth()]);
    cached = { at: Date.now(), snapshot, views, viewsDispatch };
  }
  // The status code follows the snapshot cron alone, as uptime monitors and the deploy's warm step expect. The stored
  // views and the job's start token are reported beside it; the site-health check raises them (#1354).
  const { snapshot, views, viewsDispatch } = cached;
  const ok = snapshot.status === "fresh";
  return NextResponse.json({ ok, snapshot, views, viewsDispatch }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
