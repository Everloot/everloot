// @vitest-environment jsdom
import { existsSync } from "node:fs";
import { join } from "node:path";
import { API_ROUTES, MCP_TOOL_NAMES, MCP_TOOLS, SITE } from "@everloot/protocol";
import { z } from "zod";
import { expect, test } from "vitest";
import { exampleUrl, requestSamples, sample, TOOL_ARGS, toolSamples } from "./examples";
import { articleMarkdown } from "./markdown";
import { allDocsPages, DOCS_TABS, endpointHref, endpointSlug, legacyAnchors, neighbours, tabFor, toolFromSlug, toolHref } from "./nav";
import { liveToolNames } from "@/lib/guild-switch";

const app = join(__dirname, "../../app");

test("every public endpoint and every MCP tool has exactly one docs page in the sidebar", () => {
  const hrefs = DOCS_TABS.flatMap((tab) => tab.groups.flatMap((group) => group.pages.map((page) => page.href)));
  for (const route of API_ROUTES) expect(hrefs.filter((h) => h === endpointHref(route)), route.path).toHaveLength(1);
  for (const name of liveToolNames()) expect(hrefs.filter((h) => h === toolHref(name)), name).toHaveLength(1);
  expect(new Set(API_ROUTES.map(endpointSlug)).size).toBe(API_ROUTES.length);
});

test("with EVERLOOT_GUILDS off the guild ladder's two tools have no docs page and their addresses name no tool", () => {
  const hrefs = DOCS_TABS.flatMap((tab) => tab.groups.flatMap((group) => group.pages.map((page) => page.href)));
  for (const name of ["guild_search", "guild_rankings"] as const) {
    expect(hrefs).not.toContain(toolHref(name));
    expect(toolFromSlug(name.replaceAll("_", "-"))).toBeUndefined();
    expect(legacyAnchors()).not.toHaveProperty(`tool-${name}`);
  }
  expect(toolFromSlug("guild-board")).toBe("guild_board");
});

test("every page in the table of contents has a page file, and appears once", () => {
  const pages = allDocsPages();
  for (const { href } of pages) {
    const generated = /^\/docs\/api\/[a-z-]+$/.test(href) && API_ROUTES.some((r) => endpointHref(r) === href)
      ? "docs/api/[endpoint]/page.tsx"
      : href.startsWith("/docs/mcp/tools/") ? "docs/mcp/tools/[tool]/page.tsx" : null;
    expect(existsSync(join(app, generated ?? `${href.slice(1)}/page.tsx`)), href).toBe(true);
  }
  expect(new Set(pages.map((p) => p.href)).size).toBe(pages.length);
  for (const page of pages) expect(page.lede.length, page.href).toBeGreaterThan(3);
});

test("tabs, previous and next follow the reading order", () => {
  expect(tabFor("/docs/api/corpus-public").id).toBe("api");
  expect(tabFor("/docs/mcp/tools/get-by-name").id).toBe("mcp");
  expect(tabFor("/docs/nowhere").id).toBe("overview");
  expect(neighbours("/docs")).toMatchObject({ prev: undefined, next: { href: "/docs/quickstart" } });
  const last = allDocsPages().at(-1)!;
  expect(neighbours(last.href).next).toBeUndefined();
});

test("example values follow the schema: examples, enums, then placeholders of the right type", () => {
  expect(sample({ type: "string", examples: ["loot,vendor"] })).toBe("loot,vendor");
  expect(sample({ type: "string", enum: ["item", "npc"] })).toBe("item");
  expect(sample({ type: "object", properties: { n: { type: "integer", minimum: 1 }, s: { type: ["string", "null"] }, a: { type: "array", items: { type: "boolean" } } } }))
    .toEqual({ n: 1, s: "string", a: [true] });
  expect(sample({ anyOf: [{ type: "null" }, { type: "number" }] })).toBe(0);
});

test("request samples call the live site with the path filled in", () => {
  const tools = API_ROUTES.find((r) => r.path === "/api/tools/{tool}")!;
  expect(exampleUrl(tools)).toBe(`${SITE}/api/tools/get_by_name?name=Hogger`);
  expect(exampleUrl(API_ROUTES.find((r) => r.path === "/api/tooltip/{type}/{id}")!)).toBe(`${SITE}/api/tooltip/item/19019`);
  const drops = API_ROUTES.find((r) => r.path === "/api/rollups/drops")!;
  expect(requestSamples(drops).map((t) => t.label)).toEqual(["cURL", "JavaScript", "Python"]);
  expect(requestSamples(drops)[0]!.code).toBe(`curl "${SITE}/api/rollups/drops?limit=10"`);
  for (const route of API_ROUTES) expect(exampleUrl(route), route.path).not.toMatch(/[{}]/);
});

test("every tool's MCP sample is a valid JSON-RPC call naming the tool", () => {
  for (const name of MCP_TOOL_NAMES) {
    const [rpc, get] = toolSamples(name);
    const body = rpc!.code.match(/--data '(.*)'$/s)![1]!.replaceAll("'\\''", "'");
    expect(JSON.parse(body), name).toMatchObject({ jsonrpc: "2.0", method: "tools/call", params: { name } });
    expect(get!.code).toContain(`/api/tools/${name}`);
  }
});

test("every tool's example arguments pass the tool's own input schema", () => {
  for (const name of MCP_TOOL_NAMES) {
    const parsed = z.object(MCP_TOOLS[name].inputSchema).safeParse(TOOL_ARGS[name]);
    expect(parsed.success, `${name}: ${parsed.error?.message}`).toBe(true);
  }
});

test("Copy page turns the article into Markdown and leaves the page furniture out", () => {
  document.body.innerHTML = `
    <article>
      <header><nav data-md-skip>crumbs</nav><h1>Quickstart</h1><button data-md-skip>Copy page</button><p>Three ways in.</p></header>
      <h2 id="api">The API<a data-md-skip href="#api">#</a></h2>
      <p>Call <code>/api/health</code> or read <a href="/docs/api">the reference</a>. <strong>No key</strong> needed.</p>
      <ul><li>One</li><li>Two <em>more</em></li></ul>
      <aside><div><p>A tip.</p></div></aside>
      <div><div data-md-skip>tabs</div><pre data-lang="bash" data-label="cURL">curl x</pre><pre data-lang="python" data-label="Python" hidden>print(1)</pre></div>
      <table><tr><th>Approach</th><th>Best for</th></tr><tr><td>API</td><td>Any language</td></tr></table>
    </article>`;
  expect(articleMarkdown(document.querySelector("article")!, "https://everloot.app")).toBe([
    "# Quickstart", "Three ways in.", "## The API",
    "Call `/api/health` or read [the reference](https://everloot.app/docs/api). **No key** needed.",
    "- One\n- Two *more*", "> A tip.",
    "cURL:", "```bash\ncurl x\n```", "Python:", "```python\nprint(1)\n```",
    "| Approach | Best for |\n| --- | --- |\n| API | Any language |",
  ].join("\n\n") + "\n");
});

test("every anchor of the old /connect page leads to a docs page", () => {
  const targets = legacyAnchors();
  const pages = new Set(allDocsPages().map((p) => p.href));
  expect(targets).toMatchObject({ keys: "/docs/api/keys", "tool-get_by_name": "/docs/mcp/tools/get-by-name", "api-tooltip-{type}-{id}": "/docs/api/tooltip", "api-corpus-public": "/docs/api/corpus-public" });
  for (const [id, href] of Object.entries(targets)) expect(pages.has(href), `${id} -> ${href}`).toBe(true);
});
