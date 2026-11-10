import { slugify } from "./lore-slug.js";

/** `<id>-<slug>` from the id and the name's words; a name with no letters or digits leaves the bare id. */
function segment(id: string, name: string): string {
  const words = slugify(name);
  return words ? `${id}-${words}` : id;
}

/**
 * The everloot.app path of a catalog record, or null when its kind has no page of its own. Instances use the
 * same address as the database page (web/src/lib/instances.ts), where the id is the instance's map id.
 */
export function catalogPath(kind: string, extId: string, name: string, sourceKind?: string): string | null {
  if (sourceKind === "observed" || sourceKind === "game-files") {
    switch (kind) {
      case "item": return `/database/items/${segment(extId, name)}`;
      case "npc": return `/database/npcs/${segment(extId, name)}`;
      case "object": return `/database/objects/${segment(extId, name)}`;
      case "quest": return `/database/quests/${segment(extId, name)}`;
      case "zone": return `/database/zones/${segment(extId, name)}`;
    }
  }
  switch (kind) {
    case "achievement": return `/database/achievements/${segment(extId, name)}`;
    case "faction": return `/database/factions/${segment(extId, name)}`;
    // The game's `%s` name slot stays out of the slug, as on the site (web/src/lib/completion-lists.ts titleHref).
    case "title": return `/database/titles/${segment(extId, name.replace(/%s/g, " "))}`;
    case "quest_chain": return `/database/quest-chains/${segment(extId, name)}`;
    case "instance": return `/database/instances/${segment(extId, name)}`;
    case "mount": return "/tools/collections";
    case "legacy_perk": return "/tools/legacy";
    case "race": return "/classes/choose";
    default: return null;
  }
}
