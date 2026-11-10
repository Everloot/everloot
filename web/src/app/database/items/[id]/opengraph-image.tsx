import { qualityOf } from "@/components/ui/quality";
import { notFound } from "next/navigation";
import { edgesFrom } from "../../../../../../kb/src/edges";
import { itemNameReporters, itemPage } from "../../../../../../kb/src/item-page";
import { categoryOf } from "../../../../../../kb/src/item-taxonomy";
import { AGREEMENT_NEEDED } from "@/components/ui/AgreementMeter";
import { loadEdges } from "@/lib/edges";
import { loadItemSeen } from "@/lib/item-seen";
import { CLIENT_TAXONOMY, shownItemName, subclassLabel } from "@/lib/items";
import { CARD_SIZE, renderEntityCard } from "@/lib/og-card";
import { loadShownNames } from "@/lib/shown-item-names";
import { unknownItem } from "../../unknown";

export const alt = "A WoW Forever item on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The item page's card: the name the page shows, the class and subclass line under its title, and how many
// installs agree on the name. The same 404 as the page, so a class slug (/database/items/weapons) has none.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) notFound();
  const itemId = Number(id);
  const [{ facts, agreed, matched }, edges, itemSeen] = await Promise.all([loadShownNames(), loadEdges(), loadItemSeen()]);
  if (unknownItem(itemId, facts, edgesFrom([...edges.observed, ...edges.client], "item", itemId), itemSeen)) notFound();
  const page = itemPage(itemId, facts);
  const category = categoryOf(CLIENT_TAXONOMY, itemId);
  const type = [category?.class?.label, category?.subclass ? subclassLabel(category.subclass).label : null].filter(Boolean).join(" · ") || "Item";
  return renderEntityCard({
    title: shownItemName(itemId, agreed, matched?.names)?.name ?? `Item ${itemId}`,
    type,
    quality: category?.quality && category.quality.id <= 5 ? qualityOf(category.quality.id) : undefined,
    color: shownItemName(itemId, agreed, matched?.names)?.color ?? undefined,
    omitZero: true,
    installs: facts.unreachable ? null : page.name ? AGREEMENT_NEEDED : itemNameReporters(itemId, facts),
  });
}
