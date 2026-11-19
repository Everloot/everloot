import { NextResponse } from "next/server";
import { RELS, type EdgeKind, type Evidence, type Rel } from "@kb/edges";
import { admit, attribution, attributionHeaders, badPage, pageOf, pageRequest } from "@/lib/data-guard";
import { filterEdges, gameDataNotice, loadEdges, type EdgeFilter } from "@/lib/edges";
import { recordUsage } from "@/lib/usage-metrics";

/**
 * GET /api/edges: typed relations between entities (kb/src/edges.ts). Filters: `from_kind`, `from_id`,
 * `to_kind`, `to_id`, `rel`, `evidence` (observed or client). Observed edges come first, then the game-file
 * ones; with no filter the whole table pages like the corpus feed, which is the bulk path. Observed rows
 * are ours under CC BY-SA (`attribution`); game-file rows are Blizzard's and come with `gameData` instead.
 */
export const dynamic = "force-dynamic";

const KINDS: readonly EdgeKind[] = ["item", "spell", "npc", "object", "quest", "zone", "item_set", "icon", "skill"];
const EVIDENCE: readonly Evidence[] = ["observed", "client"];

function bad(error: string): Response {
  return Response.json({ ok: false, error }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

/** The filter from the query string; a string is the error for a bad parameter. */
function parseFilter(params: URLSearchParams): EdgeFilter | string {
  const f: EdgeFilter = {};
  for (const side of ["from", "to"] as const) {
    const kind = params.get(`${side}_kind`);
    const id = params.get(`${side}_id`);
    if (kind !== null) {
      if (!KINDS.includes(kind as EdgeKind)) return `${side}_kind must be one of ${KINDS.join(", ")}.`;
      f[side === "from" ? "fromKind" : "toKind"] = kind as EdgeKind;
    }
    if (id !== null) {
      if (!/^[1-9]\d{0,9}$/.test(id)) return `${side}_id must be a positive whole number.`;
      f[side === "from" ? "fromId" : "toId"] = Number(id);
    }
  }
  const rel = params.get("rel");
  if (rel !== null) {
    if (!(RELS as readonly string[]).includes(rel)) return `rel must be one of ${RELS.join(", ")}.`;
    f.rel = rel as Rel;
  }
  const evidence = params.get("evidence");
  if (evidence !== null) {
    if (!EVIDENCE.includes(evidence as Evidence)) return "evidence must be observed or client.";
    f.evidence = evidence as Evidence;
  }
  return f;
}

export async function GET(req: Request) {
  recordUsage("api.edges");
  const filter = parseFilter(new URL(req.url).searchParams);
  if (typeof filter === "string") return bad(filter);
  const admitted = await admit(req, "drops");
  if (admitted instanceof Response) return admitted;
  const at = pageRequest(req, admitted.pageMax);
  if (!at) return badPage();
  const { observed, client, unreachable, dataAsOf } = await loadEdges();
  const all = filterEdges([...observed, ...client], filter);
  const { items, page } = pageOf(req, all, at);
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    dataAsOf,
    unreachable,
    edges: items,
    offset: page.offset,
    limit: page.limit,
    total: page.total,
    next: page.next,
    attribution: attribution("/database/items"),
    gameData: items.some((e) => e.evidence === "client") ? gameDataNotice() : null,
  }, { headers: attributionHeaders() });
}
