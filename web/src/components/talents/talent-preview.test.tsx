// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fixture } from "@/lib/talents/fixture";
import { canMovePoint, orderRefusalText } from "@/lib/talents/order";
import { encodeBuild, encodeOrder } from "@/lib/talents/share";
import type { Ranks, TalentCatalog } from "@/lib/talents/types";
import TalentCalculator from "./TalentCalculator";

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

// The order preview and the order's moves, on the made-up test tree (lib/talents/fixture.ts, not game data): row 1 of
// Left holds 11 and 12, its row 2 (21, 22) opens at 5 points above and 22 also needs 12 at full rank, 52 wants 6
// points spent anywhere else and 55 wants 2 ranks in 51. Each point arrives one level after the last from level 10,
// so the k-th is level 9 + k, and the second set opens at level 40, when the first 31 points are there.

const code = (ranks: Ranks) => encodeBuild({ classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks });
const ranksOf = (order: number[]): Ranks => {
  const out: Ranks = {};
  for (const id of order) out[id] = { rank: (out[id]?.rank ?? 0) + 1, ...(id === 32 ? { choice: 0 } : {}) };
  return out;
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no scrollBy, and the calculator calls it whenever a talent takes keyboard focus out of place.
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  window.history.replaceState(null, "", "/tools/talents/mage");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
  document.documentElement.style.scrollPaddingBottom = "";
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const render = (catalog: TalentCatalog = fixture) => act(async () => root.render(<TalentCalculator catalog={catalog} />));
async function open(fragment: string, catalog?: TalentCatalog) {
  window.history.replaceState(null, "", `/tools/talents/mage${fragment}`);
  await render(catalog);
}
async function remount() {
  await act(async () => root.unmount());
  root = createRoot(container);
  window.history.replaceState(null, "", "/tools/talents/mage");
}
const node = (id: number) => container.querySelector<HTMLButtonElement>(`#talent-${id}`)!;
/** The rank a talent's tile shows, as "2/5" (the tile's mono line; its name comes first). */
const shown = (id: number) => /\d+\/\d+/.exec(node(id).querySelector(".font-mono")!.textContent!)![0];
const status = () => container.querySelector('[role="status"]')!.textContent;
const button = (label: RegExp, scope: ParentNode = container) => [...scope.querySelectorAll("button")].find((b) => label.test(b.textContent?.trim() ?? ""));
const labelled = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = (el: Element | undefined | null) => act(async () => {
  if (!el) throw new Error("Nothing to click");
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
});
const spend = async (...ids: number[]) => { for (const id of ids) await click(id === 32 ? container.querySelector("#talent-32-0") : node(id)); };
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); });
const hash = () => window.location.hash;

/** The spend order under the trees, its preview switch and the preview's own panel. */
const order = () => container.querySelector("#spend-order")!.closest("section")!;
const steps = () => [...order().querySelectorAll("ol li")].map((li) => li.textContent);
const previewSwitch = () => button(/^Preview point by point/)!;
const panel = () => container.querySelector('[role="group"][aria-label="Spend order preview"]');
const slider = () => container.querySelector<HTMLInputElement>('input[type="range"][aria-label="Point to preview"]')!;
const slide = (value: number) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider(), String(value));
  slider().dispatchEvent(new Event("input", { bubbles: true }));
});
const next = () => click(labelled("Next point"));
/** A point's arrow in the order list: "Talent 12, rank 1" moved "earlier" or "later". */
const arrow = (point: string, way: "earlier" | "later") => labelled(`Move ${point} ${way}`);
const current = () => [...container.querySelectorAll('[aria-current="step"]')].map((el) => el.id);
const PREVIEW_ONLY = "This is a preview. Turn it off to change points.";

// The preview: each prefix of the order in the trees, read only.

test("the preview steps through every prefix of the order: each talent's rank in the trees, and the level that point comes at", async () => {
  const spent = [11, 12, 11, 11, 11, 21, 11];
  await render();
  await spend(...spent);
  expect(panel()).toBeNull();
  expect(previewSwitch().getAttribute("aria-pressed")).toBe("false");
  await click(previewSwitch());
  expect(previewSwitch().getAttribute("aria-pressed")).toBe("true");
  expect(previewSwitch().textContent).toBe("Preview point by point: on");
  expect(status()).toBe("Preview on. Point 1 of 7, level 10: Talent 11, rank 1.");
  const names = ["Talent 11, rank 1", "Talent 12, rank 1", "Talent 11, rank 2", "Talent 11, rank 3", "Talent 11, rank 4", "Talent 21, rank 1", "Talent 11, rank 5"];
  for (let k = 1; k <= spent.length; k++) {
    if (k > 1) await next();
    const before = spent.slice(0, k);
    for (const id of [11, 12, 21]) expect(shown(id), `${id} after ${k} points`).toBe(`${before.filter((n) => n === id).length}/5`);
    expect(panel()!.textContent).toContain(`Point ${k} of 7, level ${9 + k}: ${names[k - 1]}.`);
    expect(panel()!.textContent).toContain(`Points by tree: Left ${k}, Right 0.`);
    expect(slider().value).toBe(String(k));
    expect(slider().getAttribute("aria-valuetext")).toBe(`Point ${k} of 7, level ${9 + k}: ${names[k - 1]}`);
    if (k > 1) expect(status()).toBe(`Point ${k} of 7, level ${9 + k}: ${names[k - 1]}.`);
    // The tree is as it stood then: before the fifth point in row 1, row 2 is still shut, and at the fifth (level 14)
    // it is open but that level's points are all spent.
    if (k === 4) expect(node(21).getAttribute("aria-label")).toContain("locked. Needs 5 points spent in Left on rows above.");
    if (k === 5) expect(node(21).getAttribute("aria-label")).toContain("locked. No points left at this level.");
  }
  // Back a step, and straight to any point with the preview's own slider.
  await click(labelled("Previous point"));
  expect(panel()!.textContent).toContain("Point 6 of 7, level 15: Talent 21, rank 1.");
  await slide(3);
  expect(shown(11)).toBe("2/5");
  expect(shown(12)).toBe("1/5");
  expect(shown(21)).toBe("0/5");
  // It is not the level slider: that one keeps its value, and moving it leaves the preview where it is.
  const level = container.querySelector<HTMLInputElement>('input[aria-label="Character level"]')!;
  expect(level.value).toBe("60");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(level, "45");
    level.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(panel()!.textContent).toContain("Point 3 of 7, level 12: Talent 11, rank 2.");
  // Turned off, the trees show the whole set again.
  await click(previewSwitch());
  expect(panel()).toBeNull();
  expect(status()).toBe("Preview off. The trees show the whole set again.");
  expect(shown(11)).toBe("5/5");
  expect(shown(21)).toBe("1/5");
});

/** 34 points that use every kind of gate in the test tree, in an order its rules allow. */
const LONG = [11, 11, 11, 11, 11, 12, 12, 12, 12, 12, 21, 21, 21, 21, 21, 22, 31, 31, 31, 31, 31, 41, 32, 51, 51, 51, 51, 51, 53, 53, 53, 52, 54, 55];

test("set 2's points wait for the level the second set opens at: its first 31 points all come at level 40", async () => {
  const c = code(ranksOf(LONG));
  const token = encodeOrder(ranksOf(LONG), LONG, "planned")!;
  await open(`#plan=${c}&plan2=${c}&order=${token}&order2=${token}`);
  // Set 1: one point a level from level 10.
  expect(steps()[0]).toBe("Level 10: Talent 11, rank 1");
  expect(order().textContent).not.toContain("Set 2 opens at level 40");
  await click(button(/^Set 2$/));
  expect(steps()[0]).toBe("Level 40: Talent 11, rank 1");
  expect(steps()[30]).toBe("Level 40: Tier two, rank 3");
  expect(steps()[31]).toBe("Level 41: Talent 52, rank 1");
  expect(steps()[33]).toBe("Level 43: Talent 55, rank 1");
  expect(order().textContent).toContain("Set 2 opens at level 40, so its first 31 points all come at level 40. That level is from the beta notes, not the game files.");
  await click(previewSwitch());
  expect(panel()!.textContent).toContain("Point 1 of 34, level 40: Talent 11, rank 1.");
  // At level 40 the character has 31 points for set 2, so after the first one the rest of row 1 is still open.
  expect(node(12).getAttribute("aria-label")).toContain("can take a point");
  await slide(31);
  expect(panel()!.textContent).toContain("Point 31 of 34, level 40: Tier two, rank 3.");
  expect(shown(53)).toBe("3/3");
  expect(shown(52)).toBe("0/1");
  await next();
  expect(panel()!.textContent).toContain("Point 32 of 34, level 41: Talent 52, rank 1.");
  expect(shown(52)).toBe("1/1");
});

/** A figure in the build bar by its label: "Points left", "Level needed". */
const stat = (label: string) => [...container.querySelectorAll("span")].find((s) => s.textContent === label)!.nextElementSibling!.textContent;

test("the build bar's Level needed is the level the set's last point comes at, set 2's no sooner than it opens", async () => {
  await render();
  await spend(11, 11, 11, 11, 11);
  expect(stat("Level needed")).toBe("14");
  await click(button(/^Set 2$/));
  expect(stat("Level needed")).toBe("–");
  await spend(11, 11, 11, 11, 11);
  expect(stat("Level needed")).toBe("40");
  // The level slider keeps its own meaning, the points a level gives: it goes down to 20, which holds both sets' five
  // points, and set 2 planned ahead still needs level 40.
  const level = container.querySelector<HTMLInputElement>('input[aria-label="Character level"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(level, "20");
    level.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(level.value).toBe("20");
  await click([...container.querySelectorAll("label")].find((l) => l.textContent!.startsWith("Plan set 2 now"))!.querySelector("input"));
  await click(button(/^Set 2$/));
  expect(stat("Points left")).toBe("6");
  expect(stat("Level needed")).toBe("40");
  await click(button(/^Set 1$/));
  expect(stat("Level needed")).toBe("14");
});

test("a take-back in set 2 that reorders points gives the levels set 2's points come at", async () => {
  await render();
  await click(button(/^Set 2$/));
  await spend(11, 11, 11, 11, 12, 21, 51, 11);
  await act(async () => { node(12).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
  expect([...order().querySelectorAll("ul li")].map((li) => li.textContent)).toEqual([
    "Talent 21, rank 1: was level 40, now level 40",
    "Talent 51, rank 1: was level 40, now level 40",
    "Talent 11, rank 5: was level 40, now level 40",
  ]);
});

test("the previewed point's talent is the current step, the chosen entry of a choice, and nothing is marked without a preview", async () => {
  await render();
  await spend(11, 11, 11, 11, 11, 12, 12, 12, 12, 12);
  await click(container.querySelector("#talent-32-1"));
  expect(current()).toEqual([]);
  await click(previewSwitch());
  expect(current()).toEqual(["talent-11"]);
  await slide(10);
  expect(current()).toEqual(["talent-12"]);
  expect(node(12).closest("[data-highlighted]")).not.toBeNull();
  await slide(11);
  // The point bought Choice B, so its entry is the step; the node as a whole carries the mark.
  expect(current()).toEqual(["talent-32-1"]);
  expect(container.querySelector("#talent-32-1")!.closest("[data-highlighted]")).not.toBeNull();
  expect(container.querySelectorAll("[data-highlighted]")).toHaveLength(1);
  await click(previewSwitch());
  expect(current()).toEqual([]);
  expect(container.querySelectorAll("[data-highlighted]")).toHaveLength(0);
});

test("with the game's art the preview shows each prefix and marks its point the same way", async () => {
  const file = (name: string) => ({ file: name, width: 50, height: 50 });
  const frames = Object.fromEntries(["circle", "square"].flatMap((s) => ["gray", "green", "yellow"].map((st) => [`talents-node-${s}-${st}`, file(`frames/${s}-${st}.webp`)])));
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "https://assets.example.test/b");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    schema: "everloot.game-assets/1", label: "test", build: { version: "9.9.9.1", buildId: 1 },
    spells: { 1: { name: "x", icon: null, passive: null, description: null } }, frames, backgrounds: {},
  })));
  await render();
  expect(container.querySelector("[data-game-look]")).not.toBeNull();
  await spend(11, 12, 11);
  await click(previewSwitch());
  await next();
  expect(current()).toEqual(["talent-12"]);
  expect(node(11).getAttribute("aria-label")).toContain("rank 1 of 5");
  expect(node(12).getAttribute("aria-label")).toContain("rank 1 of 5");
  expect(node(12).closest("[data-highlighted]")).not.toBeNull();
  expect(container.querySelectorAll("[data-highlighted]")).toHaveLength(1);
});

test("nothing changes the plan while the preview is on: talents, take-backs, keys, Undo, Redo, the resets, Load and the moves", async () => {
  await render();
  await spend(11, 12, 11, 12);
  await click(button(/^Undo$/));
  const plan = hash();
  await click(previewSwitch());
  await next();
  const still = async () => {
    expect(status()).toBe(PREVIEW_ONLY);
    expect(hash()).toBe(plan);
    expect(panel()!.textContent).toContain("Point 2 of 3, level 11: Talent 12, rank 1.");
    expect([shown(11), shown(12), shown(21)]).toEqual(["1/5", "1/5", "0/5"]);
  };
  await click(node(11));
  await still();
  await click(node(21));
  await still();
  await act(async () => { node(11).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
  await still();
  await key(node(12), "Delete");
  await still();
  await key(node(12), "z", { ctrlKey: true });
  await still();
  await key(node(12), "y", { ctrlKey: true });
  await still();
  // The take-back switch only says what a click does; the click is still refused.
  await click(button(/Take points back/));
  await click(node(11));
  await still();
  await click(button(/Take points back/));
  for (const label of [/^Undo$/, /^Redo$/, /Reset set 1$/, /^Reset Left$/, /^Load into set 1$/]) {
    expect(button(label)!.disabled, String(label)).toBe(true);
  }
  for (const reset of container.querySelectorAll<HTMLButtonElement>('button[aria-label="Reset Left"]')) expect(reset.disabled).toBe(true);
  for (const move of container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Move "]')) expect(move.disabled).toBe(true);
  // Turned off, the plan is as it was, with its undo and redo steps.
  await click(previewSwitch());
  expect(hash()).toBe(plan);
  expect([shown(11), shown(12)]).toEqual(["2/5", "1/5"]);
  await click(button(/^Redo$/));
  expect(shown(12)).toBe("2/5");
});

/** A finger, not a mouse, pressing a talent: the start of a long press, which takes a point back after half a second. */
const touchDown = (el: Element) => act(async () => {
  const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerType", { value: "touch" });
  el.dispatchEvent(event);
});

test("a long press begun before the preview turned on takes nothing back once it is on", async () => {
  await render();
  await spend(11, 11);
  const plan = hash();
  vi.useFakeTimers();
  await touchDown(node(11));
  await click(previewSwitch());
  await act(async () => { vi.advanceTimersByTime(600); });
  expect(hash()).toBe(plan);
  expect(panel()).not.toBeNull();
  expect(status()).toBe("Preview on. Point 1 of 2, level 10: Talent 11, rank 1.");
  await click(previewSwitch());
  expect(shown(11)).toBe("2/5");
  // And the press left no undo step: Undo takes back the second point spent.
  await click(button(/^Undo$/));
  expect(shown(11)).toBe("1/5");
});

test("turning the preview on or off cancels a long press under way", async () => {
  await render();
  await spend(11, 11);
  vi.useFakeTimers();
  await touchDown(node(11));
  expect(vi.getTimerCount()).toBe(1);
  await click(previewSwitch());
  expect(vi.getTimerCount()).toBe(0);
  await touchDown(node(11));
  expect(vi.getTimerCount()).toBe(1);
  await click(previewSwitch());
  expect(vi.getTimerCount()).toBe(0);
});

test("a preview ends when the set on screen changes, and does not come back with it", async () => {
  await render();
  await spend(11, 12);
  await click(button(/^Set 2$/));
  await spend(11);
  await click(button(/^Set 1$/));
  await click(previewSwitch());
  expect(shown(12)).toBe("0/5");
  await click(button(/^Set 2$/));
  expect(panel()).toBeNull();
  expect(previewSwitch().getAttribute("aria-pressed")).toBe("false");
  await click(button(/^Set 1$/));
  expect(panel()).toBeNull();
  expect(shown(12)).toBe("1/5");
  // A link opened in the address over a preview ends it too.
  await click(previewSwitch());
  await act(async () => {
    window.location.hash = `#plan=${code({ 11: { rank: 3 } })}&order=O1p-AAA`;
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(panel()).toBeNull();
  expect(shown(11)).toBe("3/5");
});

test("an unknown order has no preview and no moves", async () => {
  await open(`#plan=${code({ 11: { rank: 2 } })}`);
  expect(order().textContent).toContain("Spend order unknown.");
  expect(button(/^Preview point by point/)).toBeUndefined();
  expect(container.querySelector('button[aria-label^="Move "]')).toBeNull();
});

// Moves: one place earlier or later, through the order engine.

test("a point moves one place earlier or later through the order engine; the address, the list and its levels follow, and Undo puts it back", async () => {
  await render();
  await spend(11, 12);
  const asSpent = `#plan=${code({ 11: { rank: 1 }, 12: { rank: 1 } })}&order=O1p-AB`;
  expect(hash()).toBe(asSpent);
  await click(arrow("Talent 12, rank 1", "earlier"));
  expect(status()).toBe("Talent 12, rank 1 is now point 1, at level 10.");
  expect(hash()).toBe(`#plan=${code({ 11: { rank: 1 }, 12: { rank: 1 } })}&order=O1p-BA`);
  expect(steps()).toEqual(["Level 10: Talent 12, rank 1", "Level 11: Talent 11, rank 1"]);
  expect(order().textContent).toContain("Planned order.");
  await click(arrow("Talent 12, rank 1", "later"));
  expect(status()).toBe("Talent 12, rank 1 is now point 2, at level 11.");
  expect(hash()).toBe(asSpent);
  await click(button(/^Undo$/));
  expect(steps()).toEqual(["Level 10: Talent 12, rank 1", "Level 11: Talent 11, rank 1"]);
  await click(button(/^Undo$/));
  expect(hash()).toBe(asSpent);
});

test("a move keeps a provisional order provisional", async () => {
  await open(`#plan=${code({ 11: { rank: 2 }, 12: { rank: 1 } })}`);
  await click(button(/^Create a provisional order$/));
  expect(hash()).toContain("&order=O1g-AAB");
  await click(arrow("Talent 12, rank 1", "earlier"));
  expect(hash()).toContain("&order=O1g-ABA");
  expect(order().textContent).toContain("Provisional order.");
});

/** What the order engine says about moving the point at `from` to `to` in this order. */
function engineSays(catalog: TalentCatalog, spent: number[], from: number, to: number) {
  const set = { ranks: ranksOf(spent), order: spent, orderOrigin: "planned" as const };
  const verdict = canMovePoint(catalog, set, from, to);
  if (!verdict || verdict.ok) throw new Error("The engine allows that move");
  const tried = [...spent];
  tried.splice(to, 0, ...tried.splice(from, 1));
  return orderRefusalText(catalog, set.ranks, tried, verdict);
}

test("a refused move names the talent and the gate in the order engine's own words, and changes nothing", async () => {
  const cases: { spent: number[]; point: string; way: "earlier" | "later"; from: number; says: string }[] = [
    // Row 2 opens at 5 points above: 21 cannot come before the fifth, and the fifth cannot go after 21.
    { spent: [11, 11, 11, 11, 11, 21], point: "Talent 21, rank 1", way: "earlier", from: 5, says: "Talent 21 at level 14: Needs 5 points spent in Left on rows above." },
    { spent: [11, 11, 11, 11, 11, 21], point: "Talent 11, rank 5", way: "later", from: 4, says: "Talent 21 at level 14: Needs 5 points spent in Left on rows above." },
    // 22 needs 12 at full rank.
    { spent: [12, 12, 12, 12, 12, 22], point: "Talent 22, rank 1", way: "earlier", from: 5, says: "Talent 22 at level 14: Needs the talent above it at full rank." },
    // 55 needs 2 ranks in 51.
    { spent: [51, 51, 55], point: "Talent 55, rank 1", way: "earlier", from: 2, says: "Talent 55 at level 11: Needs 2 ranks in Talent 51." },
    // 52 needs 6 points spent anywhere else.
    { spent: [51, 51, 51, 51, 51, 11, 52], point: "Talent 52, rank 1", way: "earlier", from: 6, says: "Talent 52 at level 15: Needs 6 points spent in the class's trees." },
  ];
  for (const { spent, point, way, from, says } of cases) {
    await remount();
    await render();
    await spend(...spent);
    const plan = hash();
    const to = way === "earlier" ? from - 1 : from + 1;
    expect(engineSays(fixture, spent, from, to)).toBe(says);
    await click(arrow(point, way));
    expect(status(), point).toBe(`${point} stays at point ${from + 1}. ${says}`);
    expect(hash()).toBe(plan);
    // The refusal left no undo step: Undo takes back the last point spent.
    const last = spent[spent.length - 1];
    await click(button(/^Undo$/));
    expect(shown(last)).toBe(`${spent.filter((id) => id === last).length - 1}/${fixture.nodes.find((n) => n.id === last)!.maxRanks}`);
  }
});

test("a refused move also says why under its own row, for the eye, until the set changes", async () => {
  await render();
  await spend(11, 11, 11, 11, 11, 21);
  const note = () => order().querySelector("[data-move-refusal]");
  expect(note()).toBeNull();
  await click(arrow("Talent 21, rank 1", "earlier"));
  // The status line reads it out; this copy is beside the arrow that was pressed, far from the status line on a phone.
  expect(note()!.textContent).toBe(status());
  expect(note()!.getAttribute("aria-hidden")).toBe("true");
  expect(note()!.closest("li")!.querySelector('button[aria-label="Move Talent 21, rank 1 earlier"]')).not.toBeNull();
  expect(container.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"]')).toHaveLength(1);
  // Nothing to move is said there too.
  await click(arrow("Talent 11, rank 1", "earlier"));
  expect(note()!.textContent).toBe("Talent 11, rank 1 is already the first point.");
  expect(order().querySelectorAll("[data-move-refusal]")).toHaveLength(1);
  // Any change to the set takes it away, and Undo back to that set does not bring it back.
  await spend(12);
  expect(note()).toBeNull();
  await click(button(/^Undo$/));
  expect(note()).toBeNull();
});

test("in set 2 a move and a refusal give the level set 2's point comes at", async () => {
  await render();
  await click(button(/^Set 2$/));
  await spend(11, 11, 11, 11, 11, 21);
  await click(arrow("Talent 21, rank 1", "earlier"));
  expect(status()).toBe("Talent 21, rank 1 stays at point 6. Talent 21 at level 40: Needs 5 points spent in Left on rows above.");
  await spend(12);
  await click(arrow("Talent 12, rank 1", "earlier"));
  expect(status()).toBe("Talent 12, rank 1 is now point 6, at level 40.");
});

test("a move with nothing to move says so: the first point earlier, the last later, or past a point of the same talent", async () => {
  await render();
  await spend(11, 11, 12);
  const plan = hash();
  const said: [string, "earlier" | "later", string][] = [
    ["Talent 11, rank 1", "earlier", "Talent 11, rank 1 is already the first point."],
    ["Talent 12, rank 1", "later", "Talent 12, rank 1 is already the last point."],
    ["Talent 11, rank 2", "earlier", "Talent 11, rank 2 stays at point 2: the point before it is on the same talent."],
    ["Talent 11, rank 1", "later", "Talent 11, rank 1 stays at point 1: the point after it is on the same talent."],
  ];
  for (const [point, way, text] of said) {
    expect(arrow(point, way).getAttribute("aria-disabled"), `${point} ${way}`).toBe("true");
    await click(arrow(point, way));
    expect(status()).toBe(text);
  }
  expect(arrow("Talent 12, rank 1", "earlier").getAttribute("aria-disabled")).toBe("false");
  expect(hash()).toBe(plan);
  await click(button(/^Undo$/));
  expect(shown(12)).toBe("0/5");
});

test("keyboard focus stays with the moved point's arrow through moves and refusals", async () => {
  await render();
  await spend(11, 12, 51);
  const rowOf = (el: Element) => [...order().querySelectorAll("ol li")].indexOf(el.closest("li")!);
  const up = arrow("Talent 51, rank 1", "earlier");
  await act(async () => { up.focus(); });
  await click(up);
  expect(document.activeElement).toBe(arrow("Talent 51, rank 1", "earlier"));
  expect(rowOf(document.activeElement!)).toBe(1);
  await click(document.activeElement!);
  expect(rowOf(document.activeElement!)).toBe(0);
  expect(document.activeElement!.getAttribute("aria-label")).toBe("Move Talent 51, rank 1 earlier");
  // Refused: already first. Focus stays on the same arrow.
  await click(document.activeElement!);
  expect(status()).toBe("Talent 51, rank 1 is already the first point.");
  expect(document.activeElement!.getAttribute("aria-label")).toBe("Move Talent 51, rank 1 earlier");
  // Later, past a point: the row itself moves down and keeps the focus.
  const down = arrow("Talent 11, rank 1", "later");
  await act(async () => { down.focus(); });
  await click(down);
  expect(steps()).toEqual(["Level 10: Talent 51, rank 1", "Level 11: Talent 12, rank 1", "Level 12: Talent 11, rank 1"]);
  expect(document.activeElement!.getAttribute("aria-label")).toBe("Move Talent 11, rank 1 later");
  expect(rowOf(document.activeElement!)).toBe(2);
});

/** Whether the browser counts an element's focus as keyboard focus; jsdom's own answer depends on earlier clicks. */
const elementMatches = Element.prototype.matches;
const keyboardFocus = (el: Element, keyboard: boolean) => {
  vi.spyOn(el, "matches").mockImplementation((selector) => (selector === ":focus-visible" ? keyboard : elementMatches.call(el, selector)));
};
const place = (el: Element, top: number, height: number) => vi.spyOn(el, "getBoundingClientRect").mockReturnValue(
  { top, bottom: top + height, left: 0, right: 44, width: 44, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect,
);

test("a moved point's arrow that lands under the cookie banner's strip or the site header comes clear on keyboard focus only", async () => {
  await render();
  await spend(11, 12, 51);
  const scrollBy = vi.mocked(window.scrollBy);
  document.documentElement.style.scrollPaddingBottom = "161px";
  const down = arrow("Talent 11, rank 1", "later");
  keyboardFocus(down, true);
  await act(async () => { down.focus(); });
  // After the move its row is 25 px into the strip the open banner covers.
  place(down, window.innerHeight - 180, 44);
  scrollBy.mockClear();
  await click(down);
  expect(scrollBy).toHaveBeenLastCalledWith(0, 25);
  // Under the 44 px site header: down to 8 px below it.
  const up = arrow("Talent 11, rank 1", "earlier");
  keyboardFocus(up, true);
  await act(async () => { up.focus(); });
  place(up, 20, 44);
  await click(up);
  expect(scrollBy).toHaveBeenLastCalledWith(0, 20 - (44 + 8));
  // Moved by a press, the page stays where it is.
  keyboardFocus(down, false);
  await act(async () => { down.focus(); });
  scrollBy.mockClear();
  await click(down);
  expect(steps()[1]).toBe("Level 11: Talent 11, rank 1");
  expect(scrollBy).not.toHaveBeenCalled();
});

// Layout: what jsdom can pin; the widths themselves are measured in a browser.

test("a previewed talent out of sight in its tree's sideways scroll comes into it, and the page does not move", async () => {
  await render();
  await spend(11, 12);
  // Three trees side by side on a tablet: this one shows 219 px of its talents, and 12 sits past that.
  const box = node(12).closest<HTMLElement>("[data-tree-scroll]")!;
  let left = 0;
  Object.defineProperty(box, "scrollLeft", { configurable: true, get: () => left, set: (v: number) => { left = v; } });
  const rect = (x: number, width: number) => ({ left: x, right: x + width, top: 0, bottom: 50, width, height: 50, x, y: 0, toJSON: () => ({}) }) as DOMRect;
  vi.spyOn(box, "getBoundingClientRect").mockReturnValue(rect(0, 219));
  vi.spyOn(node(11), "getBoundingClientRect").mockReturnValue(rect(30, 50));
  vi.spyOn(node(12), "getBoundingClientRect").mockReturnValue(rect(250, 50));
  const scrollBy = vi.mocked(window.scrollBy);
  scrollBy.mockClear();
  await click(previewSwitch());
  expect(left).toBe(0);
  await next();
  // Its right edge comes 16 px inside the tree's: 300 - (219 - 16).
  expect(left).toBe(97);
  expect(scrollBy).not.toHaveBeenCalled();
});

test("the preview and the order list sit under the trees, outside the phone's sticky switch, and add no live region", async () => {
  await render();
  await spend(11, 12);
  await click(previewSwitch());
  const bar = container.querySelector("[data-tree-status]")!.parentElement!;
  expect(bar.parentElement!.contains(panel())).toBe(false);
  expect(bar.parentElement!.contains(order().querySelector("ol"))).toBe(false);
  expect(container.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"]')).toHaveLength(1);
});

test("on a phone the switch shows the previewed point's tree, and its line says which point is shown", async () => {
  await render();
  await spend(11, 51, 11);
  const section = (tree: string) => container.querySelector(`section[aria-label="${tree}"]`)!;
  const line = () => container.querySelector("[data-tree-status]")!;
  const bar = () => line().parentElement!;
  expect(line().textContent).toBe("48 left · Set 1");
  await click(previewSwitch());
  expect(line().textContent).toBe("Set 1 preview · point 1 of 3 · level 10");
  expect(line().getAttribute("aria-hidden")).toBe("true");
  await next();
  expect(section("Right").classList.contains("hidden")).toBe(false);
  expect(section("Left").classList.contains("hidden")).toBe(true);
  // The switch names each tree with the points the preview shows in it.
  const option = (tree: string) => [...bar().querySelectorAll('[aria-label="Show tree"] button')].find((b) => b.textContent!.startsWith(tree))!;
  expect(option("Left").textContent).toBe("Left 1");
  expect(option("Right").textContent).toBe("Right 1");
  await next();
  expect(section("Left").classList.contains("hidden")).toBe(false);
  expect(option("Left").textContent).toBe("Left 2");
});

/** The test tree with a talent whose name is one long word and another of many words. */
const long: TalentCatalog = {
  ...fixture,
  nodes: fixture.nodes.map((n) => n.id === 11 ? { ...n, entries: [{ ...n.entries[0], name: "Supercalifragilisticexpialidociousness" }] }
    : n.id === 12 ? { ...n, entries: [{ ...n.entries[0], name: "Improved Blessing of the Long Winter Night's Watch" }] } : n),
};

test("a long talent name wraps in the order list and the preview, and its arrows stay beside it (class proxy)", async () => {
  await render(long);
  await spend(11, 12);
  await click(previewSwitch());
  const row = order().querySelector("ol li")!;
  const text = [...row.querySelectorAll("span")].find((s) => s.textContent!.includes("Supercalifragilisticexpialidociousness"))!;
  expect(text.className.split(" ")).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "[overflow-wrap:anywhere]"]));
  for (const b of row.querySelectorAll("button")) expect(b.className.split(" ")).toContain("flex-none");
  const said = [...panel()!.querySelectorAll("p")].find((p) => p.textContent!.includes("Supercalifragilisticexpialidociousness"))!;
  expect(said.className.split(" ")).toContain("[overflow-wrap:anywhere]");
  expect(steps()).toEqual(["Level 10: Supercalifragilisticexpialidociousness, rank 1", "Level 11: Improved Blessing of the Long Winter Night's Watch, rank 1"]);
});
