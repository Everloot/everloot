import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import NotFound, { metadata } from "./not-found";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

test("the not-found page has its heading and a way home", () => {
  const html = renderToStaticMarkup(<NotFound />);
  expect(html).toMatch(/<h1[^>]*>Nothing looted on this page\.<\/h1>/);
  expect(html).toContain('href="/"');
});

test("the not-found page writes no robots tag of its own: Next prints noindex on every answer over 400 (#815)", () => {
  expect(metadata.title).toBe("Page not found");
  // null, not undefined: undefined would let the layout's index,follow through to a 404.
  expect(metadata.robots).toBeNull();
});
