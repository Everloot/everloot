import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import DatabaseLoading from "./database/(hub)/loading";

// The skeleton keeps the page's column so nothing shifts when the content arrives, and reads to a screen
// reader as one "Loading" status: no text a reader would take for the page itself.
describe.each([
  { name: "database", Loading: DatabaseLoading, wrapper: 'data-container="data"' },
])("$name loading", ({ Loading, wrapper }) => {
  const html = renderToStaticMarkup(<Loading />);

  test("keeps the page's wrapper", () => {
    expect(html).toContain(wrapper);
    expect(html).toContain("bg-panel");
  });

  test("is one Loading status with no readable text", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading"');
    // No text node: nothing but whitespace sits between a closing ">" and the next "<".
    expect(html).not.toMatch(/>[^<]*\S[^<]*</);
    expect(html).not.toMatch(/animate-|opacity-|gradient/);
  });
});

test("the database skeleton draws the search field and its row of scope chips", () => {
  const html = renderToStaticMarkup(<DatabaseLoading />);
  expect(html).toContain("h-12 w-full rounded-control");
  expect(html.match(/h-10 w-\d+ rounded-\[6px\] bg-panel sm:h-8/g)).toHaveLength(5);
});

/**
 * A loading.tsx is a Suspense boundary for every route under its folder. Once the boundary has streamed its
 * shell the answer is a 200: a page below it that calls notFound() no longer answers 404, a page that redirects
 * (the map and profession hubs send their old query forms on) no longer answers 308 or 307, and the edge cache
 * would keep that 200 (lib/cf-edge-cache.ts). So a skeleton may stand only in a route group that holds one page
 * and no route below it, and that page may not redirect or 404 at all.
 */
test("every loading.tsx under app sits alone in a route group with one page that never redirects or 404s", () => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "loading.tsx") found.push(dir);
    }
  };
  walk(__dirname);
  expect(found.length).toBeGreaterThan(0);
  for (const dir of found) {
    expect(basename(dir), `${dir} is not a route group`).toMatch(/^\(.+\)$/);
    expect(existsSync(join(dir, "page.tsx")), `${dir} has no page.tsx`).toBe(true);
    const children = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
    expect(children, `${dir} has routes below it`).toEqual([]);
    // The scan reads the page file alone: a redirect or notFound reached through a helper in another module would
    // pass it. Nothing under src/lib or kb imports next/navigation today, so the gap is known, not covered.
    const page = readFileSync(join(dir, "page.tsx"), "utf8");
    expect(page, `${dir}/page.tsx imports next/navigation: a redirect or notFound there would answer 200`).not.toContain("next/navigation");
    expect(page, `${dir}/page.tsx redirects or 404s`).not.toMatch(/\b(redirect|permanentRedirect|notFound)\s*\(/);
  }
});
