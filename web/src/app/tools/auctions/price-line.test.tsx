// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import type { PublicDay } from "@kb/market";
import { PriceChart } from "./parts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ""; });

const point = (day: string, market: number) => ({ day, market, min: market, quantity: 40, thin: false, reporters: 3 }) as PublicDay;
// Five solid days near 1s and one at 48s the trim takes out (QA round 15: it read as a spike to the top line).
const spiked = [100, 110, 105, 4800, 115, 120].map((v, i) => point(`2026-11-0${i + 1}`, v));
const moves = (d: string) => (d.match(/M/g) ?? []).length;
const xOf = (html: string, day: string) => Number(new RegExp(`<circle data-point="${day}"[^>]*cx="([\\d.]+)"`).exec(html)![1]);

test("QA round 15: a trimmed day is a hollow dot only; the line joins the kept days around it", () => {
  const html = renderToStaticMarkup(<PriceChart points={spiked} />);
  const d = /<path d="([^"]+)"/.exec(html)![1];
  // Five kept days, one unbroken line through them; the outlier's x is not on it.
  expect(moves(d)).toBe(1);
  expect((d.match(/[ML]/g) ?? []).length).toBe(5);
  expect(d).not.toContain(`${xOf(html, "2026-11-04")},`);
  expect(html).toMatch(/<circle data-point="2026-11-04" data-outlier/);
});

test("QA round 15: the range under the chart leaves trimmed days out", () => {
  const page = renderToStaticMarkup(<PriceChart points={spiked} />);
  // The trimmed day's own hover label still gives its 48s; the chart's name and its caption do not.
  expect(/<svg[^>]*aria-label="([^"]+)"/.exec(page)![1]).toBe("Market value per public day, last 60 days: 1s 0c to 1s 20c");
  const html = /<figcaption[\s\S]*<\/figcaption>/.exec(page)![0];
  expect(html).not.toContain("48s");
  expect(html).toMatch(/>1 silver<\/span>[\s\S]* to [\s\S]*>1 silver 20 copper<\/span>/);
});

test("QA round 15: the line breaks across a gap longer than two days", () => {
  const html = renderToStaticMarkup(<PriceChart points={[point("2026-11-01", 100), point("2026-11-02", 110), point("2026-11-04", 105), point("2026-11-10", 120), point("2026-11-11", 118)]} />);
  const d = /<path d="([^"]+)"/.exec(html)![1];
  // 11-02 → 11-04 is two days (joined); 11-04 → 11-10 is six (broken).
  expect(moves(d)).toBe(2);
});

test("QA round 15: the chart's end ticks read Nov 1, not 11-01", () => {
  const html = renderToStaticMarkup(<PriceChart points={spiked} />);
  expect(html).toMatch(/>Nov 1<\/text>/);
  expect(html).toMatch(/>Nov 6<\/text>/);
  expect(html).not.toMatch(/>11-0\d<\/text>/);
});

test("QA round 15: a focused day's tooltip sits beside that day, not in the top-right corner", async () => {
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  await act(() => root.render(<PriceChart points={spiked} />));
  const rects = div.querySelectorAll("rect[tabindex]");
  await act(() => { (rects[0] as SVGRectElement).dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
  const tip = div.querySelector<HTMLElement>('[role="tooltip"]')!;
  expect(tip.textContent).toContain("Nov 1, 2026");
  // The first day sits at the plot's left edge (80 px in), so its tooltip opens from there.
  expect(tip.classList.contains("right-2")).toBe(false);
  expect(tip.style.left).toBe("88px");
  await act(() => root.unmount());
});
