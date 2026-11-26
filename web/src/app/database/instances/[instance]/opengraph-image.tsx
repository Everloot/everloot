import { instanceRows, instanceTitle, loadSightings, parseInstanceSegment } from "@/lib/instances";
import { CARD_SIZE } from "@/lib/og-card";
import { count, shareImage } from "../../share-image";

export const alt = "A WoW Forever instance on Everloot";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// The instance page's card: its name, raid or dungeon, the level range and how many bosses the game files list. No
// loading screen: docs/ASSETS.md keeps game art on share cards to the item card. The page's 404.
export default async function Image({ params }: { params: Promise<{ instance: string }> }) {
  const id = parseInstanceSegment((await params).instance);
  if (id === null) return shareImage(null);
  const seen = await loadSightings();
  const row = instanceRows(seen.unreachable ? {} : seen).get(id);
  if (!row) return shareImage(null);
  const level = row.level ? (row.level.min === row.level.max ? `Level ${row.level.min}` : `Level ${row.level.min}-${row.level.max}`) : null;
  return shareImage({
    type: row.raid === null ? "Instance" : row.raid ? "Raid" : "Dungeon",
    title: instanceTitle(row),
    facts: [level, row.encounters.length ? count(row.encounters.length, "boss", "bosses") : null],
  });
}
