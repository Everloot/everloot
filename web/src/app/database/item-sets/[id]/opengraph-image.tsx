import { loadItemSetNames } from "@/lib/game-assets";
import { itemSet } from "@/lib/item-sets";
import { CLIENT_LAYER } from "@/lib/items";
import { CARD_SIZE } from "@/lib/og-card";
import { count, provenance, shareImage } from "../../share-image";

export const alt = "A WoW Forever item set on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The item set page's card: the names file's name (else "Item set N", as the page), its pieces and set bonuses as the
// files list them, labelled unconfirmed. Text only: no piece icon (docs/ASSETS.md). The page's 404.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const segment = (await params).id;
  const set = /^[1-9]\d*$/.test(segment) ? itemSet(Number(segment)) : undefined;
  if (!set) return shareImage(null);
  const name = (await loadItemSetNames(CLIENT_LAYER.build.version))?.names.get(set.id);
  return shareImage({
    type: "Item set",
    title: name ?? `Item set ${set.id}`,
    facts: [count(set.items.length, "piece"), count(set.bonuses.length, "set bonus", "set bonuses"), provenance(false)],
  });
}
