import { API_ROUTES, MCP_TOOL_NAMES, MCP_TOOLS, type ApiRoute, type McpToolName } from "@everloot/protocol";

/**
 * The docs' one table of contents: tabs, their sidebar groups and pages, in reading order. The tab bar,
 * the sidebar, breadcrumbs, previous/next links, the sitemap, llms.txt and site search all read it.
 * Endpoint and tool pages are generated from the protocol package, so a new route or tool appears here
 * the moment it is registered.
 */

export type DocsIcon =
  | "home" | "rocket" | "book" | "code" | "plug" | "chef" | "compass" | "shield" | "scale" | "help" | "box"
  | "upload" | "monitor" | "search" | "user" | "spark" | "list" | "database" | "file" | "link" | "terminal" | "chart";

export interface DocsPage {
  href: string;
  title: string;
  /** One line: what the page is. Shown under the title, on cards and in search. */
  lede: string;
  /** Shown before the title in the sidebar: an HTTP method for endpoint pages. */
  method?: ApiRoute["method"];
}

export interface DocsGroup {
  title: string;
  icon?: DocsIcon;
  pages: DocsPage[];
}

export interface DocsTab {
  id: "overview" | "guides" | "api" | "mcp" | "cookbook";
  label: string;
  href: string;
  icon: DocsIcon;
  groups: DocsGroup[];
}

/** `/api/corpus/public` → `corpus-public`, `/api/tooltip/{type}/{id}` → `tooltip`. */
export function endpointSlug(route: Pick<ApiRoute, "path">): string {
  return route.path.replace(/^\/api\//, "").split("/").filter((part) => !part.startsWith("{")).join("-");
}

export const endpointHref = (route: Pick<ApiRoute, "path">): string => `/docs/api/${endpointSlug(route)}`;
export const toolHref = (name: McpToolName): string => `/docs/mcp/tools/${name.replaceAll("_", "-")}`;

/** The tool a docs address names, or undefined. */
export function toolFromSlug(slug: string): McpToolName | undefined {
  return MCP_TOOL_NAMES.find((name) => name === slug.replaceAll("-", "_"));
}

/** The endpoint a docs address names, or undefined. */
export function routeFromSlug(slug: string): ApiRoute | undefined {
  return API_ROUTES.find((route) => endpointSlug(route) === slug);
}

/** Endpoints by what they are for, in the protocol's order inside each group. */
const ENDPOINT_GROUPS: { title: string; icon: DocsIcon; paths: string[] }[] = [
  { title: "Player data", icon: "database", paths: ["/api/corpus/public", "/api/rollups/drops", "/api/coverage/settled", "/api/market/prices"] },
  { title: "Game data", icon: "box", paths: ["/api/items", "/api/items/categories", "/api/edges", "/api/edges/client-layer"] },
  { title: "Tools and cards", icon: "spark", paths: ["/api/tools/{tool}", "/api/tooltip/{type}/{id}"] },
  { title: "Uploads and status", icon: "upload", paths: ["/api/intake", "/api/health"] },
];

/** MCP tools by what a player asks, in the protocol's order inside each group. */
const TOOL_GROUPS: { title: string; icon: DocsIcon; names: McpToolName[] }[] = [
  { title: "Search and lore", icon: "search", names: ["search_knowledge", "get_entity", "get_by_name", "answer_sources", "search", "fetch"] },
  { title: "Database", icon: "database", names: ["item_page", "npc_page", "object_page", "quest_page", "vendor_page", "entity_relations", "item_categories", "world_map_near"] },
  { title: "Planning", icon: "compass", names: ["talent_tree", "talent_plan", "profession_path", "recipe_thresholds"] },
  { title: "Market and characters", icon: "chart", names: ["market_value", "auction_history", "gold_ledger", "collection_gap", "completion_progress", "guild_board", "guild_search", "guild_rankings"] },
  { title: "World and project", icon: "home", names: ["coverage", "population", "recent_changes", "ecosystem_projects", "everloot_plan"] },
];

function endpointPages(paths: string[]): DocsPage[] {
  return paths.flatMap((path) => {
    const route = API_ROUTES.find((r) => r.path === path);
    return route ? [{ href: endpointHref(route), title: route.path.replace(/^\/api/, ""), lede: route.summary, method: route.method }] : [];
  });
}

function toolPages(names: McpToolName[]): DocsPage[] {
  return names.map((name) => ({ href: toolHref(name), title: name, lede: MCP_TOOLS[name].title }));
}

export const DOCS_TABS: DocsTab[] = [
  {
    id: "overview", label: "Overview", href: "/docs", icon: "home",
    groups: [
      {
        title: "Start here", icon: "rocket",
        pages: [
          { href: "/docs", title: "Overview", lede: "What Everloot is and where to start, whether you play or build." },
          { href: "/docs/quickstart", title: "Quickstart", lede: "Three ways in: the website, the addon, or the open data." },
          { href: "/docs/how-it-works", title: "How Everloot works", lede: "From a loot window in game to a fact on the site: uploads, the 3-install rule, game files and spoilers." },
        ],
      },
      {
        title: "Build on Everloot", icon: "code",
        pages: [
          { href: "/docs/tooltips", title: "Embeddable tooltips", lede: "One script tag, and your links to Everloot pages show a game-style card on hover." },
          { href: "/docs/licence", title: "Licence and credit", lede: "What you may do with Everloot's data and code, and the credit line to use." },
        ],
      },
      { title: "Help", icon: "help", pages: [{ href: "/docs/faq", title: "FAQ", lede: "Short answers to the questions players and developers ask most." }] },
    ],
  },
  {
    id: "guides", label: "Guides", href: "/docs/guides/addon", icon: "book",
    groups: [
      {
        title: "Get set up", icon: "rocket",
        pages: [
          { href: "/docs/guides/addon", title: "Install the addon", lede: "Get the Everloot addon into WoW: Forever and check it is running." },
          { href: "/docs/guides/desktop", title: "The Desktop App", lede: "The optional app that sends your addon data and brings prices back to the game." },
          { href: "/docs/guides/upload", title: "Upload your data", lede: "Share what you saw in game, in the browser or through the Desktop App." },
          { href: "/docs/guides/troubleshooting", title: "Troubleshooting", lede: "The addon will not load, a part is off, an upload is refused, or the API answers 429." },
        ],
      },
      {
        title: "Use the site", icon: "compass",
        pages: [
          { href: "/docs/guides/find", title: "Find things on the site", lede: "Search, the database, zone pages, the world map and the tools." },
          { href: "/docs/guides/account", title: "Your account", lede: "Sign in, and manage your API keys." },
          { href: "/docs/guides/privacy", title: "Privacy and your data", lede: "What an upload carries, what is published, and how to take it back." },
        ],
      },
    ],
  },
  {
    id: "api", label: "API Reference", href: "/docs/api", icon: "code",
    groups: [
      {
        title: "Get started", icon: "rocket",
        pages: [
          { href: "/docs/api", title: "API overview", lede: "Base URL, keys, limits, errors, caching and the OpenAPI document." },
          { href: "/docs/api/keys", title: "Limits and keys", lede: "How much you can read without a key, and how to get a free one." },
        ],
      },
      ...ENDPOINT_GROUPS.map((g) => ({ title: g.title, icon: g.icon, pages: endpointPages(g.paths) })),
      {
        title: "Reference", icon: "file",
        pages: [
          { href: "/docs/api/schemas", title: "Schemas and the protocol", lede: "Every response shape and record kind, and the protocol version." },
          { href: "/docs/api/data-files", title: "Data files", lede: "Bulk downloads of the open data, and what they hold." },
        ],
      },
    ],
  },
  {
    id: "mcp", label: "MCP", href: "/docs/mcp", icon: "plug",
    groups: [
      {
        title: "Get started", icon: "rocket",
        pages: [
          { href: "/docs/mcp", title: "MCP overview", lede: "Give an AI assistant Everloot's data, with the source on every answer." },
          { href: "/docs/mcp/clients", title: "Connect a client", lede: "Claude, ChatGPT, Grok, Claude Code and any client that speaks streamable HTTP." },
          { href: "/docs/mcp/resources", title: "Resources and prompts", lede: "The documents and ready-made prompts the server offers beside its tools." },
        ],
      },
      ...TOOL_GROUPS.map((g) => ({ title: g.title, icon: g.icon, pages: toolPages(g.names) })),
    ],
  },
  {
    id: "cookbook", label: "Cookbook", href: "/docs/cookbook", icon: "chef",
    groups: [
      { title: "Cookbook", icon: "chef", pages: [{ href: "/docs/cookbook", title: "All recipes", lede: "Short, tested walkthroughs for common jobs." }] },
      {
        title: "Recipes", icon: "terminal",
        pages: [
          { href: "/docs/cookbook/tooltips-on-your-site", title: "Tooltips on your site", lede: "Add Everloot hover cards to a blog, guild site or forum theme." },
          { href: "/docs/cookbook/ask-claude", title: "Ask Claude about WoW: Forever", lede: "Connect Everloot to Claude and ask questions with sources." },
          { href: "/docs/cookbook/prices-in-a-script", title: "Market prices in a script", lede: "Read Forever market values from JavaScript or Python." },
          { href: "/docs/cookbook/drop-rates-spreadsheet", title: "Drop rates to a spreadsheet", lede: "Page through corroborated drop rates and save them as CSV." },
          { href: "/docs/cookbook/tools-over-http", title: "MCP tools over plain HTTP", lede: "Call any MCP tool with a GET request, no MCP client needed." },
        ],
      },
    ],
  },
];

/** Every docs page in reading order, each once. */
export function allDocsPages(): (DocsPage & { tab: DocsTab; group: DocsGroup })[] {
  const seen = new Set<string>();
  return DOCS_TABS.flatMap((tab) => tab.groups.flatMap((group) => group.pages.flatMap((page) => {
    if (seen.has(page.href)) return [];
    seen.add(page.href);
    return [{ ...page, tab, group }];
  })));
}

/** The page at an address, with its tab and group, or undefined. */
export function docsPage(href: string) {
  return allDocsPages().find((page) => page.href === href);
}

/** The tab an address belongs to: the tab whose pages include it, else the overview. */
export function tabFor(pathname: string): DocsTab {
  return docsPage(pathname)?.tab ?? DOCS_TABS[0]!;
}

/** The pages before and after one, in reading order across tabs. */
export function neighbours(href: string): { prev?: DocsPage; next?: DocsPage } {
  const pages = allDocsPages();
  const i = pages.findIndex((page) => page.href === href);
  if (i < 0) return {};
  return { prev: pages[i - 1], next: pages[i + 1] };
}

/** Where an anchor of the old /connect page lives now (/connect redirects to /docs, keeping the #anchor). */
const LEGACY_SECTIONS: Record<string, string> = {
  mcp: "/docs/mcp", tools: "/docs/mcp", corpus: "/docs/api/corpus-public", tooltips: "/docs/tooltips", api: "/docs/api",
  schemas: "/docs/api/schemas", keys: "/docs/api/keys", files: "/docs/api/data-files", licence: "/docs/licence",
};

export function legacyAnchorTarget(hash: string): string | undefined {
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  if (LEGACY_SECTIONS[id]) return LEGACY_SECTIONS[id];
  const tool = id.startsWith("tool-") ? MCP_TOOL_NAMES.find((name) => name === id.slice(5)) : undefined;
  if (tool) return toolHref(tool);
  const route = id.startsWith("api-") ? API_ROUTES.find((r) => `api-${r.path.replace(/^\/api\//, "").replace(/\//g, "-")}` === id) : undefined;
  return route ? endpointHref(route) : undefined;
}

/** Every old /connect anchor and its page now, for the redirect on /docs. */
export function legacyAnchors(): Record<string, string> {
  const ids = [
    ...Object.keys(LEGACY_SECTIONS),
    ...MCP_TOOL_NAMES.map((name) => `tool-${name}`),
    ...API_ROUTES.map((r) => `api-${r.path.replace(/^\/api\//, "").replace(/\//g, "-")}`),
  ];
  return Object.fromEntries(ids.map((id) => [id, legacyAnchorTarget(id)!]));
}
