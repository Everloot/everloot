// @vitest-environment jsdom
import { act, useLayoutEffect, type ReactElement, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TALENT_CLASSES } from "@/lib/talents/catalogs";
import type { ClassTalentChanges } from "@/lib/talents/freshness";
import { classTalentChanges } from "@/lib/talents/freshness-records";
import { fixture } from "@/lib/talents/fixture";
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from "@/lib/seo";
import { encodeBuild, encodeOrder } from "@/lib/talents/share";
import type { Ranks, TalentCatalog } from "@/lib/talents/types";
import TalentCompare from "./TalentCompare";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
// The sitemap reads the players' facts; none are needed to see which talent pages it lists.
vi.mock("@/lib/rollup-compute", () => ({
  loadItemFacts: async () => ({ rates: [], names: [], npcs: [], unreachable: true }),
  loadWorldFacts: async () => ({ npcs: [], quests: [], vendors: [], unreachable: true }),
  loadInstanceFacts: async () => ({ entrances: [], encounters: [], sightings: [], unreachable: true, dataAsOf: null }),
}));

// Plans on the made-up test tree (lib/talents/fixture.ts, not game data), its build moved to 1.0.0.5 so a plan can be
// older than it. One point a level from 10: level 20 holds 11 points.
const tree: TalentCatalog = { ...fixture, build: "1.0.0.5" };

// Change records in the build watch's shape (kb/src/build-watch/changes.ts), as freshness-note.test.tsx makes them.
const EMPTY = { classesAdded: [], classesRemoved: [], added: [], removed: [], moved: [], ranks: [], gates: [], prereqs: [], replaced: [], spellValues: [], pointLevels: [] };
const ref = (version: string) => ({ version, buildId: Number(version.split(".").at(-1)), buildConfig: `config-${version}` });
const record = (build: string, previous: string, talents: Record<string, unknown[]> = {}) => ({
  schema: "everloot.game-changes/2", label: "found in game files, unconfirmed", id: `test-${ref(build).buildId}`, product: "test",
  live: true, spoiler: false, detectedAt: "2026-10-01T00:00:00.000Z", build: ref(build), previous: ref(previous), initial: false,
  encryptedBlocks: { total: 0, tables: [] }, source: { definitions: null, library: "test", extractedAt: "2026-10-01T00:00:00.000Z" },
  catalog: { classes: 9, nodes: 12 }, talents: { ...EMPTY, ...talents }, raidBuffs: null, mapChanges: null, readSet: null, warnings: [],
});
const at = (nodeId: number, extra: Record<string, unknown> = {}) => ({ classId: 8, className: "Mage", tree: "Left", nodeId, name: `Talent ${nodeId}`, spoiler: false, ...extra });
const changes: ClassTalentChanges = classTalentChanges([
  record("1.0.0.5", "1.0.0.3", { ranks: [at(11, { before: 5, after: 3 })] }),
  record("1.0.0.3", "1.0.0.1", { removed: [at(21, { maxRanks: 5 })] }),
], tree.classId);

const code = (ranks: Ranks, { build = tree.build, classSlug = "mage" } = {}) => encodeBuild({ classSlug, specId: tree.specId, build, ranks });
const times = (id: number, n: number) => Array<number>(n).fill(id);
const P: Ranks = { 11: { rank: 5 }, 12: { rank: 5 }, 21: { rank: 5 }, 51: { rank: 5 }, 52: { rank: 1 } };
const leftFirst = [...times(11, 5), ...times(12, 5), ...times(21, 5), ...times(51, 5), 52];
const rightFirst = [...times(51, 5), ...times(11, 5), 52, ...times(12, 5), ...times(21, 5)];
const X: Ranks = { 11: { rank: 5 }, 21: { rank: 5 }, 31: { rank: 1 } };
const Y: Ranks = { 11: { rank: 5 }, 12: { rank: 5 }, 22: { rank: 1 }, 51: { rank: 2 } };
const t = (ranks: Ranks, order: number[], origin: "planned" | "provisional" = "planned") => encodeOrder(ranks, order, origin)!;

const PAGE = "/tools/talents/mage/compare";
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", PAGE);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The page opened at this fragment. */
async function open(fragment: string) {
  window.history.replaceState(null, "", `${PAGE}${fragment}`);
  await act(async () => root.render(<TalentCompare catalog={tree} changes={changes} />));
}
const status = () => container.querySelector('[role="status"]')!.textContent;
const field = (side: "a" | "b") => container.querySelector<HTMLInputElement>(`#compare-${side}`)!;
const plan = (side: "a" | "b") => container.querySelector<HTMLElement>(`[data-plan="${side}"]`)!;
const rows = (caption: string) => [...container.querySelectorAll(`[aria-label="${caption}"] tbody tr`)].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
const items = (scope: ParentNode, selector: string) => [...scope.querySelectorAll(selector)].map((el) => el.textContent);
async function type(side: "a" | "b", value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(side), value);
    field(side).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const compare = () => act(async () => {
  container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
});

/** Says, at the first commit and before any passive effect has run, whether the comparison is in the document. */
function FirstCommit({ seen }: { seen: (present: boolean) => void }) {
  useLayoutEffect(() => {
    seen(document.querySelector("[data-comparison]") !== null);
  }, [seen]);
  return null;
}

test("the comparison waits for the address: not in the server HTML or the first commit, then shown, with no hydration error", async () => {
  const errors = vi.spyOn(console, "error");
  window.history.replaceState(null, "", `${PAGE}#a=${code(X)}&b=${code(Y)}`);
  const page = <TalentCompare catalog={tree} changes={changes} />;
  const html = renderToString(<div>{page}</div>);
  expect(html).not.toContain("data-comparison");
  for (const c of [code(X), code(Y)]) expect(html).not.toContain(c);
  const server = document.createElement("div");
  server.innerHTML = html;
  document.body.append(server);
  const firstCommit: boolean[] = [];
  let hydrated: Root | undefined;
  try {
    await act(async () => { hydrated = hydrateRoot(server, <div>{page}<FirstCommit seen={(present) => firstCommit.push(present)} /></div>); });
    expect(firstCommit).toEqual([false]);
    expect(server.querySelector("[data-comparison]")).not.toBeNull();
    expect(server.querySelector<HTMLInputElement>("#compare-a")!.value).toBe(code(X));
  } finally {
    await act(async () => hydrated?.unmount());
    server.remove();
  }
  // The server HTML and the first client render agree.
  expect(errors).not.toHaveBeenCalled();
});

test("identical plans say so, and the boxes hold the codes the address carries", async () => {
  await open(`#a=${code(P)}&b=${code(P)}`);
  expect(status()).toBe("The two plans are identical: the same talents at the same ranks. Whether they spend their points in the same order is unknown.");
  expect([field("a").value, field("b").value]).toEqual([code(P), code(P)]);
  expect(container.querySelector('[aria-label="Talents that differ"]')).toBeNull();
  expect(rows("Points per tree")).toEqual([["Left", "15", "15"], ["Right", "6", "6"], ["All trees", "21", "21"]]);
});

test("two different plans: each talent that differs, with each plan's rank, and the points per tree", async () => {
  await open(`#a=${code(X)}&b=${code(Y)}`);
  expect(status()).toBe("5 talents differ.");
  expect(rows("Talents that differ")).toEqual([
    ["Talent 12", "Left", "0/5", "5/5"],
    ["Talent 21", "Left", "5/5", "0/5"],
    ["Talent 22", "Left", "0/1", "1/1"],
    ["Talent 31", "Left", "1/5", "0/5"],
    ["Talent 51", "Right", "0/5", "2/5"],
  ]);
  expect(rows("Points per tree")).toEqual([["Left", "11", "11"], ["Right", "0", "2"], ["All trees", "11", "13"]]);
  expect(plan("a").querySelector("h2")!.textContent).toBe("Plan A");
  expect(plan("a").textContent).toContain("11 points, level 20: Left 11 / Right 0");
  expect(plan("b").textContent).toContain("13 points, level 22: Left 11 / Right 2");
});

test("a choice node shows the entry each plan picked", async () => {
  const base = { 11: { rank: 5 }, 12: { rank: 5 } };
  await open(`#a=${code({ ...base, 32: { rank: 1, choice: 0 } })}&b=${code({ ...base, 32: { rank: 1, choice: 1 } })}`);
  expect(rows("Talents that differ")).toEqual([["Choice A or Choice B", "Left", "1/1 · Choice A", "1/1 · Choice B"]]);
});

test("plans that cannot be compared say why: another class, a damaged code, an empty side", async () => {
  await open(`#a=${code(X)}&b=${code(X, { classSlug: "druid" })}`);
  expect(status()).toBe("These plans cannot be compared. Plan B is a Druid code. Both plans must be Mage plans to compare them here.");
  expect(container.querySelector("[data-comparison]")).toBeNull();

  await act(async () => { window.location.hash = "#a=EL1-mage-1482&b=EL1-mage-1482-1.0.0.5-AAAA"; });
  expect(items(container, '[role="status"] li')).toEqual(["Plan A: That share code is damaged or cut short.", "Plan B: That share code is damaged or cut short."]);

  await act(async () => { window.location.hash = `#a=${code(X)}`; });
  expect(status()).toBe("These plans cannot be compared. Plan B is empty. Paste a share code or a calculator link.");
});

test("with both spend orders known: each plan's points and split at each milestone level, and what differs there", async () => {
  await open(`#a=${code(P)}&ao=${t(P, leftFirst)}&b=${code(P)}&bo=${t(P, rightFirst, "provisional")}`);
  expect(status()).toBe("The two plans are identical: the same talents at the same ranks. They spend their points in a different order: Level by level shows where.");
  expect(plan("a").textContent).toContain("Planned spend order.");
  expect(plan("b").textContent).toContain("Provisional spend order: made by the calculator when asked. Not a recommendation or a record of play.");
  const levels = [...container.querySelectorAll("[data-milestones] > li")];
  expect(levels.map((li) => li.querySelector("p")!.textContent)).toEqual([
    "Level 20 · 11 points", "Level 30 · 21 points", "Level 40 · 31 points", "Level 50 · 41 points", "Level 60 · 51 points",
  ]);
  expect(levels[0].textContent).toContain("Plan A: 11 points, Left 11 / Right 0. Plan B: 11 points, Left 5 / Right 6.");
  // A level's list stays closed until asked for: two different plans can differ in dozens of talents at every level.
  const details = levels[0].querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")!.textContent).toBe("4 talents differ");
  expect(items(details, "li")).toEqual(["Talent 12: plan A 5/5, plan B 0/5", "Talent 21: plan A 1/5, plan B 0/5", "Talent 51: plan A 0/5, plan B 5/5", "Talent 52: plan A 0/1, plan B 1/1"]);
  expect(levels[4].textContent).toContain("Plan A: 21 points, Left 15 / Right 6. Plan B: 21 points, Left 15 / Right 6.");
  expect(levels[4].textContent).toContain("The same talents.");
  expect(container.querySelector("[data-level-order]")!.textContent).toBe("Plan B's spend order is provisional, made by the calculator when asked: its levels are not a recommendation.");
});

test("an unknown spend order shows no levels and says which plan has none", async () => {
  await open(`#a=${code(P)}&ao=${t(P, leftFirst)}&b=${code(P)}`);
  expect(container.querySelector("[data-milestones]")).toBeNull();
  expect(container.querySelector("[data-level-order]")!.textContent).toBe("Level by level needs both plans' spend orders, and plan B has none this page can use.");
  expect(plan("b").textContent).toContain("Spend order unknown: none came with this plan.");
  expect(container.textContent).not.toMatch(/Level 20/);

  await act(async () => { window.location.hash = `#a=${code(P)}&ao=O1p-%25&b=${code(P)}&bo=O1p-A`; });
  expect(container.querySelector("[data-level-order]")!.textContent).toBe("Level by level needs both plans' spend orders, and plans A and B have none this page can use.");
  // The plan's own list says why its order did not load.
  expect(items(plan("b"), '[aria-label="What loaded"] li')).toEqual(["The plan's spend order leaves out points the code has, so the order is unknown. The talents still loaded."]);
});

const NOT_A_CODE = "These plans cannot be compared. Plan A: That is not a share code. Codes start with EL1 and use letters, digits, - and _ only.";
const DAMAGED_ORDER = "The plan's spend order is damaged, so the order is unknown. The talents still loaded.";

test("a damaged code in the address fails with its side named; a damaged order keeps the talents, with no levels, and says why", async () => {
  await open(`#a=${code(P)}!damaged&b=${code(P)}`);
  expect(status()).toBe(NOT_A_CODE);
  expect(container.querySelector("[data-comparison]")).toBeNull();
  expect(field("a").value).toBe(`${code(P)}!damaged`);

  await act(async () => { window.location.hash = `#a=${code(P)}&ao=${t(P, leftFirst)}!damaged&b=${code(P)}&bo=${t(P, rightFirst)}`; });
  expect(plan("a").textContent).toContain("Spend order unknown.");
  expect(items(plan("a"), '[aria-label="What loaded"] li')).toEqual([DAMAGED_ORDER]);
  expect(container.querySelector("[data-milestones]")).toBeNull();
  expect(container.querySelector("[data-level-order]")!.textContent).toBe("Level by level needs both plans' spend orders, and plan A has none this page can use.");
});

test("a value with a code inside it is refused from the address and from a pasted link, not read as the code inside", async () => {
  const nested = `${code(P)}!damaged?plan=${code(P)}!tail`;
  await open(`#a=${encodeURIComponent(nested)}&b=${code(P)}`);
  expect(status()).toBe(NOT_A_CODE);
  expect(container.querySelector("[data-comparison]")).toBeNull();

  await type("a", `https://everloot.app/tools/talents/mage#plan=${nested}`);
  await compare();
  expect(status()).toBe(NOT_A_CODE);
  expect(container.querySelector("[data-comparison]")).toBeNull();
});

test("a pasted calculator link is read whole: a damaged order compares the talents without levels and stays in the address as it came", async () => {
  await open("");
  const damaged = `${t(P, leftFirst)}!damaged`;
  await type("a", `https://everloot.app/tools/talents/mage#plan=${code(P)}&order=${damaged}`);
  await type("b", code(P));
  await compare();
  expect(plan("a").textContent).toContain("Spend order unknown.");
  expect(items(plan("a"), '[aria-label="What loaded"] li')).toEqual([DAMAGED_ORDER]);
  expect(container.querySelector("[data-milestones]")).toBeNull();
  expect(window.location.hash).toBe(`#a=${code(P)}&ao=${damaged}&b=${code(P)}`);

  await type("a", `https://everloot.app/tools/talents/mage#plan=${code(P)}!damaged&order=${t(P, leftFirst)}`);
  await compare();
  expect(status()).toBe(NOT_A_CODE);
});

test("a plan from an older game build keeps its code, and says what the game files changed in its talents since", async () => {
  const writes = [vi.spyOn(window.history, "replaceState"), vi.spyOn(window.history, "pushState"), vi.spyOn(Storage.prototype, "setItem")];
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const old = code({ 11: { rank: 5 }, 21: { rank: 2 } }, { build: "1.0.0.1" });
  window.location.hash = `#a=${old}&b=${code({ 11: { rank: 5 } })}`;
  await act(async () => root.render(<TalentCompare catalog={tree} changes={changes} />));
  expect(window.location.hash).toBe(`#a=${old}&b=${code({ 11: { rank: 5 } })}`);
  expect(field("a").value).toBe(old);
  const note = plan("a").querySelector('[aria-label="Game build changes"]')!;
  expect(note.querySelector("p")!.textContent).toBe("Made on game build 1.0.0.1; this tree is build 1.0.0.5.");
  expect(items(note, "li")).toEqual([
    "Talent 21: removed in build 1.0.0.3 (this plan spends 2 points in it).",
    "Talent 11: its maximum rank went from 5 to 3 in build 1.0.0.5 (this plan spends 5 points in it).",
    "Check these talents before you follow the plan.",
  ]);
  expect(plan("b").querySelector('[aria-label="Game build changes"]')).toBeNull();
  // Showing a comparison writes nothing: not the address, not storage, not the network.
  for (const write of writes) expect(write).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test("comparing from the boxes puts #a=, &ao=, &b= and &bo= in the address, after nothing and before a cookie choice", async () => {
  await open("#everloot-cookie-rejected");
  expect(container.querySelector("[data-comparison]")).toBeNull();
  const order = t(P, leftFirst);
  await type("a", `https://everloot.app/tools/talents/mage#plan=${code(P)}&order=${order}`);
  await type("b", `  ${code(P)} `);
  await compare();
  expect(window.location.pathname).toBe(PAGE);
  expect(window.location.hash).toBe(`#a=${code(P)}&ao=${order}&b=${code(P)}&everloot-cookie-rejected`);
  expect([field("a").value, field("b").value]).toEqual([code(P), code(P)]);
  expect(plan("a").textContent).toContain("Planned spend order.");

  // The same code again keeps the order that came with it; a new one comes without.
  await type("b", code(Y));
  await compare();
  expect(window.location.hash).toBe(`#a=${code(P)}&ao=${order}&b=${code(Y)}&everloot-cookie-rejected`);
  expect(status()).toBe("4 talents differ.");

  // An emptied box is an empty side, and it leaves the address.
  await type("a", "");
  await compare();
  expect(window.location.hash).toBe(`#b=${code(Y)}&everloot-cookie-rejected`);
  expect(status()).toBe("These plans cannot be compared. Plan A is empty. Paste a share code or a calculator link.");
});

test("a comparison pasted into the address of the open page replaces the one shown", async () => {
  await open(`#a=${code(P)}&b=${code(P)}`);
  await act(async () => { window.location.hash = `#a=${code(X)}&b=${code(Y)}`; });
  expect(status()).toBe("5 talents differ.");
  expect([field("a").value, field("b").value]).toEqual([code(X), code(Y)]);
});

// The route: one static page per class, as the class page is.
type Params = { params: Promise<{ class: string }> };
const route = () => import("@/app/tools/talents/[class]/compare/page") as Promise<{
  default: (p: Params) => Promise<ReactElement>;
  generateMetadata: (p: Params) => Promise<import("next").Metadata>;
  generateStaticParams: () => { class: string }[];
  dynamicParams: boolean;
}>;

test("the compare page exists for each of the nine classes only, built once; any other class is not found", async () => {
  const page = await route();
  expect(page.dynamicParams).toBe(false);
  expect(page.generateStaticParams()).toEqual(TALENT_CLASSES.map((slug) => ({ class: slug })));
  for (const slug of ["deathknight", "constructor", "MAGE"]) {
    await expect(page.default({ params: Promise.resolve({ class: slug }) }), slug).rejects.toThrow("NOT_FOUND");
    expect(await page.generateMetadata({ params: Promise.resolve({ class: slug }) }), slug).toEqual({});
  }
  const html = renderToStaticMarkup(await page.default({ params: Promise.resolve({ class: "druid" }) }));
  expect(html).toMatch(/<h1[^>]*>.*Compare WoW Forever Druid Talent Plans.*<\/h1>/);
  expect(html).toContain('id="compare-a"');
  expect(html).toContain('href="/tools/talents/druid"');
  expect(html).not.toContain("data-comparison");
});

test("the compare pages are noindex, point at their class page and stay out of the sitemap", async () => {
  const page = await route();
  for (const slug of TALENT_CLASSES) {
    const m = await page.generateMetadata({ params: Promise.resolve({ class: slug }) });
    expect(m.robots, slug).toEqual({ index: false, follow: true });
    expect(m.alternates?.canonical, slug).toBe(`/tools/talents/${slug}`);
    expect(m.title, slug).toMatch(/^Compare WoW Forever [A-Z][a-z]+ Talent Plans$/);
    expect(String(m.description).length, slug).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
    expect(String(m.description).length, slug).toBeLessThanOrEqual(DESCRIPTION_MAX);
  }
  const { default: sitemap } = await import("@/app/sitemap");
  const paths = (await sitemap()).map((e) => new URL(e.url).pathname);
  expect(paths).toContain("/tools/talents/mage");
  expect(paths.filter((p) => /^\/tools\/talents\/.*compare/.test(p))).toEqual([]);
});

// Last in the file: it loads the browser code again from a fresh module registry.
test("the page's browser code loads without the change records or the schemas that check them", async () => {
  // The server reads the records and hands the browser this class's changes; the browser only compares.
  const serverOnly = ["../../../../kb/src/build-watch/changes", "zod", "@/data/game-data/changes/wowf-70630.json", "@/data/game-data/changes/wow_classic_beta-70532.json"];
  const loaded: string[] = [];
  vi.resetModules();
  for (const id of serverOnly) vi.doMock(id, () => { loaded.push(id); return { default: {} }; });
  try {
    await import("./TalentCompare");
    expect(loaded).toEqual([]);
  } finally {
    for (const id of serverOnly) vi.doUnmock(id);
    vi.resetModules();
  }
});
