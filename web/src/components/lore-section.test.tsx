import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));

import LoreSection from "./LoreSection";

const match = { extId: "deadmines", name: "Deadmines", intro: "The Deadmines are expansive, winding tunnels.", sourceId: "warcraft-wiki" };

test("an entity page's Lore uses the data-section heading and the page's 14 px text", () => {
  const html = renderToStaticMarkup(<LoreSection match={match} />);
  expect(html).toMatch(/<h2 id="lore" class="[^"]*text-h2-sm[^"]*">Lore<\/h2>/);
  expect(html).not.toContain("text-xl");
  expect(html).toMatch(/<p class="text-cell text-fg">The Deadmines are expansive/);
});

test("no match draws nothing", () => {
  expect(renderToStaticMarkup(<LoreSection match={null} />)).toBe("");
});
