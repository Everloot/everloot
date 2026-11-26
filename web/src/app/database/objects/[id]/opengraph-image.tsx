import { objectPage } from "@kb/object-page";
import { loadObjectFacts } from "@/lib/objects";
import { CARD_SIZE } from "@/lib/og-card";
import { count, shareImage } from "../../share-image";
import { unknownObject } from "../../unknown";

export const alt = "A WoW Forever object on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The object page's card: the name three installs agree on (else "Object N") and how many items players found in it.
// While storage cannot be read neither is known, as on the page. The page's 404.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return shareImage(null);
  const facts = await loadObjectFacts();
  const page = objectPage(Number(id), facts);
  if (unknownObject(page, facts, facts.unreachable)) return shareImage(null);
  return shareImage({
    type: "Object",
    title: !facts.unreachable && page.name ? page.name : `Object ${page.objectId}`,
    facts: [!facts.unreachable && page.drops.length ? count(page.drops.length, "item seen", "items seen") : null],
  });
}
