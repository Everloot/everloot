import { loadAgreedMounts, mountEntries } from "@/lib/collectibles";
import { parseSegment } from "@/lib/completion-lists";
import { CARD_SIZE } from "@/lib/og-card";
import { provenance, shareImage } from "../../share-image";

export const alt = "A WoW Forever mount on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The mount page's card: the files' name, its riding skill, and whether three installs reported it. The page's 404.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = parseSegment((await params).id);
  const mount = id === null ? undefined : mountEntries()?.find((m) => m.id === id);
  if (!mount) return shareImage(null);
  const confirmed = (await loadAgreedMounts())?.has(mount.spellId) ?? false;
  return shareImage({ type: "Mount", title: mount.name, facts: [mount.ridingSkill ? `Riding skill ${mount.ridingSkill}` : null, provenance(confirmed)] });
}
