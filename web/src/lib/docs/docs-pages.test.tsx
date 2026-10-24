/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, expect, test, vi } from "vitest";

// The promises the old /connect page made, now checked across the docs that replaced it: every docs page,
// the generated endpoint and tool pages included, rendered and read as one text.

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("@/components/AccountControls", () => ({ default: () => null }));
vi.mock("@/components/CookieConsent", () => ({ CookiePreferencesButton: () => null }));
vi.mock("@/components/ApiKeys", () => ({ default: () => <div data-testid="api-keys" /> }));

import { CONNECT_EXAMPLES, CORPUS_URL, MCP_PROMPTS, MCP_RESOURCE_TEMPLATES, MCP_RESOURCES, MCP_TOOLS, MCP_URL, REQUESTS_PER_HOUR } from "./connect-data";
import { API_ROUTES, MCP_PROMPT_NAMES, MCP_RESOURCE_TEMPLATE_URIS, MCP_RESOURCE_URIS, MCP_TOOL_NAMES, PROTOCOL_VERSION, PUBLIC_RECORD_KINDS } from "@everloot/protocol";
import { liveToolNames } from "@/lib/guild-switch";
import { createIntakeQuota } from "@/lib/intake-quota";
import { ANON_PAGE, ANON_PER_HOUR, attribution, KEY_PAGE, KEY_PER_HOUR } from "@/lib/data-guard";
import sitemap from "@/app/sitemap";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { allDocsPages, endpointSlug } from "./nav";
import { MY_BUILDS_REFUSAL } from "@/lib/saved-builds";

type PageModule = { default: (props: { params: Promise<Record<string, string>> }) => unknown };
const modules = import.meta.glob<PageModule>("../../app/docs/**/page.tsx", { eager: true });

/** Every docs page as HTML, one after another. */
async function renderDocs(): Promise<string> {
  const out: string[] = [];
  for (const [path, mod] of Object.entries(modules)) {
    const calls = path.includes("[endpoint]") ? API_ROUTES.map((r) => ({ endpoint: endpointSlug(r) }))
      : path.includes("[tool]") ? liveToolNames().map((n) => ({ tool: n.replaceAll("_", "-") }))
      : [{}];
    for (const params of calls) out.push(renderToStaticMarkup((await mod.default({ params: Promise.resolve(params) })) as ReactNode));
  }
  return out.join("\n");
}
// &amp; last, so "&amp;lt;" stays "&lt;" instead of becoming "<".
const decode = (html: string) => html.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
/** The text of some HTML: tags removed until none are left. */
function stripTags(html: string): string {
  let out = html;
  for (let prev = ""; prev !== out;) { prev = out; out = out.replace(/<[^>]*>/g, ""); }
  return out;
}

let page = "";
let decoded = "";
/** The words alone: code panels split code into highlighted spans. */
let text = "";
beforeAll(async () => {
  page = await renderDocs();
  decoded = decode(page);
  text = decode(stripTags(page));
});

test("the tool list is exactly the tools the protocol declares, in order", () => {
  expect(MCP_TOOL_NAMES.length).toBeGreaterThan(0);
  expect(MCP_TOOLS.map((tool) => tool.name)).toEqual(MCP_TOOL_NAMES);
  // The page lists the tools the server lists: the guild ladder's two only while EVERLOOT_GUILDS is on.
  for (const name of liveToolNames()) expect(page).toContain(`>${name}</code>`);
  expect(page).not.toContain(">guild_search</code>");
});

test("the resource and prompt lists are exactly what the protocol declares, in order, with their schema files", () => {
  expect(MCP_RESOURCES.map((resource) => resource.uri)).toEqual(MCP_RESOURCE_URIS);
  for (const resource of MCP_RESOURCES) expect(page).toContain(`>${resource.uri}</code>`);
  expect(page).toContain("/schema/mcp/resources.json");
  expect(MCP_RESOURCE_TEMPLATES.map((t) => t.uriTemplate)).toEqual(MCP_RESOURCE_TEMPLATE_URIS);
  for (const t of MCP_RESOURCE_TEMPLATES) expect(decoded).toContain(`>${t.uriTemplate}</code>`);
  expect(MCP_PROMPTS.map((prompt) => prompt.name)).toEqual(MCP_PROMPT_NAMES);
  for (const prompt of MCP_PROMPTS) expect(page).toContain(`>${prompt.name}</code>`);
  expect(page).toContain("/schema/mcp/prompts.json");
});

test("the reference lists every tool with its arguments, every endpoint, the OpenAPI file and the schema index", () => {
  for (const name of liveToolNames()) expect(page).toContain(`/schema/mcp/${name}.json`);
  expect(page).not.toContain("/schema/mcp/guild_rankings.json");
  for (const text of ["connected", "dataAsOf", "an absent page is not a measured zero"]) expect(decoded).toContain(text);
  for (const text of ["query", "itemId", "ownerInstallId", "required", "player data"]) expect(decoded).toContain(text);
  for (const route of API_ROUTES) expect(decoded).toContain(route.path);
  for (const text of ["/api/openapi.json", "/schema/index.json", "/schema/upload.json", `@everloot/protocol`, PROTOCOL_VERSION, "gameData"]) {
    expect(decoded).toContain(text);
  }
});

test("tells users how to add the server in Claude, Grok and any other assistant that takes a URL", () => {
  for (const text of ["https://claude.ai/customize/connectors", "including Free", "https://docs.x.ai/developers/tools/remote-mcp", "streamable HTTP MCP server by URL", "app.everloot/knowledge", ".cursor/mcp.json", ".vscode/mcp.json"]) {
    expect(decoded).toContain(text);
  }
});

test("the corpus kinds on the page are the kinds the API accepts, without addon lists", () => {
  expect(PUBLIC_RECORD_KINDS).not.toContain("addon_seen");
  for (const kind of PUBLIC_RECORD_KINDS) expect(page).toContain(kind);
  // The schemas page lists every kind an upload may carry; addon lists are marked as never public.
  expect(decoded).toMatch(/addon_seen<\/code><\/a><\/td><td[^>]*>No</);
});

test("the stated limit is the limit the public MCP quota enforces", async () => {
  const quota = createIntakeQuota({ env: {} });
  const req = new Request("http://localhost/mcp/public");
  for (let i = 0; i < REQUESTS_PER_HOUR; i++) expect((await quota.mcp(req)).allowed).toBe(true);
  const refused = await quota.mcp(req);
  expect(refused.allowed).toBe(false);
  expect(refused.retryAfter).toBeGreaterThan(0);
  expect(page).toContain(`${REQUESTS_PER_HOUR} requests per hour`);
});

test("without EVERLOOT_MCP_QUOTA_SCOPE the MCP shares the intake bucket, as the page says", () => {
  // Production runs without the scope variable. If that changes, this fails and the page needs a new sentence.
  const quota = readFileSync(new URL("../intake-quota.ts", import.meta.url), "utf8");
  expect(quota).toMatch(/if \(env\.EVERLOOT_MCP_QUOTA_SCOPE === "mcp"\) return consume\("mcp", clientIp\(req\)\);\s*return consume\("request", `mcp:\$\{clientIp\(req\)\}`\);/);
  expect(quota).toContain('[["global", 10000], [`ip:${value}`, ' + REQUESTS_PER_HOUR + "]]");
  expect(decoded).toContain("share one hourly cap");
  expect(decoded).toContain("GET and OPTIONS are not counted");
});

test("the examples point at the production URLs and parse", () => {
  expect(MCP_URL).toBe("https://everloot.app/mcp/public");
  expect(CORPUS_URL).toBe("https://everloot.app/api/corpus/public");
  expect(CONNECT_EXAMPLES.claudeCode).toBe(`claude mcp add --transport http everloot ${MCP_URL}`);
  expect(JSON.parse(CONNECT_EXAMPLES.remoteConfig).mcpServers.everloot).toEqual({ type: "http", url: MCP_URL });
  expect(JSON.parse(CONNECT_EXAMPLES.stdioConfig).mcpServers.everloot.env.EVERLOOT_PUBLIC_CORPUS_URL).toBe(CORPUS_URL);
  const body = CONNECT_EXAMPLES.mcpCurl.match(/-d '(.*)'$/)?.[1] ?? "";
  expect(JSON.parse(body)).toMatchObject({ method: "tools/call", params: { name: "get_by_name" } });
  expect(CONNECT_EXAMPLES.mcpCurl).toContain("application/json, text/event-stream");
  expect(CONNECT_EXAMPLES.toolsCurl).toContain("https://everloot.app/api/tools/get_by_name?name=Thrall");
  expect(decoded).toContain(`${"https://everloot.app"}/api/tools/get_by_name?name=Thrall`);
  expect(Object.keys(JSON.parse(CONNECT_EXAMPLES.corpusShape))).toEqual(["ok", "uploads", "records", "dataAsOf", "kinds", "offset", "limit", "total", "next", "attribution"]);
  expect(JSON.parse(CONNECT_EXAMPLES.corpusShape).attribution).toEqual(attribution("/database"));
  expect(text).toContain(CONNECT_EXAMPLES.corpusCurl);
  expect(text).toMatch(/pass offset and limit, and follow next/);
});

test("states the open position, the licences and the credit line, and promises nothing unbuilt", () => {
  for (const text of ["no sign-in wall", "CC BY-SA 4.0", "AGPL-3.0-only", CONNECT_EXAMPLES.credit, "There is no bulk download yet", "WoWDBDefs", "They do not carry Blizzard's icons, tooltip text or art in bulk"]) {
    expect(decoded).toContain(text);
  }
  expect(decoded).not.toMatch(/premium|paid plan|upgrade|subscribe|coming soon/i);
});

test("links the repository's policy files", () => {
  for (const file of ["DATA_POLICY.md", "THIRD_PARTY.md", "TRADEMARKS.md", "kb/README.md"]) expect(page).toContain(file);
});

test("every docs page is in the sitemap, the docs are in the header and the footer, and /connect redirects to them", async () => {
  const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname);
  for (const { href } of allDocsPages()) expect(paths, href).toContain(href);
  expect(paths).not.toContain("/connect");
  expect(renderToStaticMarkup(<Header />)).toContain('href="/docs"');
  expect(renderToStaticMarkup(<Footer />)).toContain('href="/docs"');
  const config = readFileSync(new URL("../../../next.config.js", import.meta.url), "utf8");
  expect(config).toContain('{ source: "/connect", destination: "/docs", permanent: true }');
});

test("with the data guard off the page promises no limit and no key it does not enforce", () => {
  expect(decoded).toContain("Keys are not switched on yet");
  expect(decoded).toContain("This endpoint has no limit of its own today");
  expect(page).not.toContain('data-testid="api-keys"');
  expect(decoded).not.toContain(`${ANON_PER_HOUR} requests per hour for each IP address, ${ANON_PAGE} records a page`);
});

test("with the data guard on it states the limits it enforces, how to send a key, and shows the key list", async () => {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  try {
    const on = decode(await renderDocs());
    for (const text of [
      `${REQUESTS_PER_HOUR} requests per hour for each IP address`,
      `${ANON_PER_HOUR} requests per hour for each IP address, ${ANON_PAGE} records a page`,
      `${KEY_PER_HOUR.toLocaleString("en-US")} requests per hour for your account, across all its keys and every endpoint`,
      "make up to 10 a day",
      "daily request counts for 90 days",
      "deleted 30 days after it was revoked",
      `${KEY_PAGE.toLocaleString("en-US")} records a page`,
      "Authorization: Bearer <key>",
      "A key belongs to your account",
      "/api/tools/{tool}",
      "shared by all five",
      "one hourly cap of 10,000 requests",
      "Search engines and AI assistants are welcome",
      'data-testid="api-keys"',
      "no sign-in wall",
    ]) expect(on).toContain(text);
    expect(on).not.toContain("This endpoint has no limit of its own today");
    expect(on).not.toMatch(/premium|paid|upgrade|subscribe|coming soon/i);
  } finally { vi.unstubAllEnvs(); }
});

test("my_builds is documented only while saved builds are on: the key permission, what it returns, the refusal", async () => {
  expect(decoded).not.toContain("my_builds");
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  try {
    const on = decode(stripTags(await renderDocs()));
    for (const text of ["One more tool, my_builds", "It is not in the public list", "Read my saved builds", "With a build's slug",
      "short link while sharing is on", `"${MY_BUILDS_REFUSAL}"`, "the same key adds a my_builds tool"]) expect(on).toContain(text);
  } finally { vi.unstubAllEnvs(); }
});

test("the docs state the addon's defaults and the publication rules the code enforces", () => {
  // Census and auction capture are on in a new install (addon/core.lua defaults); no page may call them opt-in.
  expect(text).toContain("The census is on in a new install and says so once in chat.");
  expect(text).not.toMatch(/census[^.]*off until you turn/i);
  expect(text).not.toContain("It is off until you do this");
  expect(text).toContain("Turns off auction capture, which is on in a new install.");
  // Character names are published in three places; the old promise that they never are is gone.
  expect(text).not.toContain("Character names and your install id are not published");
  expect(text).toContain("on guild boards a guild's officers publish, and on player pages");
  // Guild boards follow the 2-officer rule in kb/src/guild-board.ts, not the generic 3-install note.
  expect(text).toContain("a figure is public when uploads from 2 of the guild's officers agree");
  // The Desktop App sends census rows when allowed (companion/src/uploader.ts).
  expect(text).toContain("and census rows if you allowed the census on its setup screen");
  // Grants are issued by hand; the upload guide says how to ask for one.
  expect(text).toContain("Get a sharing grant");
  expect(text).toContain("Grants are not made on the site.");
  // The two version numbers are named apart, and nothing claims an npm install.
  expect(text).toContain("two version numbers");
  expect(text).not.toMatch(/npm install @everloot\/protocol/);
});

test("the player pages section links the hide form only while player pages are on", async () => {
  expect(text).toContain("Player pages are switched off on the site for now.");
  expect(page).not.toContain('href="/players/opt-out"');
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  try {
    const on = await renderDocs();
    expect(on).toContain('href="/players/opt-out"');
    expect(decode(stripTags(on))).toContain("anyone can hide a character, without an account");
  } finally { vi.unstubAllEnvs(); }
});

test("field lists hide empty descriptions and generator noise", () => {
  expect(text).not.toContain("No description.");
  expect(text).not.toContain("or null, or null");
  expect(text).not.toContain("9007199254740991");
});

test("the credit rule names the attribution field and headers every answer carries", () => {
  for (const text of ["attribution", "X-Everloot-Licence", "X-Everloot-Credit", "Link"]) expect(decoded).toContain(text);
});

test("the API overview says what the feed holds now that a Recorder file can be uploaded, and that a record is not a fact", () => {
  for (const kind of ["npc_sighting", "quest", "loot", "instance_entrance", "encounter", "object_sighting"]) {
    expect(PUBLIC_RECORD_KINDS, kind).toContain(kind);
    expect(text, kind).toContain(kind);
  }
  for (const words of [
    "What the feed holds",
    "A record is one install's word",
    "3 different characters uploading from 3 different addresses",
    "An empty answer is not a measured zero",
    "without installing anything else",
  ]) expect(text).toContain(words);
});

test("the upload guide has a Recorder section, and no docs page says the Desktop App never sends player rows", () => {
  for (const words of ["Upload a Polestar Recorder file", "You can send a recording without installing Everloot's addon", "It is a report, not a fact", "Character names, realms, session names and notes typed in game stay on your computer"]) {
    expect(text).toContain(words);
  }
  expect(text).toContain("Send the player pages with the uploads");
  expect(text).not.toContain("The Desktop App never sends them");
  expect(text).not.toMatch(/named data \(guild, gear, gold, collection\), player\s+rows/);
});

test("the docs name no internal path and no AI as an author", () => {
  // The words are joined so this file does not trip scripts/check_internal_paths.py itself.
  const internal = new RegExp(["R21", "Brain"].join("-") + "|" + ["_sec", "rets"].join("") + "|" + ["Us", "ers[\\/]+car", "li"].join(""), "i");
  expect(decoded).not.toMatch(internal);
  expect(decoded).not.toMatch(/co-authored|generated (by|with)|written by (an )?(ai|claude|gpt)/i);
});

test("the tool catalogue documents coverage filters, field grain and withheld values", () => {
  expect(page).toContain("/docs/mcp/tools/coverage");
  for (const words of ["Database coverage", "UiMap zone id", "settled / expected", "confirmed / expected", "unconfirmed values", "text only"]) {
    expect(text).toContain(words);
  }
});

test("every docs page's BreadcrumbList starts at Home", () => {
  const lists = [...page.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]) as { "@type": string; itemListElement?: { name: string }[] })
    .filter((data) => data["@type"] === "BreadcrumbList");
  expect(lists.length).toBeGreaterThan(10);
  for (const list of lists) expect(list.itemListElement?.slice(0, 2).map((c) => c.name)).toEqual(["Home", "Docs"]);
});
