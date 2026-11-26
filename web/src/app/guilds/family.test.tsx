import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import GuildFamilyPage from "./[slug]/page";

// A screen reader's landmark list names each region; two with one name cannot be told apart. Each fact table's scroll
// box is already a region named for the table, so the section around it must not take the same name.
test("a family page's regions each have a name of their own", async () => {
  const html = renderToStaticMarkup(await GuildFamilyPage({ params: Promise.resolve({ slug: "olympus" }) }));
  const ids = new Map([...html.matchAll(/<h2 id="([^"]+)"[^>]*>(.*?)<\/h2>/g)].map((m) => [m[1], m[2]]));
  const names = [
    ...[...html.matchAll(/<section aria-labelledby="([^"]+)"/g)].map((m) => ids.get(m[1])),
    ...[...html.matchAll(/role="region" aria-label="([^"]+)"/g)].map((m) => m[1]),
  ];
  expect(names).toContain("Guild halls");
  expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
});
