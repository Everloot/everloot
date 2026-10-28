import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn(), loadCompletion: vi.fn(), loadState: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus, loadCompletion: store.loadCompletion },
  sharingStore: { loadState: store.loadState },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import CollectionsPage from "./page";
import { emptyCompletion, foldCompletion } from "../../../../../kb/src/completion-rollup";
import type { PublicationGrant } from "../../../../../kb/src/publication";

const at = "2026-10-19T00:00:00Z";
let seq = 0;
const row = (installId: string, fields: Record<string, unknown>): Record<string, unknown> => ({ installId, eventId: `e:${++seq}`, capturedAt: at, ...fields });
const three = (fields: Record<string, unknown>) => ["reporter-one", "reporter-two", "reporter-three"].map((id) => row(id, fields));
const mine = (fields: Record<string, unknown>) => row("owner-install", { characterKey: "0a1b2c3d", class: "MAGE", level: 40, ...fields });

const records = [
  ...three({ kind: "achievement_catalog", achievementId: 1, name: "Ten Quests", categoryId: 2, category: "Quests", points: 5, criteriaCount: 10, criteria: [] }),
  ...three({ kind: "reputation_catalog", factionId: 69, name: "Darnassus", header: "Alliance" }),
  ...three({ kind: "title_catalog", titleId: 4, name: "Private" }),
  ...three({ kind: "quest_chain_catalog", questLineId: 900, name: "The Defias", questIds: [7, 8, 9, 10] }),
  mine({ kind: "achievement_owned", achievementId: 1, completed: false, criteriaMet: 8, criteriaTotal: 10 }),
  mine({ kind: "reputation_owned", factionId: 69, reaction: 5, standing: 8500, floor: 3000, ceiling: 9000 }),
  mine({ kind: "title_owned", titleIds: [4] }),
  mine({ kind: "quest_owned", questIds: [7, 8, 9] }),
];

const render = async (searchParams: Record<string, string>) =>
  renderToStaticMarkup(await CollectionsPage({ searchParams: Promise.resolve(searchParams) }));

const hash = "a".repeat(64);
const grant: PublicationGrant = { tokenHash: hash, installId: "owner-install", realm: "Forever", subjectType: "install", subject: "owner-install",
  categories: ["collection"], expiresAt: "2099-01-01T00:00:00Z", verifiedBy: "operator", evidence: "test", revokedAt: null };
/** The cron's completion rollup of these rows, uploaded with the owner's sharing token. */
const rollup = (rows: Record<string, unknown>[]) => foldCompletion(emptyCompletion(), [{ records: rows, grants: [hash] }]);

beforeEach(() => {
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 1, records: [], dataAsOf: "2026-10-19T06:30:00.000Z" });
  store.loadCompletion.mockReset().mockResolvedValue({ state: rollup(records), dataAsOf: "2026-10-19T06:30:00.000Z" });
  store.loadState.mockReset().mockResolvedValue({ grants: [grant], suppressions: [] });
});

test("with no install the overview is the agreed lists with nothing counted as done", async () => {
  const html = await render({});
  expect(html).toContain("Enter an install id");
  expect(html).toContain("Total complete");
  // One achievement, one faction, one title and one chain are agreed: 0 of 4, no percentage, nobody's progress.
  expect(html).toMatch(/aria-label="Total complete" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0"/);
  expect(html).not.toMatch(/ · \d+%/);
  expect(html).not.toContain("Friendly");
  expect(html).not.toContain("Closest to done");
  expect(store.loadCorpus).not.toHaveBeenCalled();
});

test("with no collection upload yet, the gap view is the empty state", async () => {
  const html = await render({ view: "gap" });
  expect(html).toContain("No collection list yet");
  expect(html).toContain("data-empty-state");
});

test("once collection lists exist, the gap box asks for a collection", async () => {
  store.loadCorpus.mockResolvedValue({
    uploads: 3, dataAsOf: null,
    records: three({ kind: "collection_catalog", collection: "Mounts", itemId: 1, source: "Vendor" }),
  });
  expect(await render({ view: "gap" })).toContain("Name a collection.");
});

test("an install that uploaded no completion data gets an honest empty state, not zeros", async () => {
  const html = await render({ install: "stranger-install" });
  expect(html).toContain("No completion data from this install");
  expect(html).toContain("unrecorded, not zero");
  expect(html).toContain("/everloot completion on");
  expect(html).not.toContain('role="progressbar"');
  expect(html).not.toContain("Name a collection.");
});

test("a character shows what is done and what is closest to done", async () => {
  const html = await render({ install: "owner-install" });
  expect(html).toContain("Mage level 40");
  expect(html).toContain("key 0a1b2c3d");
  // One title of four agreed entries is done.
  expect(html).toMatch(/aria-label="Total complete" aria-valuemin="0" aria-valuemax="4" aria-valuenow="1"/);
  expect(html).toContain("1 of 4 · 25%");
  expect(html).toContain("Achievements closest to done");
  expect(html).toContain("Ten Quests");
  expect(html).toContain("Quests · 8 of 10 criteria");
  expect(html).toContain("Darnassus");
  expect(html).toContain("Friendly · 500 to go");
  expect(html).toContain("The Defias");
  expect(html).toContain("3 of 4 quests");
  expect(html).toContain('aria-label="Titles"');
  // Total, then Quests achievements, Reputation and its Alliance header, Titles, Quest chains.
  expect(html.match(/role="progressbar"/g)).toHaveLength(6);
  expect(html).toContain('href="/tools/collections?view=achievements-quests&amp;install=owner-install&amp;character=0a1b2c3d"');
  expect(html).toContain("Data as of 2026-10-19 06:30 UTC");
});

test("a character key that is not in the upload is named, and the collection box still works", async () => {
  expect(await render({ install: "owner-install", character: "ffffffff" })).toContain("No character ffffffff");
  expect(await render({ install: "owner-install", collection: "Mounts" })).toContain("Collection gap");
});

test("when the lists are not public yet the page says so instead of showing a measured zero", async () => {
  store.loadCompletion.mockResolvedValue({ state: rollup(records.filter((r) => String(r.kind).endsWith("_owned"))), dataAsOf: null });
  store.loadCorpus.mockResolvedValue({ uploads: 1, records: [], dataAsOf: null });
  const html = await render({ install: "owner-install" });
  expect(html).toContain("No list is public yet");
  expect(html).toContain("Data age unrecorded");
});

test("an unreachable store is said to be unreachable", async () => {
  store.loadCorpus.mockResolvedValue({ unreachable: true, uploads: 0, records: [] });
  store.loadCompletion.mockResolvedValue({ state: null, dataAsOf: null, unreachable: true });
  const html = await render({ install: "owner-install" });
  expect(html).not.toContain('role="progressbar"');
  expect(html).toMatch(/unreachable|unavailable|could not/i);
});

test("two installs agreeing is not enough: the lists stay unpublished", async () => {
  store.loadCompletion.mockResolvedValue({ state: rollup(records.filter((r) => r.installId !== "reporter-three")), dataAsOf: null });
  const html = await render({ install: "owner-install" });
  expect(html).toContain("No list is public yet");
  expect(html).not.toContain("Ten Quests");
  expect(html).not.toContain("Darnassus");
});

test("without a live grant the owner's progress is not shown", async () => {
  store.loadState.mockResolvedValue({ grants: [{ ...grant, revokedAt: "2026-10-18T00:00:00Z" }], suppressions: [] });
  const html = await render({ install: "owner-install" });
  expect(html).toContain("No completion data from this install");
  expect(html).not.toContain("Friendly · 500 to go");
});

test("without an install the page does not read the completion rollup", async () => {
  await render({ collection: "Mounts" });
  expect(store.loadCompletion).not.toHaveBeenCalled();
});

test("when older characters gave way the page says so, instead of acting as if they never uploaded", async () => {
  const keys = Array.from({ length: 9 }, (_, i) => `0000000${i}`);
  const state = foldCompletion(emptyCompletion(), keys.map((characterKey, i) => ({
    records: [{ ...mine({ kind: "title_owned", titleIds: [4] }), characterKey, capturedAt: `2026-10-0${i + 1}T00:00:00Z` }], grants: [hash],
  })));
  store.loadCompletion.mockResolvedValue({ state, dataAsOf: null });
  const html = await render({ install: "owner-install" });
  expect(html).toContain("1 older character is no longer kept for this install");
  expect(html).not.toContain("key 00000000");
});

// A Quests category with one done, one started and one untouched achievement.
const detailRecords = [
  ...records,
  ...three({ kind: "achievement_catalog", achievementId: 2, name: "Twenty Quests", categoryId: 2, category: "Quests", points: 10, criteriaCount: 1, criteria: [] }),
  ...three({ kind: "achievement_catalog", achievementId: 3, name: "Five Quests", categoryId: 2, category: "Quests", points: 5, criteriaCount: 1, criteria: [] }),
  mine({ kind: "achievement_owned", achievementId: 3, completed: true, earnedByMe: true, criteriaMet: 1, criteriaTotal: 1 }),
];
const detail = (show?: string) =>
  render({ install: "owner-install", view: "achievements-quests", ...(show ? { show } : {}) });
const names = (html: string) => ["Five Quests", "Ten Quests", "Twenty Quests"].filter((n) => html.includes(`>${n}</a>`));

test("a category's detail view lists its rows, and each filter is a GET link", async () => {
  store.loadCompletion.mockResolvedValue({ state: rollup(detailRecords), dataAsOf: null });
  const all = await detail();
  expect(names(all)).toEqual(["Five Quests", "Ten Quests", "Twenty Quests"]);
  expect(all).toContain("Quests achievements");
  expect(all).toContain("8 of 10 criteria");
  for (const show of ["done", "missing", "started"]) {
    expect(all).toContain(`href="/tools/collections?view=achievements-quests&amp;install=owner-install&amp;character=0a1b2c3d&amp;show=${show}"`);
  }
  expect(all).toContain('href="/database/achievements/1-ten-quests"');

  expect(names(await detail("done"))).toEqual(["Five Quests"]);
  expect(names(await detail("missing"))).toEqual(["Ten Quests", "Twenty Quests"]);
  expect(names(await detail("started"))).toEqual(["Ten Quests"]);
});

test("a filter with nothing in it says so and links back to all", async () => {
  const html = await detail("done");
  expect(html).toContain("Nothing done here.");
  expect(html).toContain('>Show all</a>');
});

test("a reputation detail calls a standing below the top started", async () => {
  const html = await render({ install: "owner-install", view: "reputation", show: "started" });
  expect(html).toContain(">Darnassus</a>");
  expect(html).toContain("Friendly, 500 to go");
});

test("with no install a detail view lists the agreed rows without filters or status", async () => {
  store.loadCompletion.mockResolvedValue({ state: rollup(detailRecords), dataAsOf: null });
  const html = await render({ view: "achievements-quests" });
  expect(names(html)).toEqual(["Five Quests", "Ten Quests", "Twenty Quests"]);
  expect(html).not.toContain("show=done");
  expect(html).not.toContain("criteria");
  expect(html).toContain("Enter an install id to see which of these a character has done.");
});

test("before any list is agreed there is one framed empty state and no bars", async () => {
  store.loadCompletion.mockResolvedValue({ state: rollup([]), dataAsOf: null });
  const html = await render({});
  expect(html.match(/data-empty-state/g)).toHaveLength(1);
  expect(html).toContain("No list is public yet");
  expect(html).not.toContain('role="progressbar"');
});

test("the remember helper is offered for a chosen character and makes no request", async () => {
  const html = await render({ install: "owner-install" });
  expect(html).toContain("Remember this character on this browser");
  expect(await render({})).not.toContain("Remember this character");
});