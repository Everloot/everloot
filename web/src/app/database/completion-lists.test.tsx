import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCompletion: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCompletion: store.loadCompletion },
}));
// The game-file base the lists start from: empty unless a test sets it, so the cases below keep testing the rollup alone.
const game = vi.hoisted(() => ({
  factions: [] as { id: number; name: string; shown: boolean; parentId?: number }[],
  titles: [] as { id: number; name: string }[],
  questLines: [] as { id: number; name: string; questIds: number[] }[],
  achievements: {} as Record<string, { title: string; points: number; criteria: unknown[]; statistic?: true }>,
}));
vi.mock("@/data/game-data/client-factions", () => ({ get CLIENT_FACTIONS() { return { factions: game.factions }; } }));
vi.mock("@/data/game-data/client-titles", () => ({ get CLIENT_TITLES() { return { titles: game.titles }; } }));
vi.mock("@/data/game-data/client-quest-lines", () => ({ get CLIENT_QUEST_LINES() { return { questLines: game.questLines }; } }));
vi.mock("@/data/game-data/client-achievements", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/data/game-data/client-achievements")>();
  return { get CLIENT_ACHIEVEMENTS() { return { ...real.CLIENT_ACHIEVEMENTS, achievements: game.achievements }; } };
});
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));
vi.mock("@/lib/rollup-compute", () => ({
  loadItemFacts: async () => ({ rates: [], names: [], npcs: [], unreachable: false }),
  loadWorldFacts: async () => ({ npcs: [], quests: [], vendors: [], unreachable: false }),
  loadInstanceFacts: async () => ({ entrances: [], encounters: [], sightings: [], unreachable: false, dataAsOf: null }),
}));
vi.mock("@/lib/names", () => ({ loadNames: async () => ({ items: new Map(), npcs: new Map(), quests: new Map() }), objectNames: () => new Map() }));
vi.mock("@/lib/objects", () => ({ loadObjectFacts: async () => ({ rates: [], measuredZeros: [], names: [], unreachable: false }) }));

import AchievementList, { generateMetadata as achievementListMetadata } from "./achievements/page";
import AchievementPage, { generateMetadata as achievementMetadata } from "./achievements/[id]/page";
import FactionList from "./factions/page";
import FactionPage from "./factions/[id]/page";
import TitleList from "./titles/page";
import TitlePage from "./titles/[id]/page";
import ChainList from "./quest-chains/page";
import ChainPage from "./quest-chains/[id]/page";
import sitemap from "../sitemap";
import { siteSearch } from "@/lib/site-search";
import { emptyCompletion, foldCompletion } from "../../../../kb/src/completion-rollup";

const at = "2026-10-19T00:00:00Z";
let seq = 0;
const row = (installId: string, fields: Record<string, unknown>) => ({ installId, eventId: `e:${++seq}`, capturedAt: at, ...fields });
/** The same row from `n` distinct installs, each its own reporter. */
const from = (n: number, fields: Record<string, unknown>) => ["one", "two", "three", "four"].slice(0, n).map((id) => row(`reporter-${id}`, fields));
const ach = (id: number, name: string, category: string, points: number, criteriaCount: number) =>
  ({ kind: "achievement_catalog", achievementId: id, name, categoryId: 2, category, points, criteriaCount, criteria: criteriaCount > 0 ? [{ text: "Secret criterion text", required: 1 }] : [] });
const rep = (id: number, name: string, header?: string) => ({ kind: "reputation_catalog", factionId: id, name, ...(header ? { header } : {}) });

const rollup = (rows: Record<string, unknown>[]) => foldCompletion(emptyCompletion(), [{ records: rows, grants: [] }]);
const serve = (rows: Record<string, unknown>[]) => store.loadCompletion.mockResolvedValue({ state: rollup(rows), dataAsOf: "2026-10-19T06:30:00.000Z" });

const html = async (el: Promise<ReactNode>) => renderToStaticMarkup(await el);
const search = (s: Record<string, string> = {}) => ({ searchParams: Promise.resolve(s) });
const page = (id: string) => ({ params: Promise.resolve({ id }) });
/** The names linked in the table body, in order. */
const linked = (out: string, kind: string) => [...(out.split("<tbody>")[1] ?? "").matchAll(new RegExp(`href="/database/${kind}/([^"]+)"`, "g"))].map((m) => m[1]);

const rows = [
  ...from(3, ach(4, "Ten Quests", "Quests", 5, 10)),
  ...from(3, ach(9, "Explore Elwynn Forest", "Exploration", 10, 4)),
  ...from(3, ach(2, "Level 10", "General", 10, 0)),
  ...from(2, ach(20, "Only Two Saw This", "General", 5, 1)),
  // Three reporters, three different versions: no version has three backers.
  ...["one", "two", "three"].map((id, i) => row(`reporter-${id}`, ach(30, "Disputed", "General", 5 + i, 1))),
  // Two agree, one differs: still short of three.
  ...from(2, ach(31, "Split Vote", "General", 5, 1)),
  row("reporter-three", ach(31, "Split Vote", "General", 15, 1)),
  ...from(3, { kind: "title_catalog", titleId: 4, name: "Private" }),
  ...from(3, { kind: "title_catalog", titleId: 5, name: "Corporal" }),
  ...from(2, { kind: "title_catalog", titleId: 6, name: "Only Two Titles" }),
  ...["one", "two", "three"].map((id, i) => row(`reporter-${id}`, { kind: "title_catalog", titleId: 7, name: `Split ${i}` })),
  ...from(3, { kind: "quest_chain_catalog", questLineId: 900, name: "The Defias", questIds: [7, 8, 9] }),
  ...from(3, { kind: "quest_chain_catalog", questLineId: 901, name: "Long Road", questIds: [1, 2], truncated: true }),
  ...from(2, { kind: "quest_chain_catalog", questLineId: 902, name: "Two Chain", questIds: [3] }),
  ...from(3, rep(69, "Darnassus", "Alliance")),
  ...from(3, rep(76, "Orgrimmar", "Horde")),
  ...from(3, rep(529, "Argent Dawn")),
  ...from(2, rep(72, "Stormwind", "Alliance")),
  ...["one", "two", "three"].map((id, i) => row(`reporter-${id}`, rep(81, `Thunder Bluff ${i}`, "Horde"))),
];

beforeEach(() => {
  store.loadCompletion.mockReset();
  serve(rows);
  game.factions = []; game.titles = []; game.questLines = []; game.achievements = {};
});

/** The table row that links `href`. */
const rowOf = (out: string, href: string) => out.split("<tr").find((r) => r.includes(`href="${href}"`)) ?? "";

test("factions list shows base entries unconfirmed when the rollup is null", async () => {
  game.factions = [{ id: 72, name: "Stormwind", shown: true }, { id: 1, name: "Hidden Header", shown: false }];
  store.loadCompletion.mockResolvedValue({ state: null, dataAsOf: null, unreachable: true });
  const out = await html(FactionList(search()));
  expect(linked(out, "factions")).toEqual(["72-stormwind"]);
  expect(out).toContain("Unconfirmed");
  expect(out).not.toContain("Hidden Header");
  expect(out).not.toContain("data-empty-state");
  expect(out).not.toContain("unreachable");
});

test("an agreed faction shows as confirmed and keeps the rollup's header", async () => {
  game.factions = [{ id: 69, name: "Darnassus (base)", shown: true }, { id: 72, name: "Stormwind", shown: true }];
  const out = await html(FactionList(search()));
  expect(linked(out, "factions")).toEqual(["69-darnassus", "72-stormwind", "76-orgrimmar", "529-argent-dawn"]);
  const agreed = rowOf(out, "/database/factions/69-darnassus");
  expect(agreed).toContain(">Confirmed<");
  expect(agreed).toContain(">Alliance<");
  expect(agreed).not.toContain("Unconfirmed");
  expect(rowOf(out, "/database/factions/72-stormwind")).toContain(">Unconfirmed<");
});

test("titles, quest chains and achievements list from the base too; statistics stay out", async () => {
  game.titles = [{ id: 7, name: "%s, Champion" }];
  game.questLines = [{ id: 1, name: "The Missing Diplomat", questIds: [11, 10] }];
  game.achievements = { "50": { title: "Loremaster", points: 10, criteria: [{}, {}] }, "51": { title: "Kills", points: 0, criteria: [], statistic: true } };
  store.loadCompletion.mockResolvedValue({ state: null, dataAsOf: null, unreachable: true });
  expect(await html(TitleList(search()))).toContain("Unconfirmed");
  const chains = await html(ChainList(search()));
  expect(linked(chains, "quest-chains")).toEqual(["1-the-missing-diplomat"]);
  expect(chains).toContain(">2<");
  const achievements = await html(AchievementList(search()));
  expect(linked(achievements, "achievements")).toEqual(["50-loremaster"]);
  expect(achievements).not.toContain("Kills");
});

test("the achievement list shows what three reporters agree on and hides the rest", async () => {
  const out = await html(AchievementList(search()));
  expect(linked(out, "achievements")).toEqual(["2-level-10", "4-ten-quests", "9-explore-elwynn-forest"]);
  expect(out).toContain(">Exploration<");
  for (const hidden of ["Only Two Saw This", "Disputed", "Split Vote"]) expect(out).not.toContain(hidden);
  // Criteria wording is for the entry's own page, never the list.
  expect(out).not.toContain("Secret criterion text");
  for (const col of ["Name", "Category", "Points", "Criteria", "ID"]) expect(out).toContain(`>${col}`);
});

test("the faction list shows the standing header, and a faction with no header still lists", async () => {
  const out = await html(FactionList(search()));
  expect(linked(out, "factions")).toEqual(["69-darnassus", "76-orgrimmar", "529-argent-dawn"]);
  for (const hidden of ["Stormwind", "Thunder Bluff"]) expect(out).not.toContain(hidden);
  expect(out).toContain(">Alliance<");
});

test("filters, sort and the name box work from the URL; a bad value is a 404", async () => {
  expect(linked(await html(AchievementList(search({ category: "Quests" }))), "achievements")).toEqual(["4-ten-quests"]);
  expect(linked(await html(AchievementList(search({ q: "elwynn" }))), "achievements")).toEqual(["9-explore-elwynn-forest"]);
  expect(linked(await html(AchievementList(search({ q: "#2" }))), "achievements")).toEqual(["2-level-10"]);
  expect(linked(await html(AchievementList(search({ sort: "-points" }))), "achievements")).toEqual(["2-level-10", "9-explore-elwynn-forest", "4-ten-quests"]);
  expect(linked(await html(FactionList(search({ header: "Horde" }))), "factions")).toEqual(["76-orgrimmar"]);
  expect(await html(AchievementList(search({ category: "Nothing" })))).toContain("No achievements match these filters.");
  await expect(AchievementList(search({ sort: "secret" }))).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(AchievementList(search({ page: "2" }))).rejects.toThrow("NEXT_NOT_FOUND");
});

test("only the plain list is indexed", async () => {
  expect((await achievementListMetadata({ searchParams: Promise.resolve({}) })).robots).toBeUndefined();
  for (const s of [{ q: "ten" }, { category: "Quests" }, { sort: "name" }]) {
    expect((await achievementListMetadata({ searchParams: Promise.resolve(s) })).robots).toMatchObject({ index: false });
  }
});

test("before three players report anything, each list says so and shows no rows", async () => {
  serve(from(2, ach(4, "Ten Quests", "Quests", 5, 10)));
  for (const el of [AchievementList(search()), FactionList(search())]) {
    const out = await html(el);
    expect(out).toContain("data-empty-state");
    expect(out).toContain("once three players report it");
    expect(out).not.toContain("Ten Quests");
  }
});

test("an unreadable rollup says unrecorded, never empty", async () => {
  store.loadCompletion.mockResolvedValue({ state: null, dataAsOf: null, unreachable: true });
  expect(await html(AchievementList(search()))).toContain("unreachable");
  expect(await html(AchievementList(search()))).not.toContain("data-empty-state");
});

test("an achievement page has its facts and is indexed; an unlisted one is a 404", async () => {
  const out = await html(AchievementPage(page("4-ten-quests")));
  expect(out).toContain("Ten Quests");
  expect(out).toContain("Quests");
  expect(out).toContain("5");
  expect(out).not.toContain("Secret criterion text");
  expect((await achievementMetadata(page("4-ten-quests"))).robots).toMatchObject({ index: true });
  expect((await achievementMetadata(page("30-disputed"))).robots).toMatchObject({ index: false });
  await expect(AchievementPage(page("30-disputed"))).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(AchievementPage(page("20"))).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(AchievementPage(page("abc"))).rejects.toThrow("NEXT_NOT_FOUND");
});

test("a bare id or a wrong slug redirects to the canonical address", async () => {
  await expect(AchievementPage(page("4"))).rejects.toThrow("REDIRECT /database/achievements/4-ten-quests");
  await expect(FactionPage(page("69-wrong"))).rejects.toThrow("REDIRECT /database/factions/69-darnassus");
});

test("a faction page shows its header, and one with none says not reported", async () => {
  expect(await html(FactionPage(page("69-darnassus")))).toContain("Alliance");
  expect(await html(FactionPage(page("529-argent-dawn")))).toContain("Not reported");
  await expect(FactionPage(page("72-stormwind"))).rejects.toThrow("NEXT_NOT_FOUND");
});

test("the sitemap lists both lists and only the entries that passed the gate", async () => {
  const paths = (await sitemap()).map((e) => new URL(e.url).pathname);
  expect(paths).toContain("/database/achievements");
  expect(paths).toContain("/database/factions");
  expect(paths).toContain("/database/achievements/4-ten-quests");
  expect(paths).toContain("/database/factions/69-darnassus");
  expect(paths.filter((p) => /^\/database\/(achievements|factions)\//.test(p)).sort()).toEqual(["/database/achievements/2-level-10", "/database/achievements/4-ten-quests", "/database/achievements/9-explore-elwynn-forest", "/database/factions/529-argent-dawn", "/database/factions/69-darnassus", "/database/factions/76-orgrimmar"]);
  store.loadCompletion.mockResolvedValue({ state: null, dataAsOf: null, unreachable: true });
  const down = (await sitemap()).map((e) => new URL(e.url).pathname);
  expect(down).toContain("/database/achievements");
  expect(down.filter((p) => p.startsWith("/database/achievements/"))).toEqual([]);
});

test("site search finds an agreed achievement or faction by name or id, and nothing unlisted", async () => {
  const groups = await siteSearch("elwynn");
  expect(groups.find((g) => g.type === "achievement")!.results[0]).toMatchObject({ label: "Explore Elwynn Forest", href: "/database/achievements/9-explore-elwynn-forest" });
  expect(groups.find((g) => g.type === "achievement")!.heading).toBe("Achievements");
  expect((await siteSearch("darnassus")).find((g) => g.type === "faction")!.results[0].href).toBe("/database/factions/69-darnassus");
  expect((await siteSearch("69")).find((g) => g.type === "faction")!.results[0]).toMatchObject({ href: "/database/factions/69-darnassus", exact: true });
  expect((await siteSearch("disputed")).some((g) => g.type === "achievement")).toBe(false);
  expect((await siteSearch("elwynn", { only: "item" })).some((g) => g.type === "achievement")).toBe(false);
});

test("the title and quest chain lists apply the same three-reporter gate", async () => {
  const titles = await html(TitleList(search()));
  expect(linked(titles, "titles")).toEqual(["4-private", "5-corporal"]);
  for (const hidden of ["Only Two Titles", "Split"]) expect(titles).not.toContain(hidden);
  expect(linked(await html(TitleList(search({ q: "corp" }))), "titles")).toEqual(["5-corporal"]);
  expect(linked(await html(TitleList(search({ sort: "-name" }))), "titles")).toEqual(["4-private", "5-corporal"]);
  const chains = await html(ChainList(search()));
  expect(linked(chains, "quest-chains")).toEqual(["900-the-defias", "901-long-road"]);
  expect(chains).toContain(">2+<");
  expect(chains).not.toContain("Two Chain");
  await expect(TitleList(search({ sort: "points" }))).rejects.toThrow("NEXT_NOT_FOUND");
});

test("title and quest chain pages: facts, quest links, redirects and 404s", async () => {
  expect(await html(TitlePage(page("5-corporal")))).toContain("Corporal");
  await expect(TitlePage(page("6"))).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(TitlePage(page("5"))).rejects.toThrow("REDIRECT /database/titles/5-corporal");
  const chain = await html(ChainPage(page("900-the-defias")));
  expect(chain).toContain("The Defias");
  for (const q of [7, 8, 9]) expect(chain).toContain(`href="/database/quests/${q}"`);
  expect(await html(ChainPage(page("901-long-road")))).toContain("Longer than the 80 quests listed");
  await expect(ChainPage(page("902"))).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(ChainPage(page("900"))).rejects.toThrow("REDIRECT /database/quest-chains/900-the-defias");
});

test("empty and unreadable states for titles and quest chains", async () => {
  serve(from(2, { kind: "title_catalog", titleId: 4, name: "Private" }));
  for (const el of [TitleList(search()), ChainList(search())]) {
    const out = await html(el);
    expect(out).toContain("once three players report it");
    expect(out).not.toContain("Private");
  }
  store.loadCompletion.mockResolvedValue({ state: null, dataAsOf: null, unreachable: true });
  expect(await html(TitleList(search()))).not.toContain("data-empty-state");
});

test("sitemap and search include agreed titles and quest chains only", async () => {
  const paths = (await sitemap()).map((e) => new URL(e.url).pathname);
  for (const p of ["/database/titles", "/database/quest-chains", "/database/titles/5-corporal", "/database/quest-chains/900-the-defias"]) expect(paths).toContain(p);
  expect(paths.filter((p) => /two-titles|two-chain|split/.test(p))).toEqual([]);
  expect((await siteSearch("corporal")).find((g) => g.type === "title")!.results[0].href).toBe("/database/titles/5-corporal");
  expect((await siteSearch("defias")).find((g) => g.type === "chain")!.heading).toBe("Quest chains");
  expect((await siteSearch("900")).find((g) => g.type === "chain")!.results[0]).toMatchObject({ exact: true });
  expect((await siteSearch("two chain")).some((g) => g.type === "chain")).toBe(false);
});

test("an achievement page lists its criteria once three players sent the same full list", async () => {
  serve([...rows, ...from(3, { ...ach(5, "Two Steps", "General", 5, 2), criteria: [{ text: "Visit Goldshire", required: 1 }, { text: "Kill 12 Kobolds", required: 12 }] })]);
  expect(await html(AchievementList(search()))).not.toContain("Visit Goldshire");
  const out = await html(AchievementPage(page("5-two-steps")));
  expect(out).toContain("Criteria of Two Steps");
  expect(out).toContain("Visit Goldshire");
  expect(out).toContain("Kill 12 Kobolds");
  expect(out).toContain(">12<");
  // A list cut short of the count is not shown, and the page says when it will be.
  const partial = await html(AchievementPage(page("4-ten-quests")));
  expect(partial).not.toContain("Secret criterion text");
  expect(partial).toContain("The criteria show once three players report the same full list.");
});
