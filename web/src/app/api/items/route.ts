import { NextResponse } from "next/server";
import { describe, filterItems, resolveClass, resolveLegacyClass, resolveSubclass, type ItemFilter } from "@kb/item-taxonomy";
import { admit, badPage, pageOf, pageRequest } from "@/lib/data-guard";
import { gameDataNotice } from "@/lib/edges";
import { CLIENT_TAXONOMY as T, itemFacets, matchesFacets, QUALITY_SLUGS, SLOT_SLUGS, type CategoryQuery } from "@/lib/items";
import { recordUsage } from "@/lib/usage-metrics";

/**
 * GET /api/items: every item in the current build with its class, subclass, slot and quality, from the
 * game files. Filters: `item` (one id), `class` and `subclass` (slugs, or a subclass number), `slot`,
 * `quality`, and from the game files' relations `crafted=1`, `reagent=1`, `set=1` and `skill` (a profession
 * slug: items its spells make or use), as the database lists filter. Paged through the data guard like the other bulk endpoints. Game-file data: it carries the
 * `gameData` notice and build, not Everloot's CC BY-SA attribution.
 */
export const dynamic = "force-dynamic";

function bad(error: string): Response {
  return Response.json({ ok: false, error }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request) {
  recordUsage("api.items");
  const params = new URL(req.url).searchParams;
  const f: ItemFilter = {};
  const item = params.get("item");
  if (item !== null && !/^[1-9]\d{0,9}$/.test(item)) return bad("item must be a positive whole number.");
  const cls = params.get("class");
  const sub = params.get("subclass");
  if (sub !== null && cls === null) return bad("subclass needs class.");
  if (cls !== null) {
    const c = resolveClass(T, cls) ?? resolveLegacyClass(T, cls);
    if (!c) return bad(`class must be one of ${T.classes.map((x) => x.slug).join(", ")}.`);
    f.classId = c.id;
    if (sub !== null) {
      const s = resolveSubclass(T, c.id, sub);
      if (!s) return bad(`subclass must be one of ${T.subclasses.filter((x) => x.classId === c.id).map((x) => x.slug).join(", ")}.`);
      f.subclassId = s.id;
    }
  }
  const slot = params.get("slot");
  if (slot !== null) {
    if (!SLOT_SLUGS.includes(slot)) return bad(`slot must be one of ${SLOT_SLUGS.join(", ")}.`);
    f.slot = slot;
  }
  const quality = params.get("quality");
  if (quality !== null) {
    if (!QUALITY_SLUGS.includes(quality)) return bad(`quality must be one of ${QUALITY_SLUGS.join(", ")}.`);
    f.quality = quality;
  }
  // What the game files say an item is part of: made by a spell, used by one, a set piece, or either for a profession.
  const facets: Pick<CategoryQuery, "crafted" | "reagent" | "set" | "skill"> = {};
  for (const key of ["crafted", "reagent", "set"] as const) {
    const v = params.get(key);
    if (v === null) continue;
    if (v !== "1") return bad(`${key} must be 1.`);
    facets[key] = true;
  }
  const skill = params.get("skill");
  if (skill !== null) {
    const known = itemFacets().professions.map((p) => p.slug);
    if (!known.includes(skill)) return bad(`skill must be one of ${known.join(", ")}.`);
    facets.skill = skill;
  }
  const admitted = await admit(req, "drops");
  if (admitted instanceof Response) return admitted;
  const at = pageRequest(req, admitted.pageMax);
  if (!at) return badPage();
  const rows = filterItems(T, f).filter((r) => (item === null || r[0] === Number(item)) && matchesFacets(r[0], facets));
  const { items, page } = pageOf(req, rows, at);
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    items: items.map((r) => describe(T, r)),
    offset: page.offset,
    limit: page.limit,
    total: page.total,
    next: page.next,
    gameData: gameDataNotice(),
  });
}
