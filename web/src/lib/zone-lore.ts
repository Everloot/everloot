import { firstSentence, loreByExtId, loreSlug, renderBody, UNAVAILABLE, type Unavailable } from "./lore";
import { loreFor } from "./lore-links";

export interface ZoneLore { name: string; text: string; href: string; sourceUrl: string; licence: string }

/**
 * The lore archive's zone page for this zone, as its first paragraph and a link. Null when there is none; unavailable
 * when the archive or the names cannot be read, so the zone page marks itself degraded (components/EdgeDegraded.tsx)
 * rather than let a cache keep it without its lore. The match is the rule every database page uses (`loreFor`, lib/lore-links.ts): the
 * zone's name is its own (no other zone or instance has it), the archive has exactly one zone page of that name,
 * and that page links back to this zone.
 */
export async function zoneLore(mapId: number, name: string): Promise<ZoneLore | null | Unavailable> {
  const match = await loreFor("zone", mapId, name);
  if (!match || match === UNAVAILABLE) return match;
  // The lore section is optional: a read that fails after the match leaves it out rather than failing the zone page.
  const page = await loreByExtId(match.extId).catch((err: unknown) => {
    console.error("zone lore: release read failed", err);
    return UNAVAILABLE;
  });
  if (page === UNAVAILABLE) return UNAVAILABLE;
  if (!page || page.type !== "zone") return null;
  const first = renderBody(page.body)[0];
  const text = first?.type === "p" ? first.text.replace(/\s+/g, " ").trim() : firstSentence(page.body, 400);
  if (!text) return null;
  return { name: page.name, text, href: `/lore/${loreSlug(page)}`, sourceUrl: page.sourceUrl, licence: page.licence.replace("CC-BY-SA-4.0", "CC BY-SA 4.0") };
}
