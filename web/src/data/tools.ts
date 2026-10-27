// Single source of truth for the tool catalog.
// Add a new tool here and it automatically appears in nav + landing page cards.

export type ToolStatus = "live" | "collecting" | "coming-soon";

export interface Tool {
  slug: string;
  href?: string;
  title: string;
  shortTitle: string;
  tagline: string;
  description: string;
  status: ToolStatus;
  keywords: string[]; // for <meta>
}

export const tools: Tool[] = [
  {
    slug: "talents",
    title: "Talent Calculator",
    shortTitle: "Talents",
    tagline: "Plan a build, share it with its game build attached.",
    description:
      "Plan WoW: Forever talents for any class: point rules, two talent sets, undo and reset, and a share link that names the game build. Trees and rules are unconfirmed beta data.",
    status: "live",
    keywords: [
      "wow forever talent calculator",
      "wow forever talents",
      "wow forever builds",
      "talent tree planner",
    ],
  },
  {
    slug: "completionist",
    href: "/tools/collections",
    title: "Completionist Tracker",
    shortTitle: "Completionist",
    tagline: "Collections, achievements, reputation and quests from uploads.",
    description:
      "Owned versus missing in a collection, and per character what is done and closest to done in achievements, reputation, titles and quest chains. A list appears when 3 installs agree. Owned is one install's upload. Not a Battle.net profile.",
    status: "collecting",
    keywords: [
      "wow completionist",
      "mount tracker",
      "pet collection",
      "achievement tracker",
      "reputation tracker",
    ],
  },
  {
    slug: "guild-tracker",
    href: "/tools/guild-board",
    title: "Forever Guild Tracker",
    shortTitle: "Guilds",
    tagline: "Officer-published roster and progression.",
    description:
      "Raid progression, roster, loot, and item level for WoW: Forever guilds from authorized officer uploads. A figure is public when two uploads agree. A combined guild score is not available.",
    status: "collecting",
    keywords: [
      "wow forever guild tracker",
      "wow forever guild progression",
      "forever guild rankings",
      "guild progression",
    ],
  },
  {
    slug: "database",
    href: "/database",
    title: "Forever Database",
    shortTitle: "Database",
    tagline: "Browse uploaded observations and agreed facts.",
    description:
      "Loot-window observations, NPC sightings, quests and vendors from addon uploads. Install counts are not proof of independent players; observations are not kill-based drop probabilities.",
    status: "collecting",
    keywords: [
      "wow forever database",
      "wow forever drop rates",
      "wow forever items",
      "wow forever quests",
    ],
  },
  {
    slug: "professions",
    title: "Forever Profession Hubs",
    shortTitle: "Professions",
    tagline: "Leveling routes from player data.",
    description:
      "One hub per Forever profession: skill-up paths and materials lists drawn from in-game collection. Hubs open their numbers as reports arrive.",
    status: "collecting",
    keywords: [
      "wow forever professions",
      "wow forever profession leveling",
      "forever profession perks",
    ],
  },
  {
    slug: "farming-routes",
    title: "Forever Farming Routes",
    shortTitle: "Routes",
    tagline: "Planned routes from uploaded sightings.",
    description:
      "Zone routes and respawn timing are planned. Upload sightings now and they become the first spawn maps.",
    status: "coming-soon",
    keywords: [
      "wow forever farming",
      "wow forever gold farm",
      "wow forever routes",
    ],
  },
  {
    slug: "raid",
    title: "Raid Group Builder",
    shortTitle: "Raid Builder",
    tagline: "Plan a raid and see which buffs it covers.",
    description:
      "Fill a 10, 20 or 40 player raid with classes and talent trees, and see which buffs and debuffs each group and the raid gets. Rules are stamped with a game build and marked unconfirmed. The plan lives in the link.",
    status: "live",
    keywords: ["wow forever raid composition", "raid builder", "raid buffs", "wow forever raid planner"],
  },
  {
    slug: "upload",
    href: "/upload",
    title: "Upload Addon Data",
    shortTitle: "Upload",
    tagline: "Send addon records with explicit sharing choices.",
    description: "Upload Everloot addon files. Public observations require corroboration; named sharing requires a reviewed grant.",
    status: "live",
    keywords: ["everloot upload", "wow forever addon"],
  },
];

export const toolHref = (tool: Tool): string => tool.href ?? `/tools/${tool.slug}`;

export const getTool = (slug: string): Tool | undefined =>
  tools.find((t) => t.slug === slug);

export const liveTools = () => tools.filter((t) => t.status === "live");
export const upcomingTools = () => tools.filter((t) => t.status === "coming-soon");

/** The Tools menu, grouped the way players use them. Every tool above is in it (header.test.tsx). The header
 * menu and the home page list these groups. */
export const TOOL_GROUPS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Plan",
    links: [
      { label: "Talent calculator", href: "/tools/talents" },
      // Not in the catalogue above, which also feeds the sitemap and search: the page is a private list.
      { label: "Plans on this device", href: "/tools/builds" },
      { label: "Raid builder", href: "/tools/raid" },
      { label: "Professions", href: "/tools/professions" },
      { label: "Farming routes", href: "/tools/farming-routes" },
    ],
  },
  {
    title: "Look up",
    links: [
      { label: "Chat", href: "/chat" },
      { label: "Auction House", href: "/tools/auctions" },
      { label: "Census", href: "/census" },
      { label: "Rankings", href: "/rankings" },
      { label: "Addons", href: "/addons" },
    ],
  },
  {
    title: "Track",
    links: [
      { label: "Guild board", href: "/tools/guild-board" },
      { label: "Collections", href: "/tools/collections" },
      { label: "Gold ledger", href: "/tools/gold-ledger" },
      { label: "Upload a save file", href: "/upload" },
    ],
  },
];

/** One plain line per Tools menu link, for /tools and /about. Keyed by the menu's href (tools.test.ts). */
export const TOOL_LINES: Record<string, string> = {
  "/tools/talents": "Plan a talent build for any class and share it with its game build attached.",
  "/tools/builds": "Talent plans kept by name in this browser, with a backup to restore them. No account needed, and nothing is uploaded.",
  "/tools/raid": "Fill a 10, 20 or 40 player raid and see which buffs and debuffs it covers.",
  "/tools/professions": "Skill-up paths and recipe ranges for each profession, from recipes and prices players uploaded.",
  "/tools/farming-routes": "Farming areas by what you farm, filled in from what players upload.",
  "/chat": "Ask a question in plain words. Your own AI model looks it up in Everloot's data and names the sources.",
  "/tools/auctions": "Auction House prices by realm, from player scans. A price shows once 3 reporters agree.",
  "/census": "Races, classes and levels, counted from players who turned the census on.",
  "/rankings": "WoW: Forever week by week, from players who turned the census on.",
  "/addons": "Addons made for WoW: Forever, ranked by GitHub stars.",
  "/tools/guild-board": "Roster, progression, loot and item level for a guild, from officer uploads.",
  "/guilds": "Guilds by progression, from their members' uploads.",
  "/tools/collections": "Owned and missing in a collection, and what a character has done in achievements, reputation, titles and quest chains.",
  "/tools/gold-ledger": "Your gold, income and spending across characters, read from your own addon file in your browser.",
  "/upload": "Upload what the Everloot addon recorded. You preview everything before it is sent.",
};

/** The Tools menu with the guild switch applied: with EVERLOOT_GUILDS on, "Guild board" becomes "Guilds", the ladder hub. */
export function toolGroups(guilds: boolean): typeof TOOL_GROUPS {
  if (!guilds) return TOOL_GROUPS;
  return TOOL_GROUPS.map((g) => ({ ...g, links: g.links.map((l) => (l.href === "/tools/guild-board" ? { label: "Guilds", href: "/guilds" } : l)) }));
}
