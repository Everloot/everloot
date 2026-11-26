import { vendorPage } from "@kb/world-pages";
import { npcNames } from "@/lib/names";
import { CARD_SIZE } from "@/lib/og-card";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { count, shareImage } from "../../share-image";
import { unknownVendor } from "../../unknown";

export const alt = "A WoW Forever vendor on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The vendor page's card: the NPC name three installs agree on (else "Vendor NPC N", as the page) and how many goods
// players agree it sells. While storage cannot be read neither is known. The page's 404.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return shareImage(null);
  const facts = await loadWorldFacts();
  const page = vendorPage(Number(id), facts);
  if (unknownVendor(page.vendorNpcId, facts)) return shareImage(null);
  const name = facts.unreachable ? undefined : npcNames(facts).get(page.vendorNpcId);
  return shareImage({
    type: "Vendor",
    title: name ?? `Vendor NPC ${page.vendorNpcId}`,
    facts: [!facts.unreachable && page.offers.length ? count(page.offers.length, "item sold", "items sold") : null],
  });
}
