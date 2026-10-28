// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fixture } from "@/lib/talents/fixture";
import { readPlanHash } from "@/lib/talents/import";
import { encodeBuild } from "@/lib/talents/share";
import TalentCalculator from "./TalentCalculator";
import TalentClassView from "./TalentClassView";
import { track } from "@/lib/analytics/track";

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));
vi.mock("next/link", () => ({
  default: (props: { href: string; children: ReactNode; className?: string; "aria-current"?: "page" }) => <a {...props} />,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.mocked(track).mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no scrollBy, and the calculator calls it whenever a talent takes keyboard focus out of place.
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  window.location.hash = "";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const render = () => act(async () => root.render(<TalentCalculator catalog={fixture} />));

test("copies only the active talent set for the addon, as a link with its order, and disables empty sets", async () => {
  await render();
  let copy = button(/^Copy for addon/);
  expect(copy).toBeDefined();
  expect(copy.disabled).toBe(true);
  await click(node(11));
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  copy = button(/^Copy for addon/);
  await click(copy);
  const codeOf = (rank: number) => encodeBuild({ classSlug: fixture.classSlug, specId: fixture.specId, build: fixture.build, ranks: { 11: { rank } } });
  expect(writeText).toHaveBeenCalledWith(`https://everloot.app/tools/talents/mage#plan=${codeOf(1)}&order=O1p-A`);
  expect(container.textContent).toContain("Talents tab");
  await click(button(/^Set 2$/));
  expect(button(/^Copy for addon/).disabled).toBe(true);
  await click(node(11));
  await click(node(11));
  await click(button(/^Copy for addon/));
  expect(writeText).toHaveBeenLastCalledWith(`https://everloot.app/tools/talents/mage#plan2=${codeOf(2)}&order2=O1p-AA`);
});

test("counts actual build use once, ignoring refused clicks, and counts only successful shares", async () => {
  await render();
  await click(node(21));
  expect(track).not.toHaveBeenCalled();
  await click(node(11));
  await click(node(11));
  expect(track).toHaveBeenCalledExactlyOnceWith("talent_build_made", { class: "mage" });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  await click(button(/^Copy link/));
  expect(track).toHaveBeenLastCalledWith("talent_build_shared", { via: "copy" });
  vi.mocked(track).mockClear();
  vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("denied"));
  await click(button(/^Copy link/));
  expect(track).not.toHaveBeenCalled();
});
const node = (id: number) => container.querySelector<HTMLButtonElement>(`#talent-${id}`)!;
const status = () => container.querySelector('[role="status"]')!.textContent;
const button = (label: RegExp) => [...container.querySelectorAll("button")].find((b) => label.test(b.textContent ?? ""))!;
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
/** A figure in the build bar by its label: "Points left", "Level needed". */
const stat = (label: string) => [...container.querySelectorAll("span")].find((s) => s.textContent === label)!.nextElementSibling!.textContent;

test("a talent says its rank, row and why it is locked", async () => {
  await render();
  expect(node(11).getAttribute("aria-label")).toBe("Talent 11, rank 0 of 5, row 1, can take a point");
  expect(node(21).getAttribute("aria-label")).toBe("Talent 21, rank 0 of 5, row 2, locked. Needs 5 points spent in Left on rows above.");
});

test("a click adds a point and announces it; a refused click explains itself", async () => {
  await render();
  await click(node(11));
  expect(status()).toBe("Talent 11: rank 1 of 5.");
  expect(node(11).textContent).toContain("1/5");
  await click(node(21));
  expect(status()).toBe("Needs 5 points spent in Left on rows above.");
  expect(stat("Points left")).toBe("50");
  expect(stat("Level needed")).toBe("10");
});

test("take-points-back mode removes, and a point other rows depend on stays", async () => {
  await render();
  for (let i = 0; i < 5; i++) await click(node(11));
  await click(node(21));
  await click(button(/Take points back/));
  expect(button(/Take points back/).getAttribute("aria-pressed")).toBe("true");
  await click(node(11));
  expect(status()).toBe("A talent further down depends on this point.");
  await click(node(21));
  await click(node(11));
  expect(node(11).textContent).toContain("4/5");
});

test("undo, redo and reset", async () => {
  await render();
  await click(node(11));
  await click(node(11));
  await click(button(/^Undo$/));
  expect(node(11).textContent).toContain("1/5");
  await click(button(/^Redo$/));
  expect(node(11).textContent).toContain("2/5");
  await click(button(/Reset set 1$/));
  expect(node(11).textContent).toContain("0/5");
  await click(button(/^Undo$/));
  expect(node(11).textContent).toContain("2/5");
});

test("the second set stays locked below level 40 unless planning ahead", async () => {
  await render();
  const second = button(/^Set 2$/);
  expect(second.getAttribute("aria-disabled")).toBe("false");
  const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(slider, "30"); slider.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(button(/^Set 2$/).getAttribute("aria-disabled")).toBe("true");
  expect(container.textContent).toContain("opens at level 40");
  await click(container.querySelector('input[type="checkbox"]')!);
  expect(button(/^Set 2$/).getAttribute("aria-disabled")).toBe("false");
});

test("a link from another build loads and lists what it could not place", async () => {
  const code = encodeBuild({ classSlug: "mage", specId: 1482, build: "0.9.0.0", ranks: { 11: { rank: 2 }, 999: { rank: 1 } } });
  window.location.hash = `#plan=${code}`;
  await render();
  expect(node(11).textContent).toContain("2/5");
  const text = container.querySelector('[aria-label="What loaded"]')!.textContent!;
  expect(text).toContain("Loaded, with 2 changes.");
  expect(text).toContain("Made on game build 0.9.0.0");
  expect(text).toContain("node 999");
});

test("the page address is the build as points are spent, and it carries both sets", async () => {
  await render();
  expect(container.querySelector<HTMLInputElement>("#talent-link")!.value).toBe("");
  expect(button(/Copy link/).disabled).toBe(true);
  await click(node(11));
  expect(window.location.hash).toMatch(/^#plan=EL1-mage-1482-1\.0\.0\.1-[^&]+&order=O1p-A$/);
  // The link handed out is the build link, which a chat can preview; the address bar carries the same build, and
  // the link its spend order after #.
  const first = readPlanHash(window.location.hash).first;
  expect(container.querySelector<HTMLInputElement>("#talent-link")!.value).toBe(`${window.location.origin}/tools/talents/mage/b/${first}#order=O1p-A`);
  await click(button(/^Set 2$/));
  await click(node(11));
  await click(node(11));
  const both = window.location.hash;
  expect(both).toMatch(/^#plan=EL1-[^&]+&plan2=EL1-/);

  // A friend opens the link: both sets come back.
  await act(async () => root.unmount());
  root = createRoot(container);
  window.location.hash = both;
  await render();
  expect(status()).toBe("Both sets loaded from the link.");
  expect(node(11).textContent).toContain("1/5");
  await click(button(/^Set 2$/));
  expect(node(11).textContent).toContain("2/5");
  expect(window.location.hash).toBe(both);
});

test("a build link opens its sets and moves the address to the class page's #plan= form", async () => {
  const one = encodeBuild({ classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks: { 11: { rank: 4 } } });
  window.history.replaceState(null, "", "/tools/talents/mage/b/x");
  await act(async () => root.render(<TalentCalculator catalog={fixture} initialCodes={[one, null]} />));
  expect(node(11).textContent).toContain("4/5");
  expect(window.location.pathname).toBe("/tools/talents/mage");
  expect(window.location.hash).toBe(`#plan=${one}`);
  window.history.replaceState(null, "", "/");
});

test("an old link with only the first set still opens", async () => {
  const code = encodeBuild({ classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks: { 11: { rank: 3 } } });
  window.location.hash = `#plan=${code}`;
  await render();
  expect(node(11).textContent).toContain("3/5");
  expect(status()).toBe("Build loaded from the link.");
});

const setLevel = (value: string) => act(async () => {
  const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, value);
  slider.dispatchEvent(new Event("input", { bubbles: true }));
});
const key = (el: Element, k: string) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

test("redo cannot bring back more points than the level holds", async () => {
  await render();
  for (let i = 0; i < 5; i++) await click(node(11));
  for (let i = 0; i < 3; i++) await click(node(12));
  expect(stat("Points left")).toBe("43");
  for (let i = 0; i < 3; i++) await click(button(/^Undo$/));
  await setLevel("14");
  expect(stat("Points left")).toBe("0");
  expect(stat("Level needed")).toBe("14");
  for (let i = 0; i < 3; i++) await click(button(/^Redo$/));
  expect(stat("Points left")).toBe("0");
  expect(stat("Level needed")).toBe("17");
  expect(status()).toBe("Level raised to 17, the lowest that holds the points in this build.");
});

test("a locked talent says what it needs before it says the points ran out", async () => {
  await render();
  await setLevel("10");
  await click(node(11));
  expect(stat("Points left")).toBe("0");
  expect(node(21).getAttribute("aria-label")).toContain("Needs 5 points spent in Left on rows above");
  expect(node(21).getAttribute("aria-label")).not.toContain("No points left");
  expect(node(12).getAttribute("aria-label")).toContain("No points left at this level");
});

test("arrow keys stay on the row or column and do not jump rows sideways", async () => {
  await render();
  const focusAfter = async (from: number, k: string) => {
    await act(async () => node(from).focus());
    await key(node(from), k);
    return document.activeElement?.id;
  };
  expect(await focusAfter(21, "ArrowRight")).toBe("talent-22");
  expect(await focusAfter(22, "ArrowRight")).toBe("talent-22"); // nothing further right on row 2: stays
  expect(await focusAfter(11, "ArrowDown")).toBe("talent-21");
  expect(await focusAfter(12, "ArrowDown")).toBe("talent-22");
  expect(await focusAfter(22, "ArrowDown")).toBe("talent-32-0"); // choice node, first entry
  expect(await focusAfter(11, "ArrowLeft")).toBe("talent-11");
  expect(await focusAfter(41, "ArrowUp")).toBe("talent-31"); // column 1: row 3 is the next one up
});

test("pasting a share link into an open tab loads it", async () => {
  await render();
  expect(node(11).textContent).toContain("0/5");
  const code = encodeBuild({ classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks: { 11: { rank: 3 } } });
  await act(async () => {
    // jsdom, like a browser, fires hashchange itself once the hash is set.
    window.location.hash = `#plan=${code}`;
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(node(11).textContent).toContain("3/5");
  expect(status()).toBe("Build loaded from the link.");
  await click(button(/^Undo$/));
  expect(node(11).textContent).toContain("0/5");
});

test("before the first point the build bar has nothing to need: points left is the level's, level needed is a dash", async () => {
  await render();
  expect(stat("Points left")).toBe("51");
  expect(stat("Level needed")).toBe("–");
});

test("a tree's own reset clears that tree, and is refused while another tree needs its points", async () => {
  await render();
  for (let i = 0; i < 5; i++) await click(node(11));
  await click(node(51));
  await click(node(52));
  expect(node(52).textContent).toContain("1/1");
  const reset = (tree: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="Reset ${tree}"]`)!;
  await click(reset("Left"));
  expect(status()).toBe("Talents in another tree need the points in Left. Take those back first.");
  expect(node(11).textContent).toContain("5/5");
  await click(reset("Right"));
  expect(status()).toBe("Right was reset. Undo brings it back.");
  expect(node(51).textContent).toContain("0/5");
  expect(node(11).textContent).toContain("5/5");
  await click(button(/^Undo$/));
  expect(node(52).textContent).toContain("1/1");
});

test("without the game's tooltips there is no empty talent panel; selecting a talent opens it", async () => {
  await render();
  expect(container.querySelector('[aria-label="Selected talent"]')).toBeNull();
  await act(async () => node(22).focus());
  await click(node(22));
  expect(container.querySelector('[aria-label="Selected talent"]')?.textContent).toContain("Needs Talent 12 at full rank.");
});

// The phone layout. jsdom has no layout, so these pin the wiring and the classes the browser check rests on; the
// first-screen and focus geometry are measured in a browser.
const section = (tree: string) => container.querySelector(`section[aria-label="${tree}"]`)!;
/** The line under the phone's tree switch: points left and the set being planned. */
const treeStatus = () => container.querySelector("[data-tree-status]")!;
const liveRegions = () => container.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"]');
const switchBar = () => treeStatus().parentElement!;

test("the phone's tree switch says how many points are left and which set is planned, for the eye only", async () => {
  await render();
  expect(treeStatus().textContent).toBe("51 left · Set 1");
  expect(treeStatus().getAttribute("aria-hidden")).toBe("true");
  await click(node(11));
  expect(treeStatus().textContent).toBe("50 left · Set 1");
  await click(button(/^Set 2$/));
  expect(treeStatus().textContent).toBe("51 left · Set 2");
  // Below level 40 the second set closes and the page is back on set 1, with its one point spent.
  await setLevel("30");
  expect(treeStatus().textContent).toBe("20 left · Set 1");
});

test("the status line is the calculator's only live region; the sticky switch's line is never announced", async () => {
  await render();
  expect(liveRegions()).toHaveLength(1);
  expect(liveRegions()[0].textContent).toBe("");
  await click(node(11));
  await click(node(21));
  expect(liveRegions()).toHaveLength(1);
  expect(status()).toBe("Needs 5 points spent in Left on rows above.");
  expect(container.querySelectorAll("[data-tree-status]")).toHaveLength(1);
  expect(treeStatus().closest("[aria-hidden='true']")).toBe(treeStatus());
  expect(treeStatus().closest("[aria-live], [role='status']")).toBeNull();
});

test("on a tall enough phone the tree switch sticks under the site header, over the trees only (class proxy)", async () => {
  await render();
  expect(switchBar().className.split(" ")).toEqual(expect.arrayContaining(["[@media(min-height:37.5rem)]:sticky", "top-header", "bg-panel", "md:hidden"]));
  expect(switchBar().querySelector('[aria-label="Show tree"]')).not.toBeNull();
  const trees = section("Left").parentElement!;
  // The switch sticks only while the trees are on screen, never over the share fields under them.
  expect(switchBar().parentElement!.contains(trees)).toBe(true);
  expect(switchBar().parentElement!.querySelector('[aria-label="Share"]')).toBeNull();
  // A card that clips with overflow: hidden is a scroll container, and nothing inside it sticks to the window.
  // Important, so it beats the card's own overflow-hidden whichever the stylesheet writes last.
  expect(container.querySelector("[data-card]")!.className.split(" ")).toContain("!overflow-clip");
});

test("the tree switch stops sticking once it and the site header would take more than a quarter of the window", async () => {
  await render();
  const sticks = () => switchBar().className.split(" ").includes("[@media(min-height:37.5rem)]:sticky");
  const tall = (px: number) => act(async () => {
    Object.defineProperty(switchBar(), "offsetHeight", { configurable: true, get: () => px });
    window.dispatchEvent(new Event("resize"));
  });
  // jsdom's window is 768 px tall, so the header (44) and the switch may take up to 192 px between them.
  await tall(83);
  expect(sticks()).toBe(true);
  // Text twice the size, from the page's own root font or a reader's style sheet, which the media query cannot see.
  await tall(287);
  expect(sticks()).toBe(false);
  expect(switchBar().className.split(" ")).toContain("md:hidden");
  await tall(148);
  expect(sticks()).toBe(true);
});

/** Whether the browser counts an element's focus as keyboard focus; jsdom's own answer depends on earlier tests' clicks. */
const elementMatches = Element.prototype.matches;
const keyboardFocus = (el: Element, keyboard: boolean) => {
  vi.spyOn(el, "matches").mockImplementation((selector) => (selector === ":focus-visible" ? keyboard : elementMatches.call(el, selector)));
};
const box = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 50, width: 50, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
const place = (el: Element, top: number, height: number) => vi.spyOn(el, "getBoundingClientRect").mockReturnValue(box(top, height));
const refocus = (el: HTMLElement) => act(async () => { el.blur(); el.focus(); });
/**
 * The phone's tree switch as a browser would have it (jsdom has no CSS or layout): shown or not, sticky or scrolling
 * with the trees, `height` px tall, and with its box now at `at`, which the end of the trees can push above where it
 * sticks.
 */
const computedStyle = window.getComputedStyle.bind(window);
function phoneSwitch({ shown = true, position = "sticky", height = 83, at = 44 }: { shown?: boolean; position?: string; height?: number; at?: number } = {}) {
  const bar = switchBar();
  vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => (el === bar ? ({ position } as CSSStyleDeclaration) : computedStyle(el, pseudo)));
  vi.spyOn(bar, "getClientRects").mockReturnValue((shown ? [box(at, height)] : []) as unknown as DOMRectList);
  vi.spyOn(bar, "offsetHeight", "get").mockReturnValue(shown ? height : 0);
  place(bar, at, height);
}

test("a talent that takes keyboard focus under the site header, the stuck tree switch or the cookie banner's strip is scrolled clear", async () => {
  await render();
  const scrollBy = vi.mocked(window.scrollBy);
  keyboardFocus(node(12), true);
  try {
    // The switch stuck under the 44 px header, 83 px tall: a talent at 74 goes down to 8 px below it.
    phoneSwitch();
    place(node(12), 74, 88);
    await refocus(node(12));
    expect(scrollBy).toHaveBeenLastCalledWith(0, 74 - (127 + 8));
    // Clear of everything: left where it is.
    scrollBy.mockClear();
    place(node(12), 300, 88);
    await refocus(node(12));
    expect(scrollBy).not.toHaveBeenCalled();
    // The open banner covers the strip it sets as the page's bottom scroll padding: a talent whose foot is 49 px into
    // that strip comes up by 49 px.
    document.documentElement.style.scrollPaddingBottom = "161px";
    place(node(12), window.innerHeight - 200, 88);
    await refocus(node(12));
    expect(scrollBy).toHaveBeenLastCalledWith(0, 49);
    // Where the switch is not shown (a wide screen), only the site header counts.
    document.documentElement.style.scrollPaddingBottom = "";
    phoneSwitch({ shown: false });
    place(node(12), 20, 88);
    await refocus(node(12));
    expect(scrollBy).toHaveBeenLastCalledWith(0, 20 - (44 + 8));
    // Only talents and the phone's tree Reset: a button in the switch itself is never moved.
    scrollBy.mockClear();
    const option = switchBar().querySelector<HTMLButtonElement>('[aria-label="Show tree"] button')!;
    keyboardFocus(option, true);
    place(option, 0, 40);
    await refocus(option);
    expect(scrollBy).not.toHaveBeenCalled();
    // A press that focuses a half-covered talent leaves it in place, so the release lands on the same talent.
    keyboardFocus(node(12), false);
    await refocus(node(12));
    expect(scrollBy).not.toHaveBeenCalled();
  } finally {
    document.documentElement.style.scrollPaddingBottom = "";
  }
});

test("the end of the trees can push the switch up: a focused talent goes below where it will stick, not where it is", async () => {
  await render();
  keyboardFocus(node(12), true);
  // Pushed to 5–88. Scrolling the talent at 20 only to 8 px below that would leave it under the switch once it drops
  // back to 44–127.
  phoneSwitch({ at: 5 });
  place(node(12), 20, 88);
  await refocus(node(12));
  expect(vi.mocked(window.scrollBy)).toHaveBeenLastCalledWith(0, 20 - (44 + 83 + 8));
});

test("a talent whose foot is in the banner's strip, right under the switch in its own place, comes up out of the strip", async () => {
  await render();
  keyboardFocus(node(12), true);
  document.documentElement.style.scrollPaddingBottom = "161px";
  try {
    // Measured from the switch's box (488–571), the top bound would sit on the talent at 579 and cancel the move.
    phoneSwitch({ at: 488 });
    place(node(12), window.innerHeight - 189, 88);
    await refocus(node(12));
    expect(vi.mocked(window.scrollBy)).toHaveBeenLastCalledWith(0, 88 - 189 + 161);
  } finally {
    document.documentElement.style.scrollPaddingBottom = "";
  }
});

test("where the switch does not stick (a short window, or large text) only the site header counts", async () => {
  await render();
  keyboardFocus(node(12), true);
  // It scrolls with the trees above them, here at 300–383, so it cannot cover a talent.
  phoneSwitch({ position: "static", at: 300 });
  place(node(12), 20, 88);
  await refocus(node(12));
  expect(vi.mocked(window.scrollBy)).toHaveBeenLastCalledWith(0, 20 - (44 + 8));
});

test("the phone's Reset after a tree's talents comes clear of the stuck switch on keyboard focus; the wide screen's does not move", async () => {
  await render();
  await click(node(11));
  const scrollBy = vi.mocked(window.scrollBy);
  const phoneReset = section("Left").querySelector<HTMLButtonElement>("[data-tree-reset]")!;
  const headerReset = [...section("Left").querySelectorAll<HTMLButtonElement>('button[aria-label="Reset Left"]')].find((b) => !b.hasAttribute("data-tree-reset"))!;
  expect(phoneReset.textContent).toBe("Reset Left");
  expect(phoneReset.disabled).toBe(false);
  // The end of the trees has pushed the switch to 17–100, over the Reset at 40–84.
  phoneSwitch({ at: 17 });
  place(phoneReset, 40, 44);
  keyboardFocus(phoneReset, true);
  await refocus(phoneReset);
  expect(scrollBy).toHaveBeenLastCalledWith(0, 40 - (44 + 83 + 8));
  // Focused by a press, it stays put.
  scrollBy.mockClear();
  keyboardFocus(phoneReset, false);
  await refocus(phoneReset);
  expect(scrollBy).not.toHaveBeenCalled();
  // The wide screen's Reset in the tree's heading is not a phone control and is left to the browser.
  place(headerReset, 40, 44);
  keyboardFocus(headerReset, true);
  await refocus(headerReset);
  expect(scrollBy).not.toHaveBeenCalled();
});

test("the phone's tree switch names each tree with its points and shows one tree at a time, with its Reset after its talents", async () => {
  await render();
  const option = (tree: string) => [...switchBar().querySelectorAll('[aria-label="Show tree"] button')].find((b) => b.textContent!.startsWith(tree))!;
  /** The phone's Reset, named in full, after the tree's talents (a wide screen has it in the tree's header). */
  const reset = (tree: string) => [...section(tree).querySelectorAll("button")].find((b) => b.textContent === `Reset ${tree}`)!;
  expect(option("Left").textContent).toBe("Left 0");
  expect(reset("Left").disabled).toBe(true);
  expect(reset("Left").compareDocumentPosition(node(41)) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  await click(node(11));
  expect(option("Left").textContent).toBe("Left 1");
  expect(section("Right").classList.contains("hidden")).toBe(true);
  await click(option("Right"));
  expect(option("Right").getAttribute("aria-pressed")).toBe("true");
  expect(section("Right").classList.contains("hidden")).toBe(false);
  expect(section("Left").classList.contains("hidden")).toBe(true);
  expect(reset("Right").disabled).toBe(true);
  await click(node(51));
  await click(reset("Right"));
  expect(status()).toBe("Right was reset. Undo brings it back.");
  expect(node(51).textContent).toContain("0/5");
  expect(node(11).textContent).toContain("1/5");
});

test("Copy link stays in the build bar beside Save, and without it", async () => {
  await render();
  expect(button(/^Copy link/)?.closest('section[aria-label="Build"]')).not.toBeNull();
  expect(button(/^Save$/)).toBeUndefined();
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Sign in to save builds." }, { status: 401 })));
  try {
    await act(async () => root.render(<TalentCalculator catalog={fixture} savedBuilds />));
    const bar = container.querySelector('section[aria-label="Build"]')!;
    expect(button(/^Save$/)?.closest('section[aria-label="Build"]')).toBe(bar);
    expect(button(/^Copy link/)?.closest('section[aria-label="Build"]')).toBe(bar);
  } finally {
    vi.unstubAllGlobals();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  }
});

test("a saved build's short link shows the build and its points without one editing control, and says why", async () => {
  const one = encodeBuild({ classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks: { 11: { rank: 3 } } });
  await act(async () => root.render(<TalentCalculator catalog={fixture} initialCodes={[one, null]} readOnly />));
  expect(node(11).textContent).toContain("3/5");
  expect(stat("Points left")).toBe("48");
  expect(treeStatus().textContent).toBe("48 left · Set 1");
  for (const label of [/^Undo$/, /^Redo$/, /^Reset/, /Take back/, /^Copy link/, /^Copy for addon/, /^Save on this device$/, /^Create a provisional order$/]) {
    expect(button(label)).toBeUndefined();
  }
  expect(container.querySelector('a[href^="/tools/builds"]')).toBeNull();
  expect(container.querySelector("#spend-order")).toBeNull();
  await click(node(11));
  expect(status()).toBe("This is a saved build. Open it in the calculator to change it.");
  expect(node(11).textContent).toContain("3/5");
});

test("Save on this device hands both sets' exact codes and orders to Plans on this device in the fragment, and reads no saved plan here", async () => {
  const read = vi.spyOn(Storage.prototype, "getItem");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  try {
    await render();
    const share = container.querySelector('[aria-label="Share"]')!;
    expect(container.querySelector('a[href^="/tools/builds"]')).toBeNull();
    expect(button(/^Save on this device$/).disabled).toBe(true);
    expect(share.textContent).toContain("Spend a point in set 1 to save");
    await click(node(11));
    await click(node(11));
    await click(button(/^Set 2$/));
    await click(node(12));
    const codeOf = (ranks: Record<number, { rank: number }>) => encodeBuild({ classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks });
    expect(container.querySelector('a[href^="/tools/builds"]')?.getAttribute("href"))
      .toBe(`/tools/builds#plan=${codeOf({ 11: { rank: 2 } })}&plan2=${codeOf({ 12: { rank: 1 } })}&order=O1p-AA&order2=O1p-A`);
    expect(container.querySelector('a[href^="/tools/builds"]')?.textContent).toBe("Save on this device");
    // Names, notes and the device's saved plans are on the plans page only: nothing here reads them or asks who is signed in.
    expect(read.mock.calls.filter(([key]) => String(key).startsWith("everloot:workspace"))).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(container.querySelector("textarea, select")).toBeNull();
  } finally {
    vi.unstubAllGlobals();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  }
});

test("rewriting the plan in the address keeps the parts it does not own, such as a cookie choice", async () => {
  window.history.replaceState(null, "", "#everloot-analytics-rejected");
  await render();
  await click(node(11));
  const code = encodeBuild({ classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks: { 11: { rank: 1 } } });
  expect(window.location.hash).toBe(`#plan=${code}&order=O1p-A&everloot-analytics-rejected`);
  await click(button(/Reset set 1$/));
  expect(window.location.hash).toBe("#everloot-analytics-rejected");
  // An opened link keeps it too.
  await act(async () => root.unmount());
  root = createRoot(container);
  window.history.replaceState(null, "", `#plan=${code}&everloot-cookie-rejected&order=O1p-A`);
  await render();
  await click(node(11));
  const two = encodeBuild({ classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks: { 11: { rank: 2 } } });
  expect(window.location.hash).toBe(`#plan=${two}&order=O1p-AA&everloot-cookie-rejected`);
});

test("with the game's art the switch's line and the talents' clearance work the same", async () => {
  const file = (name: string) => ({ file: name, width: 50, height: 50 });
  const frames = Object.fromEntries(["circle", "square"].flatMap((s) => ["gray", "green", "yellow"].map((st) => [`talents-node-${s}-${st}`, file(`frames/${s}-${st}.webp`)])));
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "https://assets.example.test/b");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    schema: "everloot.game-assets/1", label: "test", build: { version: "9.9.9.1", buildId: 1 },
    spells: { 1: { name: "x", icon: null, passive: null, description: null } }, frames, backgrounds: {},
  })));
  try {
    await render();
    expect(container.querySelector("[data-game-look]")).not.toBeNull();
    await click(node(11));
    expect(treeStatus().textContent).toBe("50 left · Set 1");
    expect(liveRegions()).toHaveLength(1);
    // A game-art node under the stuck switch moves clear of it too.
    phoneSwitch();
    place(node(12), 100, 50);
    keyboardFocus(node(12), true);
    await act(async () => { node(12).focus(); });
    expect(vi.mocked(window.scrollBy)).toHaveBeenLastCalledWith(0, 100 - (127 + 8));
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  }
});

// Links are read a whole value at a time; lib/talents/plan-links.test.ts has the reader's own cases.

const NOT_A_CODE = "That is not a share code. Codes start with EL1 and use letters, digits, - and _ only.";
const DAMAGED_ORDER = "The plan's spend order is damaged, so the order is unknown. The talents still loaded.";
const loadedList = () => [...container.querySelectorAll('[aria-label="What loaded"] li')].map((li) => li.textContent);
const spendOrder = () => container.querySelector("#spend-order")!.closest("section")!;
async function paste(text: string) {
  const box = container.querySelector<HTMLInputElement>("#talent-paste")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(button(/^Load into set/));
}

test("an address whose code is damaged after a valid start is refused, on opening and in an open tab, and loads nothing", async () => {
  const code = encodeBuild({ classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks: { 11: { rank: 3 } } });
  window.location.hash = `#plan=${code}!damaged`;
  await render();
  expect(status()).toBe(NOT_A_CODE);
  expect(node(11).textContent).toContain("0/5");
  // In an open tab, a value with a valid code inside it changes nothing either.
  await click(node(12));
  await act(async () => {
    window.location.hash = `#plan=${code}!damaged?plan=${code}!tail`;
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(status()).toBe(NOT_A_CODE);
  expect([node(11).textContent, node(12).textContent]).toEqual([expect.stringContaining("0/5"), expect.stringContaining("1/5")]);
});

test("a damaged order in the address keeps the talents with the order unknown, and stays as it came in the address and the build link", async () => {
  const code = encodeBuild({ classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks: { 11: { rank: 3 } } });
  window.location.hash = `#plan=${code}&order=O1p-AAA!damaged`;
  await render();
  expect(node(11).textContent).toContain("3/5");
  expect(status()).toBe("Loaded from the link with changes. The list below says what.");
  expect(loadedList()).toEqual([DAMAGED_ORDER]);
  expect(spendOrder().textContent).toContain("Spend order unknown.");
  // So a reload, or the link handed out, says the same.
  const link = () => container.querySelector<HTMLInputElement>("#talent-link")!.value;
  expect(window.location.hash).toBe(`#plan=${code}&order=O1p-AAA!damaged`);
  expect(link()).toBe(`${window.location.origin}/tools/talents/mage/b/${code}#order=O1p-AAA!damaged`);
  // An order that would end its part early goes back in escaped.
  await act(async () => root.unmount());
  root = createRoot(container);
  window.location.hash = `#plan=${code}&order=O1p-AA%26A`;
  await render();
  expect(loadedList()).toEqual([DAMAGED_ORDER]);
  expect(window.location.hash).toBe(`#plan=${code}&order=O1p-AA%26A`);
  expect(link()).toBe(`${window.location.origin}/tools/talents/mage/b/${code}#order=O1p-AA%26A`);
});

test("the import box refuses a damaged link as a whole, and still reads one copied with spaces around it", async () => {
  const code = encodeBuild({ classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks: { 11: { rank: 3 } } });
  await render();
  for (const text of [`https://everloot.app/tools/talents/mage#plan=${code}!damaged&order=O1p-AAA`, `${code}!damaged?plan=${code}!tail`]) {
    await paste(text);
    expect(status(), text).toBe(NOT_A_CODE);
    expect(node(11).textContent, text).toContain("0/5");
  }
  await paste(`  https://everloot.app/tools/talents/mage#plan=${code}&order=O1p-AAA `);
  expect(status()).toBe("Build loaded.");
  expect(node(11).textContent).toContain("3/5");
  expect(spendOrder().textContent).toContain("Planned order.");
});

test("the import box loads the calculator's own build link with its order, and refuses another class's and a saved build's", async () => {
  await render();
  await click(node(11));
  await click(node(11));
  await click(node(12));
  const handedOut = container.querySelector<HTMLInputElement>("#talent-link")!.value;
  expect(handedOut).toMatch(/\/tools\/talents\/mage\/b\/EL1-[^#]+#order=O1p-AAB$/);
  await click(button(/Reset set 1$/));
  expect(node(11).textContent).toContain("0/5");
  await paste(handedOut);
  expect(status()).toBe("Build loaded.");
  expect([node(11).textContent, node(12).textContent]).toEqual([expect.stringContaining("2/5"), expect.stringContaining("1/5")]);
  expect(spendOrder().textContent).toContain("Planned order.");
  const druid = encodeBuild({ classSlug: "druid", specId: 0, build: "1.0.0.1", ranks: { 11: { rank: 1 } } });
  await paste(`https://everloot.app/tools/talents/druid/b/${druid}`);
  expect(status()).toBe("That code is for a different class. Open this class's calculator to load it.");
  await paste("https://everloot.app/b/abcd1234");
  expect(status()).toBe("That link names a saved build, not its talents, so it cannot load here. Open the link, then choose Open in the calculator.");
  expect(node(11).textContent).toContain("2/5");
});

test("the class page keeps its lede in the page but drops it below the phone breakpoint (class proxy)", async () => {
  const page = new DOMParser().parseFromString(renderToStaticMarkup(await TalentClassView({ slug: "mage" })), "text/html");
  const lede = page.querySelector("[data-page-header] p")!;
  expect(lede.textContent).toMatch(/^Plan Mage talents for WoW: Forever: 51 points at level 60 across Arcane, Fire and Frost/);
  expect(lede.firstElementChild?.className).toBe("hidden sm:inline");
  // The title and the class strip stay on every screen.
  expect(page.querySelector("h1")?.textContent).toBe("WoW Forever Mage Talent Calculator");
  expect(page.querySelector('nav[aria-label="Classes"] a[aria-current="page"]')?.getAttribute("href")).toBe("/tools/talents/mage");
});
