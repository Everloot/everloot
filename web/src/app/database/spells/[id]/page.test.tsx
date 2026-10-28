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
  expect(page).not.toContain("The files say it creates nothing.");
  expect(page).not.toContain("The files say it costs nothing.");
  expect(page).toContain(`The files say it creates ${made.length} ${made.length === 1 ? "item" : "items"} and costs ${reagents.length}`);
});

test("a named spell whose only relations are what it creates and costs is indexed", async () => {
  known([[crafted, "Some Recipe"]]);
  expect((await generateMetadata(props(String(crafted)))).robots).toMatchObject({ index: true, follow: true });
});
