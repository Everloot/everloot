import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import NotFound, { metadata } from "./not-found";
import { isDatabaseIdPath, lastSegment } from "./not-found-parts";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
// What the server sees for an address that matches no route: the prerendered 404's own address, not the one tried.
vi.mock("next/navigation", () => ({ usePathname: () => "/_not-found" }));

test("the not-found page has its heading and a way home", () => {
  const html = renderToStaticMarkup(<NotFound />);
  expect(html).toMatch(/<h1[^>]*>Nothing looted on this page\.<\/h1>/);
  expect(html).toContain('href="/"');
  expect(html).toContain('href="/database"');
});

test("the not-found page leads with a search box, empty on the server: the prefill is read in the browser (#975)", () => {
  const html = renderToStaticMarkup(<NotFound />);
  expect(html).toContain('role="search"');
  expect(html).toContain('action="/search"');
  expect(html).toContain('value=""');
  expect(html).not.toContain("_not-found");
  // The generic copy, not the database line: this address has no id to report.
  expect(html).not.toContain("three installs make it public");
  expect(html).not.toContain('href="/addon"');
});

test("the last segment of the address tried is the first search offered, decoded", () => {
  expect(lastSegment("/")).toBe("");
  expect(lastSegment("")).toBe("");
  expect(lastSegment("/this-page-does-not-exist")).toBe("this-page-does-not-exist");
  expect(lastSegment("/database/items/999999")).toBe("999999");
  expect(lastSegment("/wiki/Hogger%27s%20Den/")).toBe("Hogger's Den");
  // A segment that is not valid percent-encoding is offered as typed instead of throwing.
  expect(lastSegment("/100%")).toBe("100%");
});

test("only a database detail address with a numeric id gets the no-report line", () => {
  expect(isDatabaseIdPath("/database/items/999999")).toBe(true);
  expect(isDatabaseIdPath("/database/npcs/999999/")).toBe(true);
  expect(isDatabaseIdPath("/database/quest-chains/12")).toBe(true);
  expect(isDatabaseIdPath("/database")).toBe(false);
  expect(isDatabaseIdPath("/database/items")).toBe(false);
  expect(isDatabaseIdPath("/database/items/abc")).toBe(false);
  expect(isDatabaseIdPath("/database/instances/deadmines")).toBe(false);
  expect(isDatabaseIdPath("/tools/auctions/item/999999")).toBe(false);
  expect(isDatabaseIdPath("/_not-found")).toBe(false);
});

test("the not-found page writes no robots tag of its own: Next prints noindex on every answer over 400 (#815)", () => {
  expect(metadata.title).toBe("Page not found");
  // null, not undefined: undefined would let the layout's index,follow through to a 404.
  expect(metadata.robots).toBeNull();
});
