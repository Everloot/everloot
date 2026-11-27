import { attributionHeaders } from "@/lib/data-guard";
import { llmsFullTxt } from "@/lib/llms";
import { timelineDegraded } from "@/lib/changes";
import { keepBrieflyIf } from "@/lib/degraded-render";

/** The long version of /llms.txt, generated the same way. */
export const dynamic = "force-static";
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const text = await llmsFullTxt();
  // Its latest-build line reads the changes timeline: the bundled posts (the build's render, or a store outage) are
  // kept seconds, not the hour.
  await keepBrieflyIf(await timelineDegraded());
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=3600", ...attributionHeaders() } });
}
