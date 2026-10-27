// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CURRENT_BUILD } from "@/data/game-data/raid";
import { emptySlots, encodeRaid } from "@/lib/raid";
import RaidBuilder from "./RaidBuilder";
import { track } from "@/lib/analytics/track";

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));
// The class context chip reads its class from the address through the app router, which renders again when the
// address changes (a popstate stands for that); its links are plain anchors here.
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (fn: () => void) => { window.addEventListener("popstate", fn); return () => window.removeEventListener("popstate", fn); };
  return {
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search, () => window.location.search)),
    usePathname: () => window.location.pathname,
  };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

let container: HTMLDivElement;
let root: Root;
// jsdom has no layout, so elementFromPoint is ours: whatever the test puts under the pointer.
let under: Element | null = null;

beforeEach(() => {
  vi.mocked(track).mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/tools/raid");
  document.elementFromPoint = () => under;
  window.scrollBy = () => {};
  under = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const render = (initialCode?: string) => act(async () => root.render(<RaidBuilder initialCode={initialCode} />));

test("copies a bare raid code for importing into the addon", async () => {
  await render();
  expect([...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Copy for addon"))?.disabled).toBe(true);
  await click(tile("Mage"));
  await click(slot(0));
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const copy = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Copy for addon"));
  expect(copy).toBeDefined();
  await click(copy!);
  expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^ELR1-20-[\d.]+-/));
  expect(container.textContent).toContain("Raid tab");
});

test("counts a shared raid only when copying succeeds", async () => {
  await render();
  await click(tile("Mage"));
  await click(slot(0));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  const copy = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Copy link"))!;
  await click(copy);
  expect(track).toHaveBeenCalledExactlyOnceWith("raid_comp_shared", { via: "copy" });
  vi.mocked(track).mockClear();
  vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("denied"));
  await click(copy);
  expect(track).not.toHaveBeenCalled();
});
const palette = () => container.querySelector('[role="group"][aria-label="Classes"]')!;
const tile = (name: string) => [...palette().querySelectorAll("button")].find((b) => b.textContent?.startsWith(name))!;
const slot = (i: number) => container.querySelector<HTMLButtonElement>(`[data-drop-slot="${i}"]`)!;
const label = (i: number) => slot(i).getAttribute("aria-label");
const status = () => container.querySelector('[role="status"][aria-live="polite"]')!.textContent;
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
const key = (k: string) => act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

function pointer(type: string, target: EventTarget, x: number, y: number, pointerType = "mouse") {
  const Ctor = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
  const ev = new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  Object.defineProperty(ev, "pointerType", { value: pointerType });
  return act(async () => { target.dispatchEvent(ev); });
}

/** A mouse drag from `from` to whatever `to` is (null: a gap between slots). */
async function dragTo(from: Element, to: Element | null) {
  await pointer("pointerdown", from, 10, 10);
  under = to;
  await pointer("pointermove", window, 40, 40);
  await pointer("pointerup", window, 40, 40);
}

test("the nine classes sit in a palette above the groups, with how many each has in the raid", async () => {
  await render();
  const tiles = [...palette().querySelectorAll("button")];
  expect(tiles.map((b) => b.textContent)).toEqual(["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"]);
  expect(palette().compareDocumentPosition(container.querySelector("[data-raid-groups]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.querySelectorAll("[data-drop-slot]")).toHaveLength(20);
  // The summary sits in the toolbar row.
  expect(container.querySelector("[data-raid-summary]")!.textContent).toBe("0 of 20 filled");
  await dragTo(tile("Mage"), slot(0));
  expect(tile("Mage").getAttribute("aria-label")).toBe("Mage, 1 in the raid");
  expect(container.querySelector("[data-raid-summary]")!.textContent).toBe("1 of 20 filled · 0 tanks, 0 healers, 1 damage");
});

test("dragging a class onto a slot fills it, onto a filled slot replaces it, and says so", async () => {
  await render();
  await dragTo(tile("Mage"), slot(2));
  expect(label(2)).toBe("Group 1, slot 3: Mage, any tree");
  expect(status()).toBe("Added Mage to group 1, slot 3.");
  const expected = emptySlots(20);
  expected[2] = { class: "mage", tree: 0 };
  expect(location.hash).toBe(`#raid=${encodeRaid({ size: 20, build: CURRENT_BUILD, slots: expected })}`);
  await dragTo(tile("Priest"), slot(2).querySelector("span")!);
  expect(label(2)).toBe("Group 1, slot 3: Priest, any tree");
  expect(status()).toBe("Replaced Mage, any tree with Priest in group 1, slot 3.");
  // A drop in a gap between slots does nothing.
  await dragTo(tile("Rogue"), container.querySelector("[data-raid-groups]"));
  expect(container.querySelector("[data-raid-summary]")!.textContent).toMatch(/^1 of 20/);
});

test("dragging a member moves it, swaps with a filled slot, and the trash or off the groups removes it", async () => {
  await render();
  await dragTo(tile("Warrior"), slot(0));
  await dragTo(tile("Druid"), slot(1));
  await dragTo(slot(0), slot(7));
  expect(label(0)).toBe("Group 1, slot 1: empty");
  expect(label(7)).toBe("Group 2, slot 3: Warrior, any tree");
  expect(status()).toBe("Moved Warrior, any tree to group 2, slot 3.");
  await dragTo(slot(7), slot(1));
  expect(label(1)).toBe("Group 1, slot 2: Warrior, any tree");
  expect(label(7)).toBe("Group 2, slot 3: Druid, any tree");
  expect(status()).toBe("Swapped Warrior, any tree with Druid, any tree.");
  await dragTo(slot(7), container.querySelector("[data-drop-trash]"));
  expect(label(7)).toBe("Group 2, slot 3: empty");
  expect(status()).toBe("Removed Druid, any tree from group 2, slot 3.");
  await dragTo(slot(1), document.body);
  expect(label(1)).toBe("Group 1, slot 2: empty");
  // Undo puts the last one back.
  await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Undo")!);
  expect(label(1)).toBe("Group 1, slot 2: Warrior, any tree");
});

test("Escape cancels a drag, and a press that does not move is a click, not a drag", async () => {
  await render();
  await pointer("pointerdown", tile("Hunter"), 10, 10);
  under = slot(4);
  await pointer("pointermove", window, 40, 40);
  expect(container.querySelector("[data-drag-ghost]")!.textContent).toBe("Hunter");
  expect(slot(4).className).toContain("ring-accent");
  await key("Escape");
  expect(container.querySelector("[data-drag-ghost]")).toBeNull();
  await pointer("pointerup", window, 40, 40);
  expect(label(4)).toBe("Group 1, slot 5: empty");
  expect(status()).toBe("Drag cancelled.");
  await pointer("pointerdown", tile("Hunter"), 10, 10);
  await pointer("pointerup", window, 11, 11);
  expect(container.querySelector("[data-drag-ghost]")).toBeNull();
  expect(label(4)).toBe("Group 1, slot 5: empty");
});

test("a finger drags after holding still; a swipe before that scrolls instead", async () => {
  vi.useFakeTimers();
  await render();
  await pointer("pointerdown", tile("Shaman"), 10, 10, "touch");
  under = slot(3);
  await pointer("pointermove", window, 10, 60, "touch");
  await act(async () => { vi.advanceTimersByTime(500); });
  await pointer("pointerup", window, 10, 60, "touch");
  expect(label(3)).toBe("Group 1, slot 4: empty");
  await pointer("pointerdown", tile("Shaman"), 10, 10, "touch");
  await act(async () => { vi.advanceTimersByTime(300); });
  await pointer("pointermove", window, 10, 60, "touch");
  await pointer("pointerup", window, 10, 60, "touch");
  expect(label(3)).toBe("Group 1, slot 4: Shaman, any tree");
});

test("click to add: pick a class, then slots; Escape stops; a slot alone opens the picker with its tree", async () => {
  await render();
  await click(tile("Paladin"));
  expect(tile("Paladin").getAttribute("aria-pressed")).toBe("true");
  expect(status()).toBe("Paladin picked. Choose a slot, or press Escape to stop.");
  await click(slot(0));
  await click(slot(5));
  expect(label(0)).toBe("Group 1, slot 1: Paladin, any tree");
  expect(label(5)).toBe("Group 2, slot 1: Paladin, any tree");
  expect(status()).toBe("Added Paladin to group 2, slot 1.");
  await key("Escape");
  expect(tile("Paladin").getAttribute("aria-pressed")).toBe("false");
  // With nothing picked, a slot opens the picker: class, tree, move and clear work as before.
  await click(slot(0));
  const picker = container.querySelector('[role="group"][aria-label="Pick for group 1, slot 1"]')!;
  expect(picker).not.toBeNull();
  const tree = [...picker.querySelectorAll('[aria-label="Talent tree"] button')];
  expect(tree.map((b) => b.textContent)).toEqual(["Any tree", "Holy", "Protection", "Retribution"]);
  await click(tree[2]);
  expect(label(0)).toBe("Group 1, slot 1: Paladin, Protection");
  expect(container.querySelector("[data-raid-summary]")!.textContent).toContain("1 tank");
  // The "+ Add" picker still fills an empty slot.
  await click([...picker.querySelectorAll("button")].find((b) => b.textContent === "Done")!);
  await click(slot(9));
  const add = container.querySelector('[role="group"][aria-label="Pick for group 2, slot 5"]')!;
  await click([...add.querySelectorAll('[aria-label="Class"] button')].find((b) => b.textContent === "Mage")!);
  expect(label(9)).toBe("Group 2, slot 5: Mage, any tree");
});

test("coverage: missing buffs as chips first, the full table behind a closed disclosure", async () => {
  await render();
  expect(container.textContent).toContain("Add classes to see what the raid is missing.");
  await dragTo(tile("Warrior"), slot(0));
  const missing = [...container.querySelectorAll("[data-raid-missing] li")].map((li) => li.textContent);
  expect(missing.length).toBeGreaterThan(0);
  expect(missing).not.toContain("Battle Shout");
  expect(missing.some((m) => /Fortitude/.test(m!))).toBe(true);
  const details = container.querySelector<HTMLDetailsElement>("[data-coverage-details]")!;
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")!.textContent).toContain("Show full coverage");
  // The table and its legend are inside, intact.
  expect([...details.querySelectorAll("caption")].map((c) => c.textContent)).toEqual(["Buffs, per group", "Debuffs on the enemy"]);
  expect(details.querySelector("dl")!.textContent).toContain("No class you picked brings it.");
});

test("a party buff in one group is missing only for the others, by group", async () => {
  await render();
  await dragTo(tile("Paladin"), slot(0));
  const missing = [...container.querySelectorAll("[data-raid-missing] li")].map((li) => li.textContent);
  expect(missing.some((m) => / · G2 G3 G4$/.test(m!))).toBe(true);
});

/* ---------- The class context chip, on the planner page ---------- */

const removeContext = () => [...container.querySelectorAll("a")].find((a) => a.textContent?.includes("Remove Mage, level 25")) ?? null;
const raidAddress = (slots: ReturnType<typeof emptySlots>) => `/tools/raid#raid=${encodeRaid({ size: 20, build: CURRENT_BUILD, slots })}`;
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;

test("the class context chip's links hold the raid as it is after an add, an undo and a clear, with no event to catch", async () => {
  window.history.replaceState(null, "", "/tools/raid?class=mage&level=25");
  await act(async () => root.render(<RaidBuilder classContext />));
  expect(removeContext()?.getAttribute("href")).toBe("/tools/raid");
  const mage = emptySlots(20);
  mage[0] = { class: "mage", tree: 0 };
  await click(tile("Mage"));
  await click(slot(0));
  expect(removeContext()!.getAttribute("href")).toBe(raidAddress(mage));
  // Undo from the keyboard with the link focused: copying it or a modified click must not bring the undone raid back.
  removeContext()!.focus();
  await act(async () => { removeContext()!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })); });
  expect(label(0)).toBe("Group 1, slot 1: empty");
  expect(removeContext()!.getAttribute("href")).toBe("/tools/raid");
  await click(slot(0));
  expect(removeContext()!.getAttribute("href")).toBe(raidAddress(mage));
  await click(button("Undo"));
  expect(removeContext()!.getAttribute("href")).toBe("/tools/raid");
  await click(slot(0));
  await click(button("Clear"));
  expect(removeContext()!.getAttribute("href")).toBe("/tools/raid");
  // A plain click takes the context off in place, and the raid the planner holds stays in the address.
  await click(slot(0));
  await click(removeContext()!);
  expect(`${location.pathname}${location.search}${location.hash}`).toBe(raidAddress(mage));
});

test("a raid link still opens its raid", async () => {
  const slots = emptySlots(10);
  slots[0] = { class: "warrior", tree: 3 };
  slots[6] = { class: "priest", tree: 1 };
  await render(encodeRaid({ size: 10, build: CURRENT_BUILD, slots }));
  expect(container.querySelectorAll("[data-drop-slot]")).toHaveLength(10);
  expect(label(0)).toMatch(/^Group 1, slot 1: Warrior, /);
  expect(label(6)).toMatch(/^Group 2, slot 2: Priest, /);
  expect(location.hash).toMatch(/^#raid=ELR1-10-/);
});
