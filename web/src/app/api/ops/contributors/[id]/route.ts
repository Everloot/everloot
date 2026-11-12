import { authorizeOps } from "@/lib/ops/access";
import { contributorIdentity } from "@/lib/ops/attribution";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeOps(req, "contributors");
    if (!principal || principal.kind !== "human") return Response.json({ error: "Operations access denied." }, { status: 403, headers });
    const { id } = await context.params;
    if (!/^[a-f0-9]{64}$/.test(id)) return Response.json({ error: "Not found" }, { status: 404, headers });
    return Response.json(await contributorIdentity(id), { headers });
  } catch { return Response.json({ identity: null, attribution: "unavailable" }, { status: 503, headers }); }
}
