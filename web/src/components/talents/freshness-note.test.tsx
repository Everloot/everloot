// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { loadCatalog } from "@/lib/talents/catalogs";
import { fixture } from "@/lib/talents/fixture";
import { encodeBuild } from "@/lib/talents/share";
import type { Ranks, TalentCatalog } from "@/lib/talents/types";
import FreshnessNote from "./FreshnessNote";
import TalentClassView from "./TalentClassView";

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));
vi.mock("next/link", () => ({
  default: (props: { href: string; children: ReactNode; className?: string; "aria-current"?: "page" }) => <a {...props} />,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Change records in the build watch's shape (kb/src/build-watch/changes.ts), on the made-up test tree.
const EMPTY = { classesAdded: [], classesRemoved: [], added: [], removed: [], moved: [], ranks: [], gates: [], prereqs: [], replaced: [], spellValues: [], pointLevels: [] };
const ref = (version: string) => ({ version, buildId: Number(version.split(".").at(-1)), buildConfig: `config-${version}` });
const record = (build: string, previous: string, talents: Record<string, unknown[]> = {}, spoiler = false) => ({
  schema: "everloot.game-changes/2", label: "found in game files, unconfirmed", id: `test-${ref(build).buildId}`, product: "test",
  live: !spoiler, spoiler, detectedAt: "2026-10-01T00:00:00.000Z", build: ref(build), previous: ref(previous), initial: false,
  encryptedBlocks: { total: 0, tables: [] }, source: { definitions: null, library: "test", extractedAt: "2026-10-01T00:00:00.000Z" },
  catalog: { classes: 9, nodes: 12 }, talents: { ...EMPTY, ...talents }, raidBuffs: null, mapChanges: null, readSet: null, warnings: [],
});
const at = (nodeId: number, extra: Record<string, unknown> = {}) => ({ classId: 8, className: "Mage", tree: "Left", nodeId, name: `Talent ${nodeId}`, spoiler: false, ...extra });

const tree: TalentCatalog = { ...fixture, build: "1.0.0.5" };
const records = (spoiler = false) => [
  record("1.0.0.5", "1.0.0.3", { ranks: [at(11, { before: 5, after: 3, spoiler })] }, spoiler),
  record("1.0.0.3", "1.0.0.1", { removed: [at(21, { maxRanks: 5, spoiler })] }, spoiler),
];
const code = (build: string, ranks: Ranks = { 11: { rank: 5 }, 21: { rank: 2 } }, classSlug = "mage") => encodeBuild({ classSlug, specId: 1482, build, ranks });
const page = (html: string) => new DOMParser().parseFromString(html, "text/html");
const NOTE = 'section[aria-label="Game build changes"]';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

test("says nothing without a plan from an older build: no codes, codes made on this tree's build, damaged codes or another class's", () => {
  const html = (codes?: (string | null)[]) => renderToStaticMarkup(<FreshnessNote catalog={tree} codes={codes} entries={records()} />);
  expect(html()).toBe("");
  expect(html([null, null])).toBe("");
  expect(html([code("1.0.0.5"), null])).toBe("");
  // The calculator's own report says why these did not load.
  expect(html(["not a code", "EL1-mage-1482-1.0.0.1-%%%"])).toBe("");
  expect(html([code("1.0.0.1", { 11: { rank: 5 } }, "druid")])).toBe("");
});

test("lists what changed for each set that was made on an older build, labelled as game file data", () => {
  const doc = page(renderToStaticMarkup(<FreshnessNote catalog={tree} codes={[code("1.0.0.1"), code("1.0.0.3", { 11: { rank: 4 } })]} entries={records()} />));
  const note = doc.querySelector(NOTE)!;
  const sets = [...note.querySelectorAll(":scope > div")];
  expect(sets.map((s) => s.querySelector("p")!.textContent)).toEqual([
    "Set 1: Made on game build 1.0.0.1; this tree is build 1.0.0.5.",
    "Set 2: Made on game build 1.0.0.3; this tree is build 1.0.0.5.",
  ]);
  expect([...sets[0].querySelectorAll("li")].map((li) => li.textContent)).toEqual([
    "Talent 21: removed in build 1.0.0.3 (this plan spends 2 points in it).",
    "Talent 11: its maximum rank went from 5 to 3 in build 1.0.0.5 (this plan spends 5 points in it).",
    "Check these talents before you follow the plan.",
  ]);
  expect([...sets[1].querySelectorAll("li")].map((li) => li.textContent)).toEqual([
    "Talent 11: its maximum rank went from 5 to 3 in build 1.0.0.5 (this plan spends 4 points in it).",
    "Check these talents before you follow the plan.",
  ]);
  expect(note.textContent).toContain("found in game files, unconfirmed");

  // One set: no set label.
  const one = page(renderToStaticMarkup(<FreshnessNote catalog={tree} codes={[code("1.0.0.3", { 11: { rank: 4 } }), null]} entries={records()} />));
  expect(one.querySelector(`${NOTE} p`)!.textContent).toBe("Made on game build 1.0.0.3; this tree is build 1.0.0.5.");
});

test("a spoiler build's changes are counted but not shown, unless the reader turned spoilers on", () => {
  const hidden = page(renderToStaticMarkup(<FreshnessNote catalog={tree} codes={[code("1.0.0.1")]} entries={records(true)} />)).querySelector(NOTE)!;
  expect(hidden.textContent).toContain("2 of this plan's talents changed in builds players cannot play yet (1.0.0.3, 1.0.0.5). Spoilers are not shown here.");
  expect(hidden.textContent).not.toMatch(/Talent 11|Talent 21|maximum rank|removed/);
  const shown = page(renderToStaticMarkup(<FreshnessNote catalog={tree} codes={[code("1.0.0.1")]} entries={records(true)} spoilers />)).querySelector(NOTE)!;
  expect(shown.textContent).toContain("Talent 21: removed in build 1.0.0.3");
});

test("with spoilers off, a talent a spoiler build renamed keeps the name its public change has", () => {
  const mixed = [
    record("1.0.0.5", "1.0.0.3", { ranks: [at(11, { name: "Hidden Name", before: 4, after: 3 })] }, true),
    record("1.0.0.3", "1.0.0.1", { ranks: [at(11, { before: 5, after: 4 })] }),
  ];
  const html = renderToStaticMarkup(<FreshnessNote catalog={tree} codes={[code("1.0.0.1", { 11: { rank: 5 } })]} entries={mixed} />);
  expect(html).not.toContain("Hidden Name");
  expect([...page(html).querySelectorAll(`${NOTE} li`)].map((li) => li.textContent)).toEqual([
    "Talent 11: its maximum rank went from 5 to 4 in build 1.0.0.3 (this plan spends 5 points in it).",
    "1 of this plan's talents changed in a build players cannot play yet (1.0.0.5). Spoilers are not shown here.",
    "Check each talent before you follow the plan.",
  ]);
});

// The address the calculator reads. Waits for the change event, so each step is one hashchange.
async function setHash(hash: string) {
  if (window.location.hash === hash) return;
  await new Promise((resolve) => {
    window.addEventListener("hashchange", resolve, { once: true });
    window.location.hash = hash;
  });
}

async function mounted(codes: (string | null)[], run: (shown: () => boolean, go: (hash: string) => Promise<void>) => Promise<void>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const writes = [vi.spyOn(window.history, "replaceState"), vi.spyOn(window.history, "pushState"), vi.spyOn(Storage.prototype, "setItem")];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<FreshnessNote catalog={tree} codes={codes} entries={records()} />));
    await run(() => container.querySelector(NOTE) !== null, (hash) => act(() => setHash(hash)));
    // Following the address never writes it, or anything else.
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    await setHash("");
  }
}

test("a different plan already in the address when the page opens hides the note: the calculator shows that plan", async () => {
  const opened = code("1.0.0.1");
  await setHash(`#plan=${code("1.0.0.3", { 11: { rank: 4 } })}`);
  await mounted([opened, null], async (shown, go) => {
    expect(shown()).toBe(false);
    // The link's own codes, as the calculator writes them into the address; an order rides along and does not count.
    await go(`#plan=${opened}&order=O1p-AAAAAB`);
    expect(shown()).toBe(true);
  });
});

test("a plan pasted into the address after the page opens hides the note; an anchor on the page leaves it as it is", async () => {
  const opened = code("1.0.0.1");
  const other = code("1.0.0.3", { 11: { rank: 4 } });
  await mounted([opened, null], async (shown, go) => {
    // No plan in the address: the page shows the codes it opened with.
    expect(shown()).toBe(true);
    await go("#how-it-works");
    expect(shown()).toBe(true);
    await go(`#plan=${other}`);
    expect(shown()).toBe(false);
    await go("#how-it-works");
    expect(shown()).toBe(false);
    // A second set the note was not made for.
    await go(`#plan=${opened}&plan2=${other}`);
    expect(shown()).toBe(false);
    await go(`#plan=${opened}`);
    expect(shown()).toBe(true);
  });
});

test("missing records make the change history unknown, never unchanged", () => {
  const note = page(renderToStaticMarkup(<FreshnessNote catalog={tree} codes={[code("1.0.0.1")]} entries={[records()[0]]} />)).querySelector(NOTE)!;
  expect([...note.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
    "Talent 11: its maximum rank went from 5 to 3 in build 1.0.0.5 (this plan spends 5 points in it).",
    "There is no change record for game build 1.0.0.3, so changes between 1.0.0.1 and 1.0.0.3 are unknown.",
    "Check each talent before you follow the plan.",
  ]);
  const none = page(renderToStaticMarkup(<FreshnessNote catalog={tree} codes={[code("1.0.0.1")]} entries={[]} />)).querySelector(NOTE)!;
  expect(none.textContent).toContain("There is no change record for game build 1.0.0.5, so changes between 1.0.0.1 and 1.0.0.5 are unknown.");
  expect(none.textContent).not.toMatch(/changed none/);
});

test("rendering the warning never saves or restamps the plan: no storage, no network, no new code or link, its inputs as given", () => {
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const removeItem = vi.spyOn(Storage.prototype, "removeItem");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const original = code("1.0.0.1");
  const codes = Object.freeze([original, null]);
  const entries = deepFreeze(records());
  const before = JSON.stringify(entries);
  const html = renderToStaticMarkup(<FreshnessNote catalog={deepFreeze({ ...tree })} codes={codes} entries={entries} />);
  expect(html).toContain("Made on game build 1.0.0.1; this tree is build 1.0.0.5.");
  expect(setItem).not.toHaveBeenCalled();
  expect(removeItem).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(codes).toEqual([original, null]);
  expect(JSON.stringify(entries)).toBe(before);
  // Nothing in the note could carry the plan to this tree's build: no share code, no link, no button.
  expect(html).not.toMatch(/EL1-|#plan=|href=|<button|<form/);
});

test("a build link made on an older game build shows the note under the calculator; the class page and a link on this tree's build show none", async () => {
  const catalog = await loadCatalog("mage");
  const node = catalog.nodes.find((n) => n.row === 1)!;
  const made = (build: string) => encodeBuild({ classSlug: "mage", specId: catalog.specId, build, ranks: { [node.id]: { rank: 1 } } });
  const view = async (initialCodes?: (string | null)[], saved?: boolean) => page(renderToStaticMarkup(await TalentClassView({
    slug: "mage", initialCodes, ...(saved ? { saved: { name: "Saved plan", notes: null, meta: null, actions: null } } : {}),
  })));

  expect((await view()).querySelector(NOTE)).toBeNull();
  expect((await view([made(catalog.build), null])).querySelector(NOTE)).toBeNull();

  for (const saved of [false, true]) {
    const doc = await view([made("1.60.1.1"), null], saved);
    const note = doc.querySelector(NOTE)!;
    expect(note.querySelector("p")!.textContent).toBe(`Made on game build 1.60.1.1; this tree is build ${catalog.build}.`);
    // No record reaches back to 1.60.1.1, so the note cannot say the plan is unchanged.
    expect(note.textContent).toMatch(/so changes between 1\.60\.1\.1 and [\d.]+ are unknown\./);
    expect(note.textContent).not.toMatch(/changed none/);
    // Under the calculator, not above it: the tree keeps its place on a phone.
    const calculator = doc.querySelector("[data-calculator]")!;
    expect(calculator.contains(note)).toBe(false);
    expect(calculator.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});
