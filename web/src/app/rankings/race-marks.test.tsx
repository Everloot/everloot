// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ChartSeries, RankingWeek } from "@/lib/rankings";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import { WeeklyChart } from "./parts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const original = globalThis.ResizeObserver;
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => {
  globalThis.ResizeObserver = class {
    constructor(private fit: ResizeObserverCallback) {}
    observe(el: Element) { this.fit([{ target: el, contentRect: { width: 800 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver); }
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
const race = (label: string, faction: "Alliance" | "Horde", p: number): ChartSeries => ({ key: `${faction}/${label}`, label, faction, points: [p, p, p] });
const races: ChartSeries[] = [
  race("Human", "Alliance", 0.2), race("Orc", "Horde", 0.18), race("Night Elf", "Alliance", 0.15), race("Undead", "Horde", 0.12),
  race("Dwarf", "Alliance", 0.1), race("Troll", "Horde", 0.08), race("Gnome", "Alliance", 0.06), race("Tauren", "Horde", 0.05),
  race("Skyborne", "Alliance", 0.04), race("Skyborne", "Horde", 0.03),
];
/** A line's mark: its colour class and dash pattern. */
const mark = (el: Element) => `${[...el.classList].find((c) => c.startsWith("stroke-") && c !== "stroke-panel")}|${el.getAttribute("stroke-dasharray") ?? "solid"}`;

test("QA round 11: each race's trend line has its own mark, and the legend draws the same mark beside its name", async () => {
  const div = await render(<WeeklyChart weeks={weeks} series={races} title="Races: share of each week's characters" />);
  const lines = [...div.querySelectorAll("[data-weekly-chart] svg[role=img] path")];
  expect(lines).toHaveLength(races.length);
  const marks = lines.map(mark);
  expect(new Set(marks).size).toBe(races.length);
  // Faction still reads from the dash: Alliance solid, Horde dashed.
  races.forEach((s, i) => expect(marks[i].endsWith("|solid")).toBe(s.faction === "Alliance"));
  const legend = [...div.querySelectorAll('[aria-label="Legend"] li')];
  legend.forEach((li, i) => {
    const swatch = li.querySelector("line")!;
    expect([...swatch.classList].find((c) => c.startsWith("stroke-"))).toBe(marks[i].split("|")[0]);
    expect(Boolean(swatch.getAttribute("stroke-dasharray"))).toBe(races[i].faction === "Horde");
  });
  // Points carry the line's colour.
  const dot = div.querySelector("[data-weekly-chart] svg[role=img] circle")!;
  expect([...dot.classList].find((c) => c.startsWith("fill-"))).toBe(marks[0].split("|")[0].replace("stroke-", "fill-"));
});

test("QA round 11: class trend lines keep their class colours, solid", async () => {
  const classes: ChartSeries[] = [
    { key: "hunter", label: "Hunter", classToken: "HUNTER", points: [0.14, 0.15, 0.14] },
    { key: "mage", label: "Mage", classToken: "MAGE", points: [0.1, 0.11, 0.12] },
  ];
  const div = await render(<WeeklyChart weeks={weeks} series={classes} title="Classes" />);
  expect([...div.querySelectorAll("[data-weekly-chart] svg[role=img] path")].map(mark)).toEqual(["stroke-class-hunter|solid", "stroke-class-mage|solid"]);
});
