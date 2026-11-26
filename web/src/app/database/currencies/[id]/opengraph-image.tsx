import { currencyEntries } from "@/lib/collectibles";
import { parseSegment } from "@/lib/completion-lists";
import { CARD_SIZE } from "@/lib/og-card";
import { provenance, shareImage } from "../../share-image";

export const alt = "A WoW Forever currency on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The currency page's card: the files' name, category and cap, labelled unconfirmed. The page's 404.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = parseSegment((await params).id);
  const currency = id === null ? undefined : currencyEntries()?.find((c) => c.id === id);
  return shareImage(currency && {
    type: "Currency",
    title: currency.name,
    facts: [currency.category, currency.max ? `Cap ${currency.max.toLocaleString("en-US")}` : null, provenance(false)],
  });
}
