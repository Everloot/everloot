import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import DatabaseLoading from "./database/(hub)/loading";
import ProfessionsLoading from "./tools/professions/(hub)/loading";
import MapLoading from "./map/(hub)/loading";

// The skeleton keeps the page's column so nothing shifts when the content arrives, and reads to a screen
// reader as one "Loading" status: no text a reader would take for the page itself.
describe.each([
  { name: "database", Loading: DatabaseLoading, wrapper: 'data-container="data"' },
  { name: "professions", Loading: ProfessionsLoading, wrapper: 'data-container="wide"' },
  { name: "map", Loading: MapLoading, wrapper: 'class="fixed inset-x-0 bottom-0 top-header' },
])("$name loading", ({ Loading, wrapper }) => {
  const html = renderToStaticMarkup(<Loading />);

  test("keeps the page's wrapper", () => {
    expect(html).toContain(wrapper);
    expect(html).toContain("bg-panel");
  });

  test("is one Loading status with no readable text", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading"');
    expect(html.replace(/<[^>]+>/g, "").trim()).toBe("");
    expect(html).not.toMatch(/animate-|opacity-|gradient/);
  });
});

test("the database skeleton draws the search field and its row of scope chips", () => {
  const html = renderToStaticMarkup(<DatabaseLoading />);
  expect(html).toContain("h-12 w-full rounded-control");
  expect(html.match(/h-10 w-\d+ rounded-\[6px\] bg-panel sm:h-8/g)).toHaveLength(5);
});

test("the map skeleton is the shell with the sidebar only: the footer hides and the body does not scroll", () => {
  const html = renderToStaticMarkup(<MapLoading />);
  expect(html).toMatch(/<div[^>]*data-map-shell/);
  expect(html).toContain("md:w-80");
  expect(html).not.toContain("w-12");
});

/**
 * A loading.tsx is a Suspense boundary for every route under its folder, and a page that calls notFound() after
 * the boundary has streamed its shell answers 200, which the edge cache would keep (lib/cf-edge-cache.ts). So a
 * skeleton may stand only in a route group that holds one page and no route below it.
 */
test("every loading.tsx under app sits alone with its page in a route group that has no child routes", () => {
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
  }
});
