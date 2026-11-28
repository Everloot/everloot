import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
import ProfitRanking, { type RankedCraft } from "./profit-ranking";

const row = (i: number): RankedCraft => ({ id: 1000 + i, name: `Recipe ${i}`, href: `/r/${i}`, profit: 1000 - i, margin: 0.5, cost: 100, value: 1200, stale: false, cooldown: false });

test("a capped ranking says it shows the top rows of every estimated recipe, and counts the unestimated ones apart", () => {
  const html = renderToStaticMarkup(<ProfitRanking profession="Tailoring" realmName="QA Realm" house="Horde" cutPercent={5}
    rows={Array.from({ length: 25 }, (_, i) => row(i))} summary={{ total: 90, ranked: 60, unknownOutput: 10, noSale: 15, unpriced: 5 }} />);
  expect(html).toContain("Top 25 of 60 estimated recipes by profit per craft");
  expect(html.match(/data-ranked=/g)).toHaveLength(25);
  expect(html).toContain("30 of 90 recipes have no estimate");
});

test("an uncapped ranking says it lists every estimated recipe", () => {
  const html = renderToStaticMarkup(<ProfitRanking profession="Tailoring" realmName="QA Realm" house="Horde" cutPercent={5}
    rows={Array.from({ length: 3 }, (_, i) => row(i))} summary={{ total: 3, ranked: 3, unknownOutput: 0, noSale: 0, unpriced: 0 }} />);
  expect(html).toContain("All 3 estimated recipes by profit per craft");
  expect(html).not.toContain("Top ");
  expect(html).not.toContain("have no estimate");
});
