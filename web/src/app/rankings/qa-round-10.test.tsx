// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { armoryCharacter } from "@/lib/armory.fixture";
import type { ArmoryBoardRow } from "@/lib/armory-store";
import { percentAxisStep } from "@/lib/chart-axis";
import type { ChartSeries, RankingWeek } from "@/lib/rankings";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import { WeeklyChart } from "./parts";
import { BoardValue } from "../armory/board-parts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const original = globalThis.ResizeObserver;
const roots: ReturnType<typeof createRoot>[] = [];
let laidOut = 326;
beforeEach(() => {
  laidOut = 326;
  globalThis.ResizeObserver = class {
    constructor(private fit: ResizeObserverCallback) {}
    observe(el: Element) { this.fit([{ target: el, contentRect: { width: laidOut } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver); }
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
const series: ChartSeries[] = [
  { key: "hunter", label: "Hunter", classToken: "HUNTER", points: [0.14, 0.15, 0.14] },
  { key: "mage", label: "Mage", classToken: "MAGE", points: [0.1, 0.11, 0.12] },
];
const axisLabels = (svg: Element) => [...svg.querySelectorAll("text.font-mono")].map((t) => t.textContent).filter((t) => t?.endsWith("%"));

test("QA round 10: a ranking's trend chart draws at its own width, so its labels keep their size on a phone", async () => {
  const div = await render(<WeeklyChart weeks={weeks} series={series} title="Classes: share of each week's characters, top 2" />);
  const svg = div.querySelector("[data-weekly-chart] svg")!;
  expect(svg.getAttribute("viewBox")).toBe("0 0 326 300");
  expect(svg.getAttribute("width")).toBe("326");
  const ticks = [...svg.querySelectorAll("text")].filter((t) => t.textContent === "so far");
  // The last week's tick is centred on its point: half of "so far" (about 20 px) must fit before the edge.
  expect(Number(ticks[0].getAttribute("x"))).toBeLessThanOrEqual(326 - 24);
});

test("QA round 10: at 1440 the trend chart is as wide as its card, still one viewBox unit a pixel", async () => {
  laidOut = 1100;
  const div = await render(<WeeklyChart weeks={weeks} series={series} title="Classes: share of each week's characters, top 2" />);
  const svg = div.querySelector("[data-weekly-chart] svg")!;
  expect(svg.getAttribute("viewBox")).toBe("0 0 1100 300");
  // Four lines or fewer are named at their ends, inside the picture.
  const end = [...svg.querySelectorAll("text")].find((t) => t.textContent === "Hunter")!;
  expect(Number(end.getAttribute("x"))).toBeLessThan(1100);
});

test("QA round 10: the trend chart's percent axis labels equal its gridlines (8% is drawn at 8%, not 7.5%)", async () => {
  const div = await render(<WeeklyChart weeks={weeks} series={series} title="Classes: share of each week's characters, top 2" />);
  const svg = div.querySelector("[data-weekly-chart] svg")!;
  expect(axisLabels(svg)).toEqual(["0%", "8%", "16%"]);
  const grid = [...svg.querySelectorAll("line")].slice(0, 3).map((l) => Number(l.getAttribute("y1")));
  // Evenly spaced: the middle line sits half-way, so its label is exactly half the top's.
  expect(grid[0] - grid[1]).toBeCloseTo(grid[1] - grid[2]);
});

test("QA round 10: percent axis steps are whole, round percents at or above half the top share", () => {
  expect(percentAxisStep(0.15)).toBeCloseTo(0.08);
  expect(percentAxisStep(0.14)).toBeCloseTo(0.08);
  expect(percentAxisStep(0.03)).toBeCloseTo(0.02);
  expect(percentAxisStep(0.4)).toBeCloseTo(0.2);
  expect(percentAxisStep(0)).toBeCloseTo(0.01);
  for (const max of [0.01, 0.07, 0.15, 0.33, 0.55, 0.99]) {
    const step = percentAxisStep(max);
    expect(Number.isInteger(Math.round(step * 1e6) / 1e4)).toBe(true);
    expect(step * 2).toBeGreaterThanOrEqual(max);
  }
});

const row = (over: Partial<ArmoryBoardRow> = {}): ArmoryBoardRow => {
  const c = armoryCharacter();
  return { rank: 1, value: 61, region: c.region, slug: c.slug, name: c.name, surname: c.surname, class: "Mage", faction: "Alliance", ruleset: c.ruleset, guild: null, fetchedAt: c.fetchedAt, ...over } as ArmoryBoardRow;
};

test("QA round 10: a board's value bar has a fixed track, so equal scores draw equal bars whatever text sits beside them", () => {
  const ranked = renderToStaticMarkup(<BoardValue row={row()} metric="item-level" top={61} />);
  const unranked = renderToStaticMarkup(<BoardValue row={row({ value: 0 })} metric="item-level" top={61} />);
  const track = (html: string) => html.match(/<span aria-hidden="true" class="([^"]*)"/)![1];
  for (const html of [ranked, unranked]) expect(track(html).split(" ")).toEqual(expect.arrayContaining(["w-16", "self-end"]));
  // The track no longer stretches to the text's width.
  expect(ranked).not.toContain("items-stretch");
});
