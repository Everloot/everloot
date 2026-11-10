import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/script", () => ({ default: () => null }));

import { KNOWLEDGE_KINDS, MCP_TOOL_NAMES } from "@everloot/protocol";
import { CATALOG_ID_BASE, CATALOG_KIND_SPAN, CATALOG_KINDS, kindRows } from "./kinds";
import McpOverview from "./page";

/** The text between tags in rendered markup, joined with no space at element boundaries, as a browser shows it. */
function pageText(html: string): string {
  let out = "";
  let inTag = false;
  for (const ch of html) {
    if (ch === "<") inTag = true;
    else if (ch === ">") inTag = false;
    else if (!inTag) out += ch;
  }
  return out.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

// The kb package is not a dependency of the site, so the page's copy of the catalog scheme is read back from its source.
const KB_CATALOG_INDEX = new URL("../../../../../kb/src/catalog-index.ts", import.meta.url);

/** A constant's array or number literal as the kb index source spells it, without digit separators. */
function kbConstant(name: string): string {
  const source = readFileSync(KB_CATALOG_INDEX, "utf8");
  const match = source.match(new RegExp(`(?:export )?const ${name} = ([^;]+);`));
  if (!match) throw new Error(`${name} is not in catalog-index.ts`);
  return match[1].replace(/ as const$/, "").replace(/(\d)_(?=\d)/g, "$1");
}

test("the kinds table has one row per knowledge kind, in the protocol's order", () => {
  const rows = kindRows();
  expect(rows.map((row) => row.kind)).toEqual([...KNOWLEDGE_KINDS]);
  expect(rows).toHaveLength(KNOWLEDGE_KINDS.length);
});

test("the catalog kinds and id scheme match the kb index", () => {
  expect(JSON.parse(kbConstant("CATALOG_KINDS"))).toEqual([...CATALOG_KINDS]);
  expect(Number(kbConstant("CATALOG_ID_BASE"))).toBe(CATALOG_ID_BASE);
  expect(Number(kbConstant("KIND_SPAN"))).toBe(CATALOG_KIND_SPAN);
  for (const row of kindRows()) expect(row.origin === "catalog", row.kind).toBe((CATALOG_KINDS as readonly string[]).includes(row.kind));
});

test("every dedicated tool in the table is a live MCP tool", () => {
  const live = new Set<string>(MCP_TOOL_NAMES);
  for (const row of kindRows()) for (const tool of row.tools) expect(live.has(tool), tool).toBe(true);
});

test("the page renders every kind and names the id scheme", () => {
  const html = renderToStaticMarkup(<McpOverview />);
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
  for (const kind of KNOWLEDGE_KINDS) expect(html).toContain(`<code class="font-mono">${kind}</code>`);
  expect(text).toContain("1,000,000,000");
  expect(text).toContain("1,010,000,072");
  expect(html).toContain('href="/docs/mcp/tools/item_page"');
});

test("the page keeps a space where an element ends a line of prose", () => {
  // Tags are dropped without a replacement space, so a space lost between a <code> and the next word shows up here.
  // The page's text as a browser reads it: element boundaries add no space, so a dropped JSX space shows up.
  const text = pageText(renderToStaticMarkup(<McpOverview />)).replace(/\s+/g, " ");
  expect(text).toContain("name Elwynn Forest and kind zone");
  expect(text).toContain("other gameplay facts. guild_board needs");
  expect(text).toContain("in their own SavedVariables/Everloot.lua");
});
