import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch }: { href: string; children: ReactNode; prefetch?: boolean }) => <a href={href} data-prefetch={String(prefetch)}>{children}</a>,
}));

import EntityLink from "./EntityLink";
import { lookHasCard, type ItemLook } from "@/lib/item-look";

test.each(["spell", "vendor"] as const)("a %s EntityLink targets the page recognized by hover cards", (kind) => {
  const html = renderToStaticMarkup(<EntityLink kind={kind} id={10} name="Shown name" />);
  expect(html).toContain(`href="/database/${kind}s/10"`);
  expect(html).toContain("Shown name");
  expect(html).not.toContain("data-no-hover-card");
});

// QA round 13: an item the page shows as "Item N" has no card; the hover listener skips [data-no-hover-card].
test("noCard opts the link out of the hover card; an item look with a name, tooltip or icon keeps it", () => {
  expect(renderToStaticMarkup(<EntityLink kind="item" id={274648} noCard />)).toContain("data-no-hover-card");
  expect(renderToStaticMarkup(<EntityLink kind="item" id={274648} noCard={false} />)).not.toContain("data-no-hover-card");
  const bare = { name: null, quality: undefined, icon: null, tip: undefined };
  expect(lookHasCard(bare)).toBe(false);
  expect(lookHasCard({ ...bare, name: { name: "Mirage Mirror", source: "files" } as ItemLook["name"] })).toBe(true);
  expect(lookHasCard({ ...bare, icon: "https://assets.everloot.app/i.webp" })).toBe(true);
});

test("an EntityLink is never prefetched, on view or on hover", () => {
  expect(renderToStaticMarkup(<EntityLink kind="item" id={10} name="Shown name" />)).toContain('data-prefetch="false"');
});
