import { NextResponse } from "next/server";
import { QUALITIES, slotOf } from "@kb/item-taxonomy";
import { gameDataNotice } from "@/lib/edges";
import { CLIENT_TAXONOMY as T } from "@/lib/items";
import { recordUsage } from "@/lib/usage-metrics";

/**
 * GET /api/items/categories: the item class and subclass tree of the current build with slugs and item
 * counts, plus the slot and quality slugs `/api/items` takes. Game-file data with the `gameData` notice.
 */
export const dynamic = "force-static";

export async function GET() {
  recordUsage("api.items_categories");
  const slots = [...new Map(T.items.map((r) => slotOf(r[3])).filter((s) => s !== null).map((s) => [s!.slug, { slug: s!.slug, name: s!.name }])).values()];
  return NextResponse.json({
    classes: T.classes.map((c) => ({ ...c, subclasses: T.subclasses.filter((s) => s.classId === c.id).map(({ classId: _c, ...s }) => s) })),
    slots,
    qualities: QUALITIES,
    gameData: gameDataNotice(),
  }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
