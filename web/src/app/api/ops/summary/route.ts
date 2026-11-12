import { authorizeOps } from "@/lib/ops/access";
import { readOpsSummary } from "@/lib/ops/store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  try {
    if (!await authorizeOps(req, "summary")) {
      return Response.json({ error: "Operations access denied." }, { status: 403, headers });
    }
    const summary = await readOpsSummary();
    if (!summary) return Response.json({ error: "Operations data unavailable." }, { status: 503, headers });
    // Deliberate projection: adding explorer/identity fields to the private
    // snapshot must never silently widen an aggregate agent's permissions.
    const { version, generatedAt, exclusionVersion, excludedInstalls, sources, activity, daily, historical, health, costs, usage } = summary;
    return Response.json({ version, generatedAt, exclusionVersion, excludedInstalls, sources, activity, daily, historical, health, costs, usage }, { headers });
  } catch {
    return Response.json({ error: "Operations data unavailable." }, { status: 503, headers });
  }
}
