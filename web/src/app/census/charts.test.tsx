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
