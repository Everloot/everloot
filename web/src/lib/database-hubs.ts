/**
 * The lists /database links, in the order it shows them, in two blocks: `source: "players"` rows fill from what
 * installs report ("Seen by players"), `source: "files"` rows read the game files ("From the game files"). The
 * sitemap lists the same pages, so a hub is added here once and is linked and listed together; what count to print
 * beside it is the hub page's own business, and a row with none prints none. A page that asks for noindex is added
 * with `unlisted`: it is linked and left out of the sitemap, as the sitemap's rule is that only a page that asks to
 * be indexed is listed. The Guilds lookup is a tool, not a list: the Tools menu and the sitemap carry it.
 */
export interface DatabaseHub { href: string; label: string; source: "players" | "files"; unlisted?: true }

export const DATABASE_HUBS: readonly DatabaseHub[] = [
  { href: "/database/npcs", label: "NPCs", source: "players" },
  { href: "/database/quests", label: "Quests", source: "players" },
  { href: "/database/vendors", label: "Vendors", source: "players" },
  { href: "/database/objects", label: "Objects: chests, herbs, ore", source: "players" },
  { href: "/database/spells", label: "Spells", source: "files" },
  { href: "/database/achievements", label: "Achievements", source: "files" },
  { href: "/database/factions", label: "Factions", source: "files" },
  { href: "/database/titles", label: "Titles", source: "files" },
  { href: "/database/quest-chains", label: "Quest chains", source: "files" },
  { href: "/database/drops", label: "Loot observations", source: "players" },
  { href: "/database/coverage", label: "Coverage: where the data is thin", source: "players" },
  { href: "/database/download", label: "Download the data", source: "players" },
  { href: "/database/zones", label: "Zones", source: "files" },
  { href: "/database/instances", label: "Dungeons and raids", source: "files" },
];

/** The hub pages the sitemap lists whatever the data: the database landing page, the all-items list and each listed hub. */
export const DATABASE_HUB_PATHS: readonly string[] = ["/database", "/database/items", ...DATABASE_HUBS.filter((h) => !h.unlisted).map((h) => h.href)];
