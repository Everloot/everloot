import { firstSentence, loreByExtId, loreSlug, renderBody, searchLore, UNAVAILABLE } from "./lore";

export interface ZoneLore { name: string; text: string; href: string; sourceUrl: string; licence: string }

/**
 * The lore archive's zone page with exactly this name, as its first paragraph and a link. Null when there is
 * none or the archive cannot be opened. Exact name only, and only a page typed as a zone: "Durotar" the
 * zone, never a search hit for something with the word in it.
 */
export async function zoneLore(name: string): Promise<ZoneLore | null> {
  const found = await searchLore(name, 1, "zone");
  if (found === UNAVAILABLE) return null;
  const hit = found.hits.find((h) => h.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (!hit) return null;
  const page = await loreByExtId(hit.extId);
  if (!page || page === UNAVAILABLE || page.type !== "zone") return null;
  const first = renderBody(page.body)[0];
  const text = first?.type === "p" ? first.text.replace(/\s+/g, " ").trim() : firstSentence(page.body, 400);
  if (!text) return null;
  return { name: page.name, text, href: `/lore/${loreSlug(page)}`, sourceUrl: page.sourceUrl, licence: page.licence.replace("CC-BY-SA-4.0", "CC BY-SA 4.0") };
}
