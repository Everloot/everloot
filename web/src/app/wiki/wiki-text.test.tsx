import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { WikiPage } from "@/lib/wiki";
import { InlineText, type TextContext } from "./wiki-text";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));

// Wiki and news bodies draw their text here. Only "deadmines" is published; "stockades" is a draft.
const ctx: TextContext = { tokens: new Map(), pages: (slug) => (slug === "deadmines" ? ({ slug, title: "The Deadmines" } as WikiPage) : null) };
const draw = (href: string) => renderToStaticMarkup(<InlineText inline={[{ kind: "text", text: `Read [the page](${href}).` }]} ctx={ctx} />);

test("a link to a draft through a game version's prefix stays words, in every written form", () => {
  for (const href of ["/beta/wiki/stockades", "/beta/wiki/stockades?from=news", "/beta/wiki/stockades#bosses", "/ptr/wiki/stockades",
    "https://everloot.app/beta/wiki/stockades", "https://www.everloot.app/ptr/wiki/stockades?from=news#bosses"]) {
    expect(draw(href), href).toBe("Read the page.");
  }
});

test("a published page through a prefix stays a link, and other sites and prefix-like paths are drawn as before", () => {
  expect(draw("/beta/wiki/deadmines#history")).toBe('Read <a href="/beta/wiki/deadmines#history">the page</a>.');
  expect(draw("https://everloot.app/ptr/wiki/deadmines")).toBe('Read <a href="https://everloot.app/ptr/wiki/deadmines" rel="noopener">the page</a>.');
  expect(draw("https://warcraft.wiki.gg/beta/wiki/stockades")).toBe('Read <a href="https://warcraft.wiki.gg/beta/wiki/stockades" rel="noopener">the page</a>.');
  expect(draw("/betamax/wiki/stockades")).toBe('Read <a href="/betamax/wiki/stockades">the page</a>.');
});
