// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CURRENT_BUILD } from "@/data/game-data/raid";
import { MOTION } from "@/design/tokens";
import { emptySlots, encodeRaid } from "@/lib/raid";
import RaidBuilder from "./RaidBuilder";

// The raid planner's glide (visual identity spec, item 12: FLIP moves): a member pushed out of its slot by a drop,
// or moved with "Move to", travels to its new slot. jsdom has no layout and no Web Animations, so the slots get
// rects from their index (five rows per group, four groups across) and element.animate is recorded.

let container: HTMLDivElement;
let root: Root;
let under: Element | null = null;
let glides: { slot: string | null; keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
const cancelled: string[] = [];

function rectOf(el: Element): DOMRect {
  const i = Number(el.getAttribute("data-drop-slot"));
  if (Number.isNaN(i)) return new DOMRect(0, 0, 0, 0);
  return new DOMRect(Math.floor(i / 5) * 200, (i % 5) * 40, 180, 36);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/tools/raid");
  document.elementFromPoint = () => under;
  window.scrollBy = () => {};
  under = null;
  glides = [];
  cancelled.length = 0;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) { return rectOf(this); };
  HTMLElement.prototype.getAnimations = function (this: HTMLElement) {
    return [{ cancel: () => cancelled.push(this.getAttribute("data-drop-slot")!) }] as unknown as Animation[];
  };
  HTMLElement.prototype.animate = function (this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    glides.push({ slot: this.getAttribute("data-drop-slot"), keyframes, options });
    return { cancel() {} } as Animation;
  } as HTMLElement["animate"];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  delete (HTMLElement.prototype as Partial<HTMLElement>).getAnimations;
  delete (HTMLElement.prototype as Partial<HTMLElement>).getBoundingClientRect;
});

const render = (initialCode?: string) => act(async () => root.render(<RaidBuilder initialCode={initialCode} />));
const tile = (name: string) => [...container.querySelectorAll('[aria-label="Classes"] button')].find((b) => b.textContent?.startsWith(name))!;
const slot = (i: number) => container.querySelector<HTMLButtonElement>(`[data-drop-slot="${i}"]`)!;
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });

function pointer(type: string, target: EventTarget, x: number, y: number) {
  const Ctor = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
  const ev = new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  Object.defineProperty(ev, "pointerType", { value: "mouse" });
  return act(async () => { target.dispatchEvent(ev); });
}
async function dragTo(from: Element, to: Element | null) {
  await pointer("pointerdown", from, 10, 10);
  under = to;
  await pointer("pointermove", window, 40, 40);
  await pointer("pointerup", window, 40, 40);
}
const prefersReduced = () => vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)" }));

/** Slot 0 a warrior, slot 7 a druid; nothing recorded yet. */
async function twoMembers() {
  await render();
  await dragTo(tile("Warrior"), slot(0));
  await dragTo(tile("Druid"), slot(7));
  glides = [];
}

test("a member pushed out by a drop glides from the slot it left; the dropped one, already under the pointer, does not", async () => {
  await twoMembers();
  await dragTo(slot(0), slot(7));
  // The druid was at slot 7 (x 200, y 80) and is now at slot 0 (x 0, y 0).
  expect(glides).toEqual([{
    slot: "0",
    keyframes: [{ transform: "translate(200px, 80px)" }, { transform: "none" }],
    options: { duration: MOTION.duration.panel, easing: MOTION.ease.inOut },
  }]);
  expect(MOTION.duration.panel).toBe(200);
});

test("a drop into an empty slot moves nobody else, so nothing glides", async () => {
  await twoMembers();
  await dragTo(slot(0), slot(12));
  expect(slot(12).getAttribute("aria-label")).toMatch(/Warrior/);
  expect(glides).toEqual([]);
});

test("Move to glides both members of a swap, each from where it was", async () => {
  await twoMembers();
  await click(slot(0));
  const select = container.querySelector<HTMLSelectElement>("#raid-move")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "7");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(button("Move"));
  expect(glides.map((g) => [g.slot, g.keyframes[0].transform])).toEqual([
    ["0", "translate(200px, 80px)"],
    ["7", "translate(-200px, -80px)"],
  ]);
  // A glide still running on a slot is cancelled first, so a quick second move starts from where the eye is.
  expect(cancelled).toEqual(expect.arrayContaining(["0", "7"]));
});

test("under reduced motion nobody glides", async () => {
  await twoMembers();
  prefersReduced();
  await dragTo(slot(0), slot(7));
  expect(slot(0).getAttribute("aria-label")).toMatch(/Druid/);
  expect(glides).toEqual([]);
});

test("the first render, a loaded link, a size switch, Clear and undo land at once", async () => {
  const slots = emptySlots(20);
  slots[0] = { class: "warrior", tree: 1 };
  slots[7] = { class: "priest", tree: 1 };
  await render(encodeRaid({ size: 20, build: CURRENT_BUILD, slots }));
  await click([...container.querySelectorAll('[aria-label="Raid size"] button')].find((b) => b.textContent?.startsWith("10"))!);
  await click(button("Undo"));
  await click(button("Clear"));
  await click(button("Undo"));
  expect(slot(7).getAttribute("aria-label")).toMatch(/Priest/);
  expect(glides).toEqual([]);
});
