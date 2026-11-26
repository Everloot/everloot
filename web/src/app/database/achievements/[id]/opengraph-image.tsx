import { CLIENT_ACHIEVEMENTS } from "@/data/game-data/client-achievements";
import { loadCatalog, parseSegment } from "@/lib/completion-lists";
import { CARD_SIZE } from "@/lib/og-card";
import { provenance, shareImage } from "../../share-image";

export const alt = "A WoW Forever achievement on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The achievement page's card: the name and points as the page takes them (three installs first, the game files for
// the rest), and where they come from. A page exists for an id players reported or the files carry; else the page's 404.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = parseSegment((await params).id);
  if (id === null) return shareImage(null);
  const catalog = await loadCatalog();
  const listed = catalog?.achievements.find((a) => a.achievementId === id) ?? null;
  const entry = listed?.confirmed ? listed : null;
  const files = CLIENT_ACHIEVEMENTS.achievements[String(id)] ?? null;
  if (catalog && !listed && !files) return shareImage(null);
  const points = entry?.points ?? files?.points ?? null;
  return shareImage({
    type: "Achievement",
    title: listed?.name ?? files?.title ?? `Achievement ${id}`,
    facts: [points ? `${points} points` : null, listed || files ? provenance(Boolean(entry)) : null],
  });
}
