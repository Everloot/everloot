// @vitest-environment jsdom
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { RankingWeek } from "@/lib/rankings";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import { StackedWeeks, WeeklyTotals } from "./parts";

const week = (start: string, current = false) => ({ start, current, window: { collecting: false } } as RankingWeek);
const weeks = [week("2026-11-09"), week("2026-11-16"), week("2026-11-23", true)];

/** A box that scrolls (or clips by scrolling) at 1440: a sticky header inside it sticks to it, 44 px down onto row 1. */
const scrollsAtDesktop = (el: Element) => {
  const c = el.classList;
  if (c.contains("overflow-hidden") || c.contains("overflow-auto") || c.contains("overflow-scroll")) return true;
  return c.contains("overflow-x-auto") && !c.contains("lg:overflow-visible");
};

test("QA round 15: a chart's \"Show as a table\" header is not sticky inside the table's own scroll box, so it never covers row 1", () => {
  const html = renderToStaticMarkup(
    <>
      <WeeklyTotals points={weeks.map((w, i) => ({ week: w, count: [18_040, 27_140, 16_415][i] }))} />
      <StackedWeeks title="Share of each week's characters by class" weeks={weeks} series={[{ key: "mage", label: "Mage", classToken: "MAGE", points: [0.5, 0.4, 0.45] }]} />
    </>,
  );
  document.body.innerHTML = html;
  const tables = [...document.querySelectorAll("[data-chart-table]")];
  expect(tables.length).toBe(2);
  for (const t of tables) {
    for (const th of t.querySelectorAll("th")) {
      const sticky = [...th.classList].some((c) => /(^|:)sticky$/.test(c));
      if (!sticky) continue;
      for (let el = th.parentElement; el; el = el.parentElement) expect(scrollsAtDesktop(el)).toBe(false);
    }
    // A wide table still scrolls sideways in its own box at every width.
    expect(t.querySelector('[role="region"]')!.classList.contains("overflow-x-auto")).toBe(true);
    expect(t.querySelector('[role="region"]')!.classList.contains("lg:overflow-visible")).toBe(false);
  }
});
