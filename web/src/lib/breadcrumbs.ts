import type { Crumb } from "./jsonld";
import { CLASSES } from "@/design/tokens";

/**
 * Where a page sits, for the visible breadcrumb and its BreadcrumbList. /tools is the index of the menu, but a
 * tool's trail still goes from Home straight to the tool. Pages without an entry have no breadcrumb.
 */
const NAMES: Record<string, string> = {
  "/about": "About",
  "/tools": "Tools",
  "/privacy": "Privacy",
  "/terms": "Terms of use",
  "/security": "Security",
  "/accessibility": "Accessibility",
  "/contact": "Contact",
  "/upload": "Upload addon data",
  "/search": "Search",
  "/changes": "Patch notes and Blizzard posts",
  "/map": "World map",
  "/map/eastern-kingdoms": "Eastern Kingdoms",
  "/map/kalimdor": "Kalimdor",
  "/wow-forever": "What is WoW: Forever",
  "/census": "Census",
  "/rankings": "Rankings",
  "/wiki": "Wiki",
  "/news": "News",
  "/lore": "Lore archive",
  "/lore/coverage": "What the archive covers",
  "/lore/npcs": "NPCs",
  "/lore/items": "Items",
  "/lore/quests": "Quests",
  "/lore/zones": "Zones",
  "/lore/spells": "Spells",
  "/database": "Database",
  "/database/drops": "Loot observations",
  "/database/npcs": "NPC lookup",
  "/database/quests": "Quest lookup",
  "/database/vendors": "Vendor lookup",
  "/database/zones": "Zones",
  "/database/instances": "Dungeons and raids",
  "/database/achievements": "Achievements",
  "/database/factions": "Factions",
  "/database/titles": "Titles",
  "/database/quest-chains": "Quest chains",
  "/database/spells": "Spell lookup",
  "/database/coverage": "Coverage",
  "/database/download": "Download the data",
  "/addons": "Addons",
  "/addons/popular": "Popular addons",
  "/addons/ecosystem": "Addon tracker",
  "/addons/polestar": "Polestar",
  "/addons/polestar/packs": "Guide packs",
  "/addons/polestar/wanted": "Pack ideas",
  "/tools/talents": "Talent calculator",
  "/tools/raid": "Raid buff planner",
  "/tools/collections": "Collection gap",
  "/tools/guild-board": "Guild board",
  "/tools/auctions": "Auction House",
  "/tools/gold-ledger": "Gold ledger",
  "/tools/professions": "Profession hubs",
  "/tools/farming-routes": "Farming routes",
  "/docs": "Docs",
};

/** The parent of a page, when it is not Home. */
const PARENT: Record<string, string> = {
  "/lore/coverage": "/lore",
  "/lore/npcs": "/lore",
  "/lore/items": "/lore",
  "/lore/quests": "/lore",
  "/lore/zones": "/lore",
  "/lore/spells": "/lore",
  "/database/drops": "/database",
  "/database/npcs": "/database",
  "/database/quests": "/database",
  "/database/vendors": "/database",
  "/database/zones": "/database",
  "/database/instances": "/database",
  "/database/achievements": "/database",
  "/database/factions": "/database",
  "/database/titles": "/database",
  "/database/quest-chains": "/database",
  "/database/coverage": "/database",
  "/database/download": "/database",
  "/map/eastern-kingdoms": "/map",
  "/map/kalimdor": "/map",
  "/addons/popular": "/addons",
  "/addons/ecosystem": "/addons",
  "/addons/polestar": "/addons",
  "/addons/polestar/packs": "/addons/polestar",
  "/addons/polestar/wanted": "/addons/polestar",
};

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Home, each ancestor and the page. Null for Home itself and for pages with no trail. */
export function trailFor(pathname: string): Crumb[] | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const home: Crumb = { name: "Home", path: "/" };
  const cls = path.match(/^\/tools\/talents\/([a-z]+)$/);
  if (cls && (CLASSES as readonly string[]).includes(cls[1])) {
    return [home, { name: NAMES["/tools/talents"], path: "/tools/talents" }, { name: titleCase(cls[1]), path: path }];
  }
  if (!NAMES[path]) return null;
  const trail: Crumb[] = [];
  for (let p: string | undefined = path; p; p = PARENT[p]) trail.unshift({ name: NAMES[p], path: p });
  return [home, ...trail];
}

