import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import DatabaseLoading from "./database/loading";
import ProfessionsLoading from "./tools/professions/loading";
import MapLoading from "./map/loading";

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
