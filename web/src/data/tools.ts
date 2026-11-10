// Single source of truth for the tool catalog.
// Add a new tool here and it automatically appears in nav + landing page cards.

export type ToolStatus = "live" | "collecting" | "coming-soon";

export interface Tool {
  slug: string;
  group?: "Plan" | "Look up" | "Track"; // None: the tool sits in the top bar (Database), not the Tools menu.
  line: string;
  private?: boolean; // Device-only lists stay out of the sitemap and search.
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
    group: "Plan",
    line: "Plan a talent build for any class and share it with its game build attached.",
    title: "Talent Calculator",
    shortTitle: "Talent calculator",
    tagline: "Plan a build, share it with its game build attached.",
    description:
      "Plan WoW: Forever talents for any class: point rules, two talent sets, undo and reset, and a share link that names the game build. Trees and rules are unconfirmed, read from build 1.60.1.",
    status: "live",
    keywords: [
      "wow forever talent calculator",
      "wow forever talents",
      "wow forever builds",
      "talent tree planner",
    ],
  },
  {
    slug: "builds",
    group: "Plan",
    line: "Talent plans kept by name in this browser, with a backup to restore them. No account needed, and nothing is uploaded.",
    private: true,
    href: "/tools/builds",
    title: "Plans on this device",
    shortTitle: "Plans on this device",
    tagline: "Talent plans kept by name in this browser, with a backup to restore them. No account needed, and nothing is uploaded.",
    description: "Talent plans kept by name in this browser, with a backup to restore them. No account needed, and nothing is uploaded.",
    status: "live",
    keywords: [],
  },
  {
    slug: "alts",
    group: "Plan",
    line: "Your characters kept in this browser, with their realm, class, level, professions, notes and plans. Add them by hand or from your Everloot.lua. No account needed, and nothing is uploaded.",
    private: true,
    href: "/tools/alts",
    title: "Alts on this device",
    shortTitle: "Alts on this device",
    tagline: "Your characters kept in this browser, with their realm, class, level, professions, notes and plans. Add them by hand or from your Everloot.lua. No account needed, and nothing is uploaded.",
    description: "Your characters kept in this browser, with their realm, class, level, professions, notes and plans. Add them by hand or from your Everloot.lua. No account needed, and nothing is uploaded.",
    status: "live",
    keywords: [],
  },
  {
    slug: "raid",
    group: "Plan",
    line: "Fill a 10, 20 or 40 player raid and see which buffs and debuffs it covers.",
    title: "Raid Group Builder",
    shortTitle: "Raid builder",
    tagline: "Plan a raid and see which buffs it covers.",
    description:
      "Fill a 10, 20 or 40 player raid with classes and talent trees, and see which buffs and debuffs each group and the raid gets. Rules are stamped with a game build and marked unconfirmed. The plan lives in the link.",
    status: "live",
    keywords: ["wow forever raid composition", "raid builder", "raid buffs", "wow forever raid planner"],
  },
  {
    slug: "professions",
    group: "Plan",
    line: "Every profession's recipes from the game files, with skill-up paths and recipe ranges from what players uploaded.",
    title: "Forever Profession Hubs",
    shortTitle: "Professions",
    tagline: "Every recipe, plus player leveling paths.",
    description:
      "One page per Forever profession: every recipe in the game files with its reagents and skill ranks, and the skill-up paths and recipe ranges players upload.",
    status: "collecting",
    keywords: [
      "wow forever professions",
      "wow forever profession leveling",
      "forever profession perks",
    ],
  },
  {
    slug: "farming-routes",
    group: "Plan",
    line: "Gold and reputation farming areas, filled in from what players upload.",
    title: "Forever Farming",
    shortTitle: "Farming",
    tagline: "Gold and reputation areas from uploads.",
    description:
      "Gold and reputation farming areas from what players upload. Gathering is on the profession pages, and dungeons have their own list.",
    status: "collecting",
    keywords: [
      "wow forever farming",
      "wow forever gold farm",
      "wow forever routes",
    ],
  },
  {
    slug: "chat",
    group: "Look up",
    line: "Ask a question in plain words. Your own AI model looks it up in Everloot's data and names the sources.",
    href: "/chat",
    title: "Chat",
    shortTitle: "Chat",
    tagline: "Ask a question in plain words. Your own AI model looks it up in Everloot's data and names the sources.",
    description: "Ask a question in plain words. Your own AI model looks it up in Everloot's data and names the sources.",
    status: "live",
    keywords: [],
  },
  {
    slug: "legacy",
    group: "Look up",
    line: "WoW: Forever's Legacy perk trees as the game files hold them: ids, ranks, prerequisites and spend gates, unconfirmed.",
    href: "/tools/legacy",
    title: "Legacy perks",
    shortTitle: "Legacy perks",
    tagline: "WoW: Forever's Legacy perk trees as the game files hold them: ids, ranks, prerequisites and spend gates, unconfirmed.",
    description: "WoW: Forever's Legacy perk trees as the game files hold them: ids, ranks, prerequisites and spend gates, unconfirmed.",
    status: "live",
    keywords: [],
  },
  {
    slug: "auctions",
    group: "Look up",
    line: "Auction House prices by realm, from player scans. A price shows once 3 reporters agree, or from Everloot's own scans.",
    href: "/tools/auctions",
    title: "Auction House",
    shortTitle: "Auction House",
    tagline: "Auction House prices by realm, from player scans. A price shows once 3 reporters agree, or from Everloot's own scans.",
    description: "Auction House prices by realm, from player scans. A price shows once 3 reporters agree, or from Everloot's own scans.",
    status: "collecting",
    keywords: [],
  },
  {
    slug: "census",
    group: "Look up",
    line: "Races, classes and levels, counted from players who turned the census on.",
    href: "/census",
    title: "Census",
    shortTitle: "Census",
    tagline: "Races, classes and levels, counted from players who turned the census on.",
    description: "Races, classes and levels, counted from players who turned the census on.",
    status: "collecting",
    keywords: [],
  },
  {
    slug: "rankings",
    group: "Look up",
    line: "WoW: Forever week by week, from players who turned the census on.",
    href: "/rankings",
    title: "Rankings",
    shortTitle: "Rankings",
    tagline: "WoW: Forever week by week, from players who turned the census on.",
    description: "WoW: Forever week by week, from players who turned the census on.",
    status: "collecting",
    keywords: [],
  },
  {
    slug: "addons",
    group: "Look up",
    line: "Addons made for WoW: Forever, ranked by GitHub stars.",
    href: "/addons",
    title: "Addons",
    shortTitle: "Addons",
    tagline: "Addons made for WoW: Forever, ranked by GitHub stars.",
    description: "Addons made for WoW: Forever, ranked by GitHub stars.",
    status: "live",
    keywords: [],
  },
  {
    slug: "database",
    line: "Browse uploaded observations and agreed facts.",
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
    slug: "guild-tracker",
    group: "Track",
    line: "Roster, progression, loot and item level for a guild, from officer uploads.",
    href: "/tools/guild-board",
    title: "Guild board",
    shortTitle: "Guild board",
    tagline: "Roster, progression, loot and item level for a guild, from officer uploads.",
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
    slug: "completionist",
    group: "Track",
    line: "Owned and missing in a collection, and what a character has done in achievements, reputation, titles and quest chains.",
    href: "/tools/collections",
    title: "Collections",
    shortTitle: "Collections",
    tagline: "Owned and missing in a collection, and what a character has done in achievements, reputation, titles and quest chains.",
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
    slug: "gold-ledger",
    group: "Track",
    line: "Your gold, income and spending across characters, read from your own addon file in your browser.",
    href: "/tools/gold-ledger",
    title: "Gold ledger",
    shortTitle: "Gold ledger",
    tagline: "Your gold, income and spending across characters, read from your own addon file in your browser.",
    description: "Your gold, income and spending across characters, read from your own addon file in your browser.",
    status: "live",
    keywords: [],
  },
  {
    slug: "upload",
    group: "Track",
    line: "Upload what the Everloot addon recorded. You preview everything before it is sent.",
    href: "/upload",
    title: "Upload Addon Data",
    shortTitle: "Upload a save file",
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

/** The Tools menu, grouped the way players use them. The header and home page share these groups. */
export const TOOL_GROUPS = (["Plan", "Look up", "Track"] as const).map((title) => ({
  title,
  links: tools.filter((tool) => tool.group === title).map((tool) => ({ label: tool.shortTitle, href: toolHref(tool) })),
}));

/** One plain line per Tools menu link, for /tools and /about. */
export const TOOL_LINES: Record<string, string> = {
  ...Object.fromEntries(tools.map((tool) => [toolHref(tool), tool.line])),
  "/guilds": "Guilds by progression, from their members' uploads.",
};

/** The Tools menu with the guild switch applied: with EVERLOOT_GUILDS on, "Guild board" becomes "Guilds", the ladder hub. */
export function toolGroups(guilds: boolean): typeof TOOL_GROUPS {
  if (!guilds) return TOOL_GROUPS;
  return TOOL_GROUPS.map((g) => ({ ...g, links: g.links.map((l) => (l.href === "/tools/guild-board" ? { label: "Guilds", href: "/guilds" } : l)) }));
}
