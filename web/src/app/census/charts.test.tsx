// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { DailyChart, IconName } from "./charts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(() => root.unmount()); document.body.innerHTML = ""; });
function mount() { const div = document.createElement("div"); document.body.append(div); const root = createRoot(div); roots.push(root); return { div, root }; }

test("daily hover and keyboard focus show the day, count and crosshair; hidden days stay hidden", async () => {
  const { div, root } = mount();
  await act(() => root.render(<DailyChart days={[{ day: "2026-11-14", count: null }, { day: "2026-11-15", count: 110 }]} />));
  const targets = div.querySelectorAll("rect");
  await act(() => targets[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(div.querySelector('[role="tooltip"]')?.textContent).toBe("2026-11-15: 110");
  expect(div.querySelector("[data-crosshair]")).not.toBeNull();
  await act(() => (targets[0] as SVGElement).focus());
  expect(div.querySelector('[role="tooltip"]')?.textContent).toBe("2026-11-14: not enough reports");
  expect(div.querySelectorAll("circle")).toHaveLength(1);
  await act(() => (targets[0] as SVGElement).blur());
  expect(div.querySelector('[role="tooltip"]')).toBeNull();
});

test("an image failure leaves the class name visible", async () => {
  const { div, root } = mount();
  await act(() => root.render(<IconName label="Hunter" url="https://render.worldofwarcraft.com/icons/56/classicon_hunter.jpg" />));
  expect(div.querySelector("img")?.alt).toBe("Hunter icon");
  await act(() => div.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(div.querySelector("img")).toBeNull();
  expect(div.textContent).toBe("Hunter");
});

test("QA round 8: the daily chart draws at its own width, so on a phone its labels keep their size instead of shrinking with the picture", async () => {
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(private fit: ResizeObserverCallback) {}
    observe(el: Element) { this.fit([{ target: el, contentRect: { width: 358 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  try {
    const { div, root } = mount();
    await act(() => root.render(<DailyChart days={[{ day: "2026-11-14", count: 300 }, { day: "2026-11-15", count: 120 }]} />));
    const svg = div.querySelector("svg")!;
    // One viewBox unit is one CSS pixel: a 12 px label stays 12 px at 390 as at 1440.
    expect(svg.getAttribute("viewBox")).toBe("0 0 358 224");
    expect(svg.getAttribute("width")).toBe("358");
    const last = [...svg.querySelectorAll("text")].find((t) => t.textContent === "11-15")!;
    expect(Number(last.getAttribute("x"))).toBeLessThanOrEqual(358 - 24);
  } finally {
    globalThis.ResizeObserver = original;
  }
});
