import { loadCatalog, parseSegment, titleDisplayName } from "@/lib/completion-lists";
import { CARD_SIZE } from "@/lib/og-card";
import { provenance, shareImage } from "../../share-image";

export const alt = "A WoW Forever title on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The title page's card: the title as the page writes it ("<Name>, Champion") and where it comes from. The page's 404.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = parseSegment((await params).id);
  if (id === null) return shareImage(null);
  const catalog = await loadCatalog();
  const entry = catalog?.titles.find((t) => t.titleId === id);
  if (catalog && !entry) return shareImage(null);
  return shareImage({ type: "Title", title: entry ? titleDisplayName(entry.name) : `Title ${id}`, facts: [entry ? provenance(entry.confirmed) : null] });
}
