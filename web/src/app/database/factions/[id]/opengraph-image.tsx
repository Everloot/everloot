import { factionInFiles, loadCatalog, parseSegment } from "@/lib/completion-lists";
import { CARD_SIZE } from "@/lib/og-card";
import { provenance, shareImage } from "../../share-image";

export const alt = "A WoW Forever faction on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The faction page's card: the listed name, the header it sits under, and where it comes from. While storage cannot
// be read the page still answers with "Faction N", and so does the card. The page's 404.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = parseSegment((await params).id);
  if (id === null) return shareImage(null);
  const catalog = await loadCatalog();
  const entry = catalog?.factions.find((f) => f.factionId === id);
  if (catalog && !entry) return shareImage(null);
  const under = factionInFiles(id)?.parent?.name ?? entry?.header ?? null;
  return shareImage({
    type: "Faction",
    title: entry?.name ?? `Faction ${id}`,
    facts: [under ? `Under ${under}` : null, entry ? provenance(entry.confirmed) : null],
  });
}
