// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import DevicePlans from "@/components/workspace/DevicePlans";
import { fixture } from "@/lib/talents/fixture";
import { importCode, importPlan } from "@/lib/talents/import";
import { encodeBuild } from "@/lib/talents/share";
import type { Ranks, TalentCatalog } from "@/lib/talents/types";
import TalentCalculator from "./TalentCalculator";

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

// The spend order on the made-up test tree (lib/talents/fixture.ts, not game data): row 1 of Left holds 11 and 12,
// its row 2 (21, 22) opens at 5 points above, and each point arrives one level after the last, from level 10. In a
// token each node with points is a letter, by ascending id: in { 11, 12 }, 11 is A and 12 is B.

const code = (ranks: Ranks) => encodeBuild({ classSlug: "mage", specId: 1482, build: "1.0.0.1", ranks });
const r = (entries: Record<number, number>): Ranks => Object.fromEntries(Object.entries(entries).map(([id, rank]) => [id, { rank }]));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no scrollBy, and the calculator calls it whenever a talent takes keyboard focus out of place.
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  window.history.replaceState(null, "", "/tools/talents/mage");
  localStorage.clear();
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

const render = (catalog: TalentCatalog = fixture) => act(async () => root.render(<TalentCalculator catalog={catalog} />));
/** The calculator opened on a class page address with this fragment. */
async function open(fragment: string, catalog?: TalentCatalog) {
  window.history.replaceState(null, "", `/tools/talents/mage${fragment}`);
  await render(catalog);
}
async function remount() {
  await act(async () => root.unmount());
  root = createRoot(container);
}
const node = (id: number) => container.querySelector<HTMLButtonElement>(`#talent-${id}`)!;
const status = () => container.querySelector('[role="status"]')!.textContent;
const button = (label: RegExp, scope: ParentNode = container) => [...scope.querySelectorAll("button")].find((b) => label.test(b.textContent?.trim() ?? ""));
const click = (el: Element | undefined) => act(async () => {
  if (!el) throw new Error("Nothing to click");
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
});
const spend = async (...ids: number[]) => { for (const id of ids) await click(node(id)); };
/** A right click, which takes a point back. */
const takeBack = (id: number) => act(async () => { node(id).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
/** The spend order under the trees. */
const order = () => container.querySelector("#spend-order")!.closest("section")!;
const moved = () => [...order().querySelectorAll("ul li")].map((li) => li.textContent);
const hash = () => window.location.hash;
function clipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return writeText;
}

// importPlan: a code and its spend order, the order checked against the tree.

test("importPlan keeps a complete, legal spend order with the label its token carries, beside the ranks the code asked for", () => {
  const asked = r({ 11: 2, 12: 1 });
  expect(importPlan(fixture, code(asked), "O1p-AAB")).toMatchObject({
    ok: true, set: { ranks: asked, order: [11, 11, 12], orderOrigin: "planned" }, requested: asked, token: "O1p-AAB", report: { problems: [] },
  });
  expect(importPlan(fixture, code(asked), "O1g-ABA")).toMatchObject({ ok: true, set: { order: [11, 12, 11], orderOrigin: "provisional" } });
});

test("importPlan opens a code that came without an order as order unknown, and makes none up", () => {
  const asked = r({ 11: 5, 21: 1 });
  for (const result of [importPlan(fixture, code(asked)), importPlan(fixture, code(asked), null)]) {
    expect(result).toMatchObject({ ok: true, set: { ranks: asked, order: null, orderOrigin: null }, token: null, report: { problems: [] } });
  }
});

test("an order that breaks the tree's rules loads the talents with the order unknown, and says where it breaks", () => {
  // 11 is A and 21 is B: 21 comes first, before the 5 points its row needs.
  const result = importPlan(fixture, code(r({ 11: 5, 21: 1 })), "O1p-BAAAAA");
  expect(result).toMatchObject({ ok: true, set: { ranks: r({ 11: 5, 21: 1 }), order: null, orderOrigin: null }, token: "O1p-BAAAAA" });
  expect(result.ok && result.report.problems).toEqual([
    "The plan's spend order breaks this tree's rules, so the order is unknown. Talent 21 at level 10: Needs 5 points spent in Left on rows above. The talents still loaded.",
  ]);
});

test("an order from a newer version, a damaged one or one that does not match its code keeps the talents and says why it is unknown", () => {
  const asked = r({ 11: 2, 12: 1 });
  const cases: [string, string][] = [
    ["O2p-AAB", "made by a newer version of this tool"],
    ["O1p-A*B", "damaged"],
    ["O1p-AB", "leaves out points the code has"],
    ["O1p-AABB", "lists points the code does not have"],
  ];
  for (const [token, why] of cases) {
    const result = importPlan(fixture, code(asked), token);
    expect(result, token).toMatchObject({ ok: true, set: { ranks: asked, order: null, orderOrigin: null }, token });
    expect(result.ok && result.report.problems.join(" "), token).toContain(why);
  }
});

test("a code that does not load gives its reason and no plan", () => {
  expect(importPlan(fixture, "")).toEqual({ ok: false, message: "Paste a share code or a link first." });
  expect(importPlan(fixture, "EL1-mage-0-1.0.0.1-!!", "O1p-A")).toEqual({ ok: false, message: expect.stringContaining("That is not a share code.") });
  const druid = encodeBuild({ classSlug: "druid", specId: 0, build: "1.0.0.1", ranks: r({ 11: 1 }) });
  expect(importPlan(fixture, druid, "O1p-A")).toEqual({ ok: false, message: expect.stringContaining("for a different class") });
});

test("pasted links give their own set's pair: set two's from Copy for addon, the first set's from a whole-plan link", () => {
  const one = r({ 11: 2 });
  const two = r({ 11: 1, 12: 1 });
  expect(importPlan(fixture, `https://everloot.app/tools/talents/mage#plan2=${code(two)}&order2=O1g-BA`))
    .toMatchObject({ ok: true, set: { ranks: two, order: [12, 11], orderOrigin: "provisional" }, token: "O1g-BA" });
  expect(importPlan(fixture, `https://everloot.app/tools/talents/mage#plan=${code(one)}&plan2=${code(two)}&order=O1p-AA&order2=O1g-BA`))
    .toMatchObject({ ok: true, set: { ranks: one, order: [11, 11], orderOrigin: "planned" }, token: "O1p-AA" });
  // importCode is as it was: the first set's code from a link, and an order only when one is passed to it.
  expect(importCode(fixture, `https://everloot.app/tools/talents/mage#plan=${code(one)}&order=O1p-AA`)).toEqual({
    ok: true, ranks: one, minLevel: 11, report: { codeBuild: "1.0.0.1", treeBuild: "1.0.0.1", problems: [] },
  });
});

test("a choice the tree does not have is corrected and reported, the order stays, and the requested ranks keep the asked choice", () => {
  // 11 is A, 12 is B and the choice node 32 is C; 32's row opens at 10 points above.
  const asked: Ranks = { 11: { rank: 5 }, 12: { rank: 5 }, 32: { rank: 1, choice: 7 } };
  const result = importPlan(fixture, code(asked), "O1p-AAAAABBBBBC");
  expect(result).toMatchObject({
    ok: true, requested: asked,
    set: { ranks: { 11: { rank: 5 }, 12: { rank: 5 }, 32: { rank: 1, choice: 0 } }, order: [11, 11, 11, 11, 11, 12, 12, 12, 12, 12, 32], orderOrigin: "planned" },
  });
  expect(result.ok && result.report.problems).toEqual(["Choice A: the code picked a choice this tree does not have, so the first choice is used."]);
});

// The calculator: two sets, each with its order.

test("new points record a planned order, listed in turn with their levels, and the address carries it after both codes", async () => {
  await render();
  await spend(11, 11, 12);
  expect(hash()).toBe(`#plan=${code(r({ 11: 2, 12: 1 }))}&order=O1p-AAB`);
  expect(order().textContent).toContain("Planned order.");
  expect([...order().querySelectorAll("ol li")].map((li) => li.textContent))
    .toEqual(["Level 10: Talent 11, rank 1", "Level 11: Talent 11, rank 2", "Level 12: Talent 12, rank 1"]);
  await click(button(/^Set 2$/));
  await spend(12);
  expect(order().textContent).toContain("Spend order, set 2");
  expect(hash()).toBe(`#plan=${code(r({ 11: 2, 12: 1 }))}&plan2=${code(r({ 12: 1 }))}&order=O1p-AAB&order2=O1p-A`);
});

test("an old link opens with its order unknown; a provisional order is made only when asked, labelled, and Undo takes it back", async () => {
  const old = `#plan=${code(r({ 11: 5, 21: 1 }))}`;
  await open(old);
  expect(order().textContent).toContain("Spend order unknown.");
  expect(order().querySelector("ol")).toBeNull();
  expect(hash()).toBe(old);
  await click(button(/^Create a provisional order$/));
  expect(order().textContent).toContain("Provisional order.");
  expect(order().textContent).toContain("Not a recommendation or a record of play.");
  expect(status()).toContain("not a recommendation or a record of play");
  // The tree's reading order: 11's five points, then 21 (B) once its row has opened.
  expect(hash()).toBe(`${old}&order=O1g-AAAAAB`);
  await click(button(/^Undo$/));
  expect(order().textContent).toContain("Spend order unknown.");
  expect(hash()).toBe(old);
});

test("a link's planned and provisional orders open as they were, in both sets, and the address stays as it came", async () => {
  const link = `#plan=${code(r({ 11: 2, 12: 1 }))}&plan2=${code(r({ 11: 1, 12: 1 }))}&order=O1p-ABA&order2=O1g-BA`;
  await open(link);
  expect(status()).toBe("Both sets loaded from the link.");
  expect(order().textContent).toContain("Planned order.");
  await click(button(/^Set 2$/));
  expect(order().textContent).toContain("Provisional order.");
  expect(hash()).toBe(link);
});

test("an order this version cannot read stays with its set as it came, until the set changes", async () => {
  const newer = `#plan=${code(r({ 11: 2, 12: 1 }))}&order=O2p-AAB`;
  await open(newer);
  expect(order().textContent).toContain("Spend order unknown.");
  expect(container.querySelector('[aria-label="What loaded"]')!.textContent).toContain("made by a newer version of this tool");
  // Reloading, as that line says to, still finds the token.
  expect(hash()).toBe(newer);
  await spend(12);
  expect(hash()).toBe(`#plan=${code(r({ 11: 2, 12: 2 }))}`);
  await click(button(/^Undo$/));
  expect(hash()).toBe(newer);
});

test("an order whose points did not all place on this tree is not carried on with the talents that did", async () => {
  // Node 999 is not on this tree, and the token names its point too (11 is A, 999 is B).
  await open(`#plan=${code({ 11: { rank: 2 }, 999: { rank: 1 } })}&order=O1p-AAB`);
  expect(order().textContent).toContain("Spend order unknown.");
  expect(hash()).toBe(`#plan=${code(r({ 11: 2 }))}`);
});

test("a take-back that reorders points says where each went, at a later, the same or an earlier level, and Undo puts the order back", async () => {
  await render();
  await spend(11, 11, 11, 11, 12, 21, 51, 11);
  const before = hash();
  await takeBack(12);
  expect(status()).toContain("Talent 12: rank 0 of 5.");
  expect(status()).toContain("3 points changed places");
  expect(moved()).toEqual([
    "Talent 21, rank 1: was level 15, now level 16",
    "Talent 51, rank 1: was level 16, now level 14",
    "Talent 11, rank 5: was level 17, now level 15",
  ]);
  expect(`${status()} ${order().textContent}`).not.toMatch(/\blater\b/i);
  await click(button(/^Undo$/));
  expect(hash()).toBe(before);
  expect(order().querySelector("ul")).toBeNull();
});

test("a moved point that keeps its level is listed with both levels too", async () => {
  await render();
  await spend(11, 11, 11, 11, 12, 21, 11);
  await takeBack(12);
  expect(moved()).toEqual([
    "Talent 21, rank 1: was level 15, now level 15",
    "Talent 11, rank 5: was level 16, now level 14",
  ]);
});

/** The test tree with a second talent beside 52 that needs 6 points spent elsewhere: with only 5 others, neither can come first. */
const gated: TalentCatalog = {
  ...fixture,
  nodes: [...fixture.nodes, {
    id: 56, treeId: 2, row: 2, col: 3, maxRanks: 1, kind: "single", prereqs: [], unlock: { pointsTotal: 6 },
    entries: [{ definitionId: null, spellId: null, name: "Talent 56" }],
  }],
};

test("a take-back or a tree reset that would leave no legal order is refused, says why, and changes nothing", async () => {
  await render(gated);
  await spend(51, 51, 51, 51, 51, 12, 52, 56);
  const before = hash();
  await takeBack(12);
  expect(status()).toBe("Talent 12 stays: the points after it could not be spent in a legal order without it. Take back a later point first.");
  expect(node(12).textContent).toContain("1/5");
  await click(container.querySelector('button[aria-label="Reset Left"]')!);
  expect(status()).toBe("Left was not reset: the points in the other trees could not be spent in a legal order without its points. Take back some of those first.");
  expect(hash()).toBe(before);
  // Neither refusal left an undo step: Undo takes back 56, the last point spent.
  await click(button(/^Undo$/));
  expect(node(56).textContent).toContain("0/1");
  expect(node(12).textContent).toContain("1/5");
});

test("Undo and Redo bring back both sets exactly, orders and labels included", async () => {
  const opened = `#plan=${code(r({ 11: 2 }))}&plan2=${code(r({ 12: 1 }))}&order2=O1p-A`;
  await open(opened);
  await click(button(/^Create a provisional order$/));
  const generated = `#plan=${code(r({ 11: 2 }))}&plan2=${code(r({ 12: 1 }))}&order=O1g-AA&order2=O1p-A`;
  expect(hash()).toBe(generated);
  await click(button(/^Set 2$/));
  await spend(12);
  const latest = `#plan=${code(r({ 11: 2 }))}&plan2=${code(r({ 12: 2 }))}&order=O1g-AA&order2=O1p-AA`;
  expect(hash()).toBe(latest);
  await click(button(/^Undo$/));
  expect(hash()).toBe(generated);
  await click(button(/^Undo$/));
  expect(hash()).toBe(opened);
  await click(button(/^Set 1$/));
  expect(order().textContent).toContain("Spend order unknown.");
  await click(button(/^Redo$/));
  await click(button(/^Redo$/));
  expect(hash()).toBe(latest);
  expect(order().textContent).toContain("Provisional order.");
});

test("a failed import keeps both sets and their orders as they were, and leaves no undo step", async () => {
  await render();
  await spend(11, 11);
  await click(button(/^Set 2$/));
  await spend(12);
  const before = hash();
  const paste = container.querySelector<HTMLInputElement>("#talent-paste")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(paste, "EL1-mage-0-1.0.0.1-!!");
    paste.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(button(/^Load into set 2$/));
  expect(status()).toBe("That is not a share code. Codes start with EL1 and use letters, digits, - and _ only.");
  expect(hash()).toBe(before);
  // A broken link put in the address leaves the plan as it was too.
  await act(async () => {
    window.location.hash = "#plan=EL9-mage-0-1.0.0.1-AAAA";
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(status()).toContain("made by a newer version of this tool");
  expect(node(12).textContent).toContain("1/5");
  await click(button(/^Undo$/));
  expect(node(12).textContent).toContain("0/5");
  await click(button(/^Set 1$/));
  expect(node(11).textContent).toContain("2/5");
  expect(order().textContent).toContain("Planned order.");
});

// Links out: the addon's, and the whole plan's.

test("Copy for addon copies set one as a full link holding only its own code and order, and says the addon loads the ranks only", async () => {
  const writeText = clipboard();
  await render();
  await spend(11, 11, 12);
  await click(button(/^Copy for addon/));
  expect(writeText).toHaveBeenCalledWith(`https://everloot.app/tools/talents/mage#plan=${code(r({ 11: 2, 12: 1 }))}&order=O1p-AAB`);
  const share = container.querySelector('[aria-label="Share"]')!.textContent!;
  expect(share).toContain("Talents tab → paste → Import");
  expect(share).toContain("0.3.12");
  expect(share).not.toContain("/everloot plan");
});

test("Copy for addon on set two copies plan2 and order2 alone, with no first-set pair, and keeps a provisional label", async () => {
  const writeText = clipboard();
  const one = code(r({ 11: 2 }));
  const two = code(r({ 11: 1, 12: 1 }));
  await open(`#plan=${one}&plan2=${two}&order=O1p-AA`);
  await click(button(/^Set 2$/));
  await click(button(/^Create a provisional order$/));
  await click(button(/^Copy for addon/));
  const copied = writeText.mock.lastCall![0] as string;
  expect(copied).toBe(`https://everloot.app/tools/talents/mage#plan2=${two}&order2=O1g-AB`);
  expect(copied).not.toMatch(/[#&](?:plan|order)=/);
  expect(copied).not.toContain(one);
});

test("the whole-plan link keeps the build-link path a chat previews, and carries both sets' orders after #", async () => {
  await render();
  await spend(11);
  await click(button(/^Set 2$/));
  await spend(12);
  expect(container.querySelector<HTMLInputElement>("#talent-link")!.value)
    .toBe(`${window.location.origin}/tools/talents/mage/b/${code(r({ 11: 1 }))}/${code(r({ 12: 1 }))}#order=O1p-A&order2=O1p-A`);
});

test("a build link with orders opens both sets with them and moves to the class page's address, keeping a cookie choice", async () => {
  const one = code(r({ 11: 2, 12: 1 }));
  const two = code(r({ 12: 1 }));
  window.history.replaceState(null, "", `/tools/talents/mage/b/${one}/${two}#order=O1p-ABA&order2=O1g-A&everloot-analytics-rejected`);
  await act(async () => root.render(<TalentCalculator catalog={fixture} initialCodes={[one, two]} />));
  expect(window.location.pathname).toBe("/tools/talents/mage");
  expect(hash()).toBe(`#plan=${one}&plan2=${two}&order=O1p-ABA&order2=O1g-A&everloot-analytics-rejected`);
  expect(order().textContent).toContain("Planned order.");
  await click(button(/^Set 2$/));
  expect(order().textContent).toContain("Provisional order.");
});

// Saved on this device: named on the plans page, opened again here.

test("a plan sent to Plans on this device and saved there opens again with both sets and their orders", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== "/api/auth/me") throw new Error(`Unexpected request ${String(input)}`);
    return Response.json({ user: null });
  }));
  await open(`#plan=${code(r({ 11: 2 }))}&plan2=${code(r({ 11: 1, 12: 1 }))}&order=O1p-AA`);
  await click(button(/^Set 2$/));
  await click(button(/^Create a provisional order$/));
  const sent = container.querySelector('a[href^="/tools/builds"]')!.getAttribute("href")!;

  // The plans page, opened by that link.
  await remount();
  window.history.replaceState(null, "", sent);
  await act(async () => root.render(<DevicePlans />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const form = container.querySelector<HTMLFormElement>('form[aria-label="Save the plan from the calculator"]')!;
  expect(form.textContent).toContain("Set 1: planned order · Set 2: provisional order");
  await click(button(/^Save plan$/, form));
  const reopen = [...container.querySelectorAll("li a")].find((a) => a.textContent === "Open")!.getAttribute("href")!;

  // Back in the calculator.
  await remount();
  window.history.replaceState(null, "", reopen);
  await render();
  expect(status()).toBe("Both sets loaded from the link.");
  expect(node(11).textContent).toContain("2/5");
  expect(order().textContent).toContain("Planned order.");
  await click(button(/^Set 2$/));
  expect(node(12).textContent).toContain("1/5");
  expect(order().textContent).toContain("Provisional order.");
});

test("the spend order sits under the trees, outside the phone's sticky tree switch", async () => {
  await render();
  const bar = container.querySelector("[data-tree-status]")!.parentElement!;
  expect(bar.parentElement!.contains(order())).toBe(false);
  expect(order().compareDocumentPosition(container.querySelector('[aria-label="Share"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
