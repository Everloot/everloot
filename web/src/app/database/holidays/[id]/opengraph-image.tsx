import { parseSegment } from "@/lib/completion-lists";
import { CARD_SIZE } from "@/lib/og-card";
import { holidayEntries, lastsLabel } from "@/lib/world-events";
import { provenance, shareImage } from "../../share-image";

export const alt = "A WoW Forever holiday on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The holiday page's card: the files' name and how long it lasts, labelled unconfirmed. The page's 404.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = parseSegment((await params).id);
  const holiday = id === null ? undefined : holidayEntries()?.find((h) => h.id === id);
  if (!holiday) return shareImage(null);
  const lasts = lastsLabel(holiday.hours);
  return shareImage({ type: "Holiday", title: holiday.name, facts: [lasts ? `Lasts ${lasts}` : null, provenance(false)] });
}
