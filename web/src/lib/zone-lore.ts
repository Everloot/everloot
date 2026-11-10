import { firstSentence, loreByExtId, loreSlug, renderBody, UNAVAILABLE } from "./lore";
import { loreFor } from "./lore-links";

export interface ZoneLore { name: string; text: string; href: string; sourceUrl: string; licence: string }

/**
 * The lore archive's zone page for this zone, as its first paragraph and a link. Null when there is none or the
 * archive cannot be opened. The match is the rule every database page uses (`loreFor`, lib/lore-links.ts): the
 * zone's name is its own (no other zone or instance has it), the archive has exactly one zone page of that name,
 * and that page links back to this zone.
 */
export async function zoneLore(mapId: number, name: string): Promise<ZoneLore | null> {
  const match = await loreFor("zone", mapId, name);
  if (!match || match === UNAVAILABLE) return null;
  // The lore section is optional: a read that fails after the match leaves it out rather than failing the zone page.
  const page = await loreByExtId(match.extId).catch(() => null);
  if (!page || page === UNAVAILABLE || page.type !== "zone") return null;
  const first = renderBody(page.body)[0];
  const text = first?.type === "p" ? first.text.replace(/\s+/g, " ").trim() : firstSentence(page.body, 400);
  if (!text) return null;
  return { name: page.name, text, href: `/lore/${loreSlug(page)}`, sourceUrl: page.sourceUrl, licence: page.licence.replace("CC-BY-SA-4.0", "CC BY-SA 4.0") };
}
