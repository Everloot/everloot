import type { AwsClient } from "aws4fetch";

export const STAMP = "x-amz-meta-data-as-of";
export const stampOf = (dataAsOf: string | null) => dataAsOf ?? "none";

/** Missing/unstamped/stale files need a write. Unknown freshness waits for the next cron instead of rebuilding. */
export async function storedViewNeedsWrite(client: AwsClient, url: string, dataAsOf: string | null | undefined, doFetch: typeof fetch): Promise<boolean> {
  const differs = (stamp: string | null) => dataAsOf !== undefined && stamp !== stampOf(dataAsOf);
  try {
    const head = await doFetch(await client.sign(url, { method: "HEAD" }));
    if (head.status === 404) return true;
    if (head.ok) return differs(head.headers.get(STAMP));
  } catch {
    // Some stores cannot serve HEAD reliably. Read the file before deciding to rebuild it.
  }
  try {
    const res = await doFetch(await client.sign(url, { method: "GET", headers: { "accept-encoding": "identity" } }));
    if (res.status === 404) return true;
    if (!res.ok) throw new Error(`GET failed (${res.status})`);
    const stamp = res.headers.get(STAMP);
    if (stamp !== null) return differs(stamp);
    const raw: unknown = await res.json();
    if (typeof raw === "object" && raw !== null) {
      const body = raw as { dataAsOf?: unknown; set?: { dataAsOf?: unknown } | null };
      const at = "dataAsOf" in body ? body.dataAsOf : body.set?.dataAsOf;
      if (at === null || typeof at === "string") return differs(stampOf(at));
    }
    throw new Error("GET has no snapshot time");
  } catch (error) {
    console.warn(`stored view freshness unreadable; skipping this run (${url})`, error);
    return false;
  }
}
