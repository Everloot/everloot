// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { armoryCharacter } from "@/lib/armory.fixture";
import type { ArmoryBoardRow } from "@/lib/armory-store";
import type { ChartSeries, RankingWeek } from "@/lib/rankings";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import { StackedWeeks, WeeklyTotals } from "./parts";
import { RegionBoard } from "../armory/board-parts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const original = globalThis.ResizeObserver;
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => {
  // A phone's card: the charts are laid out 326 px wide.
  globalThis.ResizeObserver = class {
    constructor(private fit: ResizeObserverCallback) {}
    observe(el: Element) { this.fit([{ target: el, contentRect: { width: 326 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.innerHTML = "";
  globalThis.ResizeObserver = original;
});
async function render(node: ReactNode) {
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  roots.push(root);
  await act(() => root.render(node));
  return div;
}

const week = (start: string, current = false) => ({ start, current, window: { collecting: false } } as RankingWeek);
const weeks = [week("2026-11-09"), week("2026-11-16"), week("2026-11-23", true)];

test("QA round 9: the weekly totals chart draws at its own width, so its labels keep their size on a phone", async () => {
  const div = await render(<WeeklyTotals points={weeks.map((w, i) => ({ week: w, count: [18_040, 27_140, 15_010][i] }))} />);
  const svg = div.querySelector("[data-weekly-totals] svg")!;
  // One viewBox unit is one CSS pixel: an 11 px label stays 11 px at 390 as at 1440.
  expect(svg.getAttribute("viewBox")).toBe("0 0 326 200");
  expect(svg.getAttribute("width")).toBe("326");
  const lines = [...svg.querySelectorAll("line")];
  expect(Number(lines[0].getAttribute("x2"))).toBe(326 - 16);
});

test("QA round 9: the share-by-class chart draws at its own width, so its 100% is not 26 px at 1440 nor 6 px on a phone", async () => {
  const series: ChartSeries[] = [
    { key: "mage", label: "Mage", classToken: "MAGE", points: [0.5, 0.4, 0.45] },
    { key: "rogue", label: "Rogue", classToken: "ROGUE", points: [0.5, 0.6, 0.55] },
  ];
  const div = await render(<StackedWeeks noun="Class" weeks={weeks} series={series} title="Share of each week's characters by class, 2 classes" />);
  const svg = div.querySelector("[data-stacked-chart] svg")!;
  expect(svg.getAttribute("viewBox")).toBe("0 0 326 300");
  expect(svg.getAttribute("width")).toBe("326");
  const ticks = [...svg.querySelectorAll("text")].filter((t) => t.textContent === "so far");
  expect(Number(ticks[0].getAttribute("x"))).toBeLessThan(326);
});

const row = (over: Partial<ArmoryBoardRow> = {}): ArmoryBoardRow => {
  const c = armoryCharacter();
  return { rank: 1, value: 64.2, region: c.region, slug: c.slug, name: c.name, surname: c.surname, class: "Mage", faction: "Alliance", ruleset: c.ruleset, guild: "Long Guild Name", fetchedAt: c.fetchedAt, ...over } as ArmoryBoardRow;
};

test("QA round 9: on a phone each region board row's score sits at the right edge, so the scores form one column", () => {
  const page = renderToStaticMarkup(<RegionBoard metric="item-level" region="us" rows={[row()]} footer={null} />);
  const meta = page.match(/<div class="dt-meta">([\s\S]*?)<\/div>/)![1];
  expect(meta).toMatch(/<span class="ml-auto"><span class="inline-flex min-w-16/);
});
