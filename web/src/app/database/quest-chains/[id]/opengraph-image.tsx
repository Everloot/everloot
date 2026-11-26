import { loadCatalog, parseSegment } from "@/lib/completion-lists";
import { CARD_SIZE } from "@/lib/og-card";
import { count, provenance, shareImage } from "../../share-image";

export const alt = "A WoW Forever quest chain on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The quest chain page's card: the chain's name, how many quests it lists (80+ for a cut chain, as the page), and
// where it comes from. The page's 404.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = parseSegment((await params).id);
  if (id === null) return shareImage(null);
  const catalog = await loadCatalog();
  const entry = catalog?.chains.find((c) => c.questLineId === id);
  if (catalog && !entry) return shareImage(null);
  const quests = entry ? (entry.truncated ? `${entry.questIds.length}+ quests` : count(entry.questIds.length, "quest")) : null;
  return shareImage({ type: "Quest chain", title: entry?.name ?? `Quest chain ${id}`, facts: [quests, entry ? provenance(entry.confirmed) : null] });
}
