import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import DatabaseNotFound, { metadata } from "./not-found";
import { metadata as siteMetadata } from "../not-found";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
const mocks = vi.hoisted(() => ({ path: "/database/items/999999" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.path }));

test("an unknown item or NPC id gets a body: the heading, the 3-install line, the addon link and a search for the id (#975)", () => {
  for (const path of ["/database/items/999999", "/database/npcs/999999"]) {
    mocks.path = path;
    const html = renderToStaticMarkup(<DatabaseNotFound />);
    expect(html).toMatch(/<h1[^>]*>Nothing looted on this page\.<\/h1>/);
    expect(html).toContain("No report for this id yet; three installs make it public.");
    expect(html).toContain('href="/addon"');
    expect(html).toContain('action="/search"');
    expect(html).toContain('value="999999"');
    expect(html).toContain('href="/database"');
  }
});

test("a database address without an id keeps the generic copy", () => {
  mocks.path = "/database/no-such-list";
  const html = renderToStaticMarkup(<DatabaseNotFound />);
  expect(html).toContain("The URL doesn");
  expect(html).not.toContain("three installs make it public");
  expect(html).not.toContain('href="/addon"');
  expect(html).toContain('value="no-such-list"');
});

test("the database not-found keeps the site 404's metadata rule, so the answer stays a plain 404 with Next's own noindex (#815)", () => {
  expect(metadata).toEqual(siteMetadata);
  expect(metadata.robots).toBeNull();
});
