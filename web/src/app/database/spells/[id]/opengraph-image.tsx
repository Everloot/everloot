import { CARD_SIZE } from "@/lib/og-card";
import { count, shareImage } from "../../share-image";
import { loadSpell } from "./load-spell";

export const alt = "A WoW Forever spell on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The spell page's card: the name the page shows (else "Spell N") and how many items the files say it creates. No
// spell icon: docs/ASSETS.md keeps game art on share cards to the item card. The page's 404.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return shareImage(null);
  const spellId = Number(id);
  const { all, name, tip, unknown } = await loadSpell(spellId);
  if (unknown) return shareImage(null);
  const creates = all.filter((e) => e.rel === "created_by").length;
  return shareImage({ type: "Spell", title: name ?? tip?.name ?? `Spell ${spellId}`, facts: [creates ? `Creates ${count(creates, "item")}` : null] });
}
