import { CLIENT_LABEL } from "@kb/edges";
import { bossEntry } from "@/lib/bosses";
import { instanceRows, instanceTitle, loadSightings, parseInstanceSegment } from "@/lib/instances";
import { CARD_SIZE } from "@/lib/og-card";
import { shareImage } from "../../share-image";

export const alt = "A WoW Forever boss on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The boss page's card: its name, dungeon or raid boss, its instance and its place in the files' order, labelled
// unconfirmed while the name is the files'. No model picture: docs/ASSETS.md keeps game art on share cards to the
// item card. The page's 404.
export default async function Image({ params }: { params: Promise<{ boss: string }> }) {
  const id = parseInstanceSegment((await params).boss);
  if (id === null) return shareImage(null);
  const seen = await loadSightings();
  const boss = bossEntry(id, instanceRows(seen.unreachable ? {} : seen));
  if (!boss) return shareImage(null);
  return shareImage({
    type: boss.instance.raid === null ? "Boss" : boss.instance.raid ? "Raid boss" : "Dungeon boss",
    title: boss.name,
    facts: [instanceTitle(boss.instance), boss.order === null ? null : `Boss ${boss.order} of ${boss.total}`, boss.filesName && CLIENT_LABEL],
  });
}
