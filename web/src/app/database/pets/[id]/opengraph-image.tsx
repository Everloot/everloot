import { petEntries } from "@/lib/collectibles";
import { parseSegment } from "@/lib/completion-lists";
import { CARD_SIZE } from "@/lib/og-card";
import { provenance, shareImage } from "../../share-image";

export const alt = "A WoW Forever companion pet on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The companion pet page's card: the files' name, labelled unconfirmed as the page is. The page's 404.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = parseSegment((await params).id);
  const pet = id === null ? undefined : petEntries()?.find((p) => p.id === id);
  return shareImage(pet && { type: "Companion pet", title: pet.name, facts: [provenance(false)] });
}
