import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch }: { href: string | { pathname?: string }; children: ReactNode; prefetch?: boolean | null }) =>
    <a href={typeof href === "string" ? href : href.pathname} data-prefetch={String(prefetch)}>{children}</a>,
}));

import Link, { prefetchFor } from "./Link";

test.each(["/database", "/database/items", "/database/items/10", "/database?q=x", "/database#top", "/database/npcs?zone=12"])(
  "%s is never prefetched, even when a caller asks",
  (href) => {
    expect(prefetchFor(href, undefined)).toBe(false);
    expect(prefetchFor(href, true)).toBe(false);
    expect(prefetchFor({ pathname: href.split(/[?#]/)[0] }, null)).toBe(false);
  },
);

test.each(["/", "/tools/raid", "/databases", "/search?q=database", "https://example.com/database"])("%s keeps the caller's choice", (href) => {
  expect(prefetchFor(href, undefined)).toBeUndefined();
  expect(prefetchFor(href, true)).toBe(true);
  expect(prefetchFor(href, false)).toBe(false);
});

test("a /database link renders with prefetch off; other links keep Next's default", () => {
  expect(renderToStaticMarkup(<Link href="/database/items/10">Item</Link>)).toContain('data-prefetch="false"');
  expect(renderToStaticMarkup(<Link href="/database/items/10" prefetch>Item</Link>)).toContain('data-prefetch="false"');
  expect(renderToStaticMarkup(<Link href="/tools/raid">Raid</Link>)).toContain('data-prefetch="undefined"');
});

// Every link goes through ./Link, so a new link to /database cannot prefetch by accident. The profession tool pages are
// another lane's files and still import next/link; this list may only shrink.
const NOT_YET = new Set([
  "app/tools/professions/page.tsx",
  "app/tools/professions/picker.tsx",
  "app/tools/professions/recipe-shopping.tsx",
  "app/tools/professions/recipe-table.tsx",
  "app/tools/professions/shopping-list.tsx",
  "app/tools/professions/[profession]/gathering/page.tsx",
  "app/tools/professions/[profession]/page.tsx",
]);

test("no source file imports next/link except components/Link.tsx", () => {
  const src = fileURLToPath(new URL("..", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(tsx?|jsx?|mjs)$/.test(entry.name) && !/\.test\.[tj]sx?$/.test(entry.name)) {
        const file = relative(src, path).split(sep).join("/");
        if (file !== "components/Link.tsx" && !NOT_YET.has(file) && /["']next\/link["']/.test(readFileSync(path, "utf8"))) offenders.push(file);
      }
    }
  };
  walk(src);
  expect(offenders).toEqual([]);
});
