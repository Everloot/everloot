import { parseSegment } from "@/lib/completion-lists";
import { CARD_SIZE } from "@/lib/og-card";
import { petFamilyEntries } from "@/lib/world-events";
import { count, provenance, shareImage } from "../../share-image";

export const alt = "A WoW Forever hunter pet family on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The pet family page's card: the files' name and how many spells its skill line holds, labelled unconfirmed.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = parseSegment((await params).id);
  const family = id === null ? undefined : petFamilyEntries()?.find((f) => f.id === id);
  return shareImage(family && { type: "Hunter pet family", title: family.name, facts: [count(family.spellIds.length, "spell"), provenance(false)] });
}
