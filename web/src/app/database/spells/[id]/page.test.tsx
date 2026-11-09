import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
// The game files' spell names and whether upload storage answered; no names file and storage down unless a test sets them.
const files = vi.hoisted(() => ({ spells: null as { version: string; names: Map<number, string> } | null, unreachable: true }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSpellNames: async () => files.spells,
}));
vi.mock("@/lib/edges", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/edges")>();
  return { ...real, loadEdges: async () => ({ observed: [], client: real.CLIENT_EDGES, unreachable: files.unreachable, dataAsOf: null }) };
});

import SpellPage, { generateMetadata } from "./page";
import { CLIENT_EDGES } from "@/lib/edges";
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from "@/lib/seo";

afterEach(() => { files.spells = null; files.unreachable = true; });

const props = (id: string) => ({ params: Promise.resolve({ id }) });
const render = async (id: string) => renderToStaticMarkup(await SpellPage(props(id)));
// A spell the client layer says a profession teaches, and one only an item's "created by" points at.
const taught = CLIENT_EDGES.find((e) => e.fromKind === "spell" && e.rel === "in_skill_line")!.fromId;
const creator = CLIENT_EDGES.find((e) => e.toKind === "spell" && e.rel === "created_by" && !CLIENT_EDGES.some((x) => x.fromKind === "spell" && x.fromId === e.toId))!.toId;
// A spell the items say it creates and costs: both edges point from the item to the spell, and none starts at it.
const crafted = CLIENT_EDGES.find((e) => e.rel === "created_by"
  && CLIENT_EDGES.some((x) => x.rel === "reagent_for" && x.toId === e.toId)
  && !CLIENT_EDGES.some((x) => x.fromKind === "spell" && x.fromId === e.toId))!.toId;
const into = (rel: string) => CLIENT_EDGES.filter((e) => e.toKind === "spell" && e.toId === crafted && e.rel === rel).map((e) => e.fromId);
const known = (names: [number, string][]) => {
  files.spells = { version: "1.60.1.70532", names: new Map(names) };
  files.unreachable = false;
};

test("a spell page says what it is, in short, and names the build it was read from", async () => {
  const page = await render("1234");
  expect(page).toContain("In short");
  expect(page).toContain("Build");
  expect(page).toContain("Copy for AI");
  // The page says where the numbers come from, the way every other database page does.
  expect(page).toContain('href="/database#reading"');
});

test("a spell page is not indexed before it has a name", async () => {
  expect(await render("1234")).toContain("Spell 1234");
  expect((await generateMetadata(props("1234"))).robots).toMatchObject({ index: false, follow: true });
});

test("an id the game files, the uploads and the relations know nothing about is a 404, not an empty page", async () => {
  known([[taught, "Some Craft"]]);
  await expect(render("999999999")).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(generateMetadata(props("999999999"))).rejects.toThrow("NEXT_NOT_FOUND");
});

test("without the names file or with storage out of reach, no id is ruled out", async () => {
  files.unreachable = false;
  expect(await render("999999999")).toContain("Spell 999999999");
  known([]);
  files.unreachable = true;
  expect((await generateMetadata(props("999999999"))).robots).toMatchObject({ index: false });
});

test("a known spell with nothing past its name is noindex; one with a relation is indexed", async () => {
  known([[1234, "Name Only"], [taught, "Some Craft"]]);
  expect(await render("1234")).toContain("Name Only");
  expect((await generateMetadata(props("1234"))).robots).toMatchObject({ index: false, follow: true });
  expect((await generateMetadata(props(String(taught)))).robots).toMatchObject({ index: true, follow: true });
});

test("a spell only an item points at is known, and without a name it is noindex", async () => {
  known([]);
  expect(await render(String(creator))).toContain(`Spell ${creator}`);
  expect((await generateMetadata(props(String(creator)))).robots).toMatchObject({ index: false });
});

test("Creates and Costs list the items whose edges point at the spell", async () => {
  const [made, reagents] = [into("created_by"), into("reagent_for")];
  expect(made.length).toBeGreaterThan(0);
  expect(reagents.length).toBeGreaterThan(0);
  const page = await render(String(crafted));
  for (const item of [...made, ...reagents]) expect(page).toContain(`href="/database/items/${item}"`);
  expect(page).toContain('data-tab-panel="creates"');
  expect(page).toContain('data-tab-panel="costs"');
  // Nothing teaches it in the files, and no player report could: the empty tab is left out rather than shown empty.
  expect(page).not.toContain('data-tab-panel="taught-by"');
  expect(page).toContain(`The files say it creates ${made.length} ${made.length === 1 ? "item" : "items"} and costs ${reagents.length}`);
});

test("a spell the files relate to nothing gets one plain line naming the build, never the addon link or the meter", async () => {
  known([[1234, "Name Only"]]);
  const page = await render("1234");
  expect(page).toMatch(/The game files list nothing here \(build 1\.60\.1\.\d+\)\./);
  expect(page).not.toContain('role="tab"');
  expect(page).not.toContain("Get the addon");
  expect(page).not.toContain("data-agreement");
  // The quick facts count from the files too: a zero, not a meter waiting on a report.
  expect(page).toContain(">0</span>");
});

test("a named spell is titled like the other database pages, with the brand added once by the layout", async () => {
  // Without a name the title stays the id, as before.
  expect((await generateMetadata(props("1234"))).title).toBe("Spell 1234");
  known([[taught, "Some Craft"]]);
  const m = await generateMetadata(props(String(taught)));
  expect(m.title).toBe("Some Craft – WoW Forever spell");
  expect(m.description).toContain("Some Craft is a spell in WoW: Forever.");
  expect(m.description).toContain(`Spell ID ${taught}.`);
  expect((m.openGraph as { title?: string }).title).toBe("Some Craft – WoW Forever spell · Everloot");
  expect((m.twitter as { card?: string }).card).toBe("summary_large_image");
});

test("a long spell name still leaves a description within the limits", async () => {
  const long = "Greater Blessing of the Ancient Watchers of the Emerald Dream";
  known([[taught, long]]);
  const description = String((await generateMetadata(props(String(taught)))).description);
  expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  expect(description.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
  expect(description).toContain(long);
  // At the name length where the full form first overruns, the short form must still clear the minimum.
  const boundary = "Enchant Weapon - Lesser Strikingxxxxx".slice(0, 37 - String(taught).length);
  known([[taught, boundary]]);
  const edge = String((await generateMetadata(props(String(taught)))).description);
  expect(edge).not.toContain("from the game files");
  expect(edge.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  expect(edge.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
});

test("a named spell whose only relations are what it creates and costs is indexed", async () => {
  known([[crafted, "Some Recipe"]]);
  expect((await generateMetadata(props(String(crafted)))).robots).toMatchObject({ index: true, follow: true });
});
