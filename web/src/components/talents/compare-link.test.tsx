// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { track } from "@/lib/analytics/track";
import { comparePlans, readCompareHash } from "@/lib/talents/compare";
import { fixture } from "@/lib/talents/fixture";
import { encodeBuild } from "@/lib/talents/share";
import type { Ranks } from "@/lib/talents/types";
import TalentCalculator from "./TalentCalculator";

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

// The calculator's link to the compare page (/tools/talents/<class>/compare), on the made-up test tree
// (lib/talents/fixture.ts, not game data): set 1 as plan A and set 2 as plan B, each with the order it has.

const code = (ranks: Ranks) => encodeBuild({ classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks });
const r = (entries: Record<number, number>): Ranks => Object.fromEntries(Object.entries(entries).map(([id, rank]) => [id, { rank }]));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  window.history.replaceState(null, "", "/tools/talents/mage");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function open(fragment: string) {
  window.history.replaceState(null, "", `/tools/talents/mage${fragment}`);
  await act(async () => root.render(<TalentCalculator catalog={fixture} />));
}
const share = () => container.querySelector('section[aria-label="Share"]')!;
const compareLink = () => [...share().querySelectorAll("a")].find((a) => a.textContent === "Compare set 1 and set 2") ?? null;
const button = (label: RegExp) => [...container.querySelectorAll("button")].find((b) => label.test(b.textContent?.trim() ?? ""));
const click = (el: Element | undefined | null) => act(async () => {
  if (!el) throw new Error("Nothing to click");
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
});
/** The plans the link's address carries, as the compare page reads them. */
const sent = () => {
  const url = new URL(compareLink()!.getAttribute("href")!, "https://everloot.app");
  expect(url.pathname).toBe("/tools/talents/mage/compare");
  return readCompareHash(url.hash);
};

test("the link is there only while both sets have points; otherwise it is off and says why", async () => {
  await open("");
  expect(compareLink()).toBeNull();
  const off = button(/^Compare set 1 and set 2$/)!;
  expect(off.disabled).toBe(true);
  expect(share().textContent).toContain("Spend points in both sets to compare them.");

  await click(container.querySelector("#talent-11"));
  expect(compareLink()).toBeNull();
  expect(button(/^Compare set 1 and set 2$/)!.disabled).toBe(true);

  await click(button(/^Set 2$/));
  await click(container.querySelector("#talent-12"));
  expect(compareLink()).not.toBeNull();
  expect(button(/^Compare set 1 and set 2$/)).toBeUndefined();
  expect(sent()).toEqual({ a: { code: code(r({ 11: 1 })), order: "O1p-A" }, b: { code: code(r({ 12: 1 })), order: "O1p-A" } });

  // Set 1 reset: no link again.
  await click(button(/^Set 1$/));
  await click(button(/Reset set 1$/));
  expect(compareLink()).toBeNull();
});

test("its address reads back on the compare page as the same codes and orders: planned, provisional and unknown", async () => {
  const one = code(r({ 11: 2, 12: 1 }));
  const two = code(r({ 11: 1, 12: 1 }));
  await open(`#plan=${one}&plan2=${two}&order=O1p-AAB&order2=O1g-BA`);
  expect(sent()).toEqual({ a: { code: one, order: "O1p-AAB" }, b: { code: two, order: "O1g-BA" } });
  const both = comparePlans(fixture, sent().a!, sent().b!);
  expect(both).toMatchObject({ ok: true, comparison: { a: { set: { orderOrigin: "planned" } }, b: { set: { orderOrigin: "provisional" } } } });

  // Set 2 with no order: the address leaves out its order part, and the compare page reads it as unknown.
  await act(async () => root.unmount());
  root = createRoot(container);
  await open(`#plan=${one}&plan2=${two}&order=O1p-AAB`);
  expect(compareLink()!.getAttribute("href")).not.toContain("bo=");
  expect(sent()).toEqual({ a: { code: one, order: "O1p-AAB" }, b: { code: two, order: null } });
  const unknown = comparePlans(fixture, sent().a!, sent().b!);
  expect(unknown.ok && unknown.comparison.b.set.order).toBeNull();
  expect(unknown.ok && unknown.comparison.milestones).toBeNull();
});

test("an order token kept as it came is escaped in the address and read back whole", async () => {
  const one = code(r({ 11: 2, 12: 1 }));
  const two = code(r({ 12: 1 }));
  // A token this version cannot read rides on as it came; this one holds every character a fragment part needs escaped.
  const token = "O2p-AAB&b=x#y%";
  await open(`#plan=${one}&plan2=${two}&order=${encodeURIComponent(token)}&order2=O1p-A`);
  const href = compareLink()!.getAttribute("href")!;
  expect(href).toBe(`/tools/talents/mage/compare#a=${one}&ao=${encodeURIComponent(token)}&b=${two}&bo=O1p-A`);
  expect(sent()).toEqual({ a: { code: one, order: token }, b: { code: two, order: "O1p-A" } });
});

test("it is a plain link that stays during the preview, and opening it saves nothing and sends nothing", async () => {
  const one = code(r({ 11: 2, 12: 1 }));
  const two = code(r({ 11: 1, 12: 1 }));
  await open(`#plan=${one}&plan2=${two}&order=O1p-AAB&order2=O1p-BA`);
  const href = compareLink()!.getAttribute("href");
  await click(button(/^Preview point by point/));
  expect(container.querySelector('[role="group"][aria-label="Spend order preview"]')).not.toBeNull();
  expect(compareLink()!.getAttribute("href")).toBe(href);
  expect(compareLink()!.getAttribute("target")).toBeNull();

  // The page leaves the click to the browser. The listener after React's stops jsdom, which cannot navigate.
  let left: boolean | null = null;
  const after = (e: Event) => { left = !e.defaultPrevented; e.preventDefault(); };
  document.addEventListener("click", after);
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  vi.mocked(track).mockClear();
  await click(compareLink());
  document.removeEventListener("click", after);
  expect(left).toBe(true);
  expect(setItem).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(track).not.toHaveBeenCalled();
  expect(container.querySelector('[role="group"][aria-label="Spend order preview"]')).not.toBeNull();
});
