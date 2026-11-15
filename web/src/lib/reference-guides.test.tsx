import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { REFERENCE_GUIDES, publicReferenceGuides, referenceMetadata } from "./reference-guides";
import { loadReferenceSpells } from "./reference-spell-names";
import ReferencePage from "@/components/reference/ReferencePage";
import { llmsFullTxt, llmsTxt } from "./llms";
import classes from "@/data/game-data/client-class-spells.json";
import { CLASS_LAYOUTS, starterMacros } from "@/data/reference-spells";
import GuidesIndex, { generateMetadata as indexMetadata } from "@/app/guides/page";
import { RAID_CHECKLIST } from "@/data/reference-content";
import recipes from "@/data/game-data/client-recipes.json";
import relationships from "@/data/game-data/client-layer.json";

vi.mock("@/lib/reference-spell-names", () => ({ loadReferenceSpells: vi.fn(async () => CLASS_LAYOUTS) }));

const gate = vi.hoisted(() => ({ published: false }));
vi.mock("@/lib/reference-guide-status", () => ({ get REFERENCE_GUIDES_PUBLISHED() { return gate.published; } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/guides", notFound: () => { throw Error("not found"); } }));
beforeEach(() => { gate.published = false; });

test("all six reference URLs render a visible draft notice and request noindex", async () => {
  expect(REFERENCE_GUIDES.map((g) => g.slug)).toEqual(["glossary", "keybinds", "macros", "stats", "pvp", "raid-prep"]);
  expect(publicReferenceGuides()).toEqual([]);
  for (const guide of REFERENCE_GUIDES) {
    expect(referenceMetadata(guide.slug).robots).toEqual({ index: false, follow: true });
    expect(renderToStaticMarkup(await ReferencePage({ slug: guide.slug }))).toContain("Draft, not reviewed yet");
    const route = readFileSync(`src/app/guides/${guide.slug}/page.tsx`, "utf8");
    expect(route).toContain("referenceMetadata");
    expect(route).toContain(`slug="${guide.slug}"`);
  }
});

test("drafts are absent from both text maps and global navigation", async () => {
  const maps = [llmsTxt(), await llmsFullTxt([]), readFileSync("src/components/Header.tsx", "utf8"), renderToStaticMarkup(await GuidesIndex({ searchParams: Promise.resolve({}) }))];
  for (const guide of REFERENCE_GUIDES) for (const map of maps) expect(map).not.toContain(`/guides/${guide.slug}`);
});

test("the one publication flag exposes links and indexing and removes the draft notice", async () => {
  gate.published = true;
  expect(publicReferenceGuides()).toHaveLength(6);
  expect((await indexMetadata({ searchParams: Promise.resolve({}) })).description).toContain("reference");
  const maps = [llmsTxt(), await llmsFullTxt([]), renderToStaticMarkup(await GuidesIndex({ searchParams: Promise.resolve({}) }))];
  for (const guide of REFERENCE_GUIDES) {
    expect(referenceMetadata(guide.slug).robots).toEqual({ index: true, follow: true });
    expect(renderToStaticMarkup(await ReferencePage({ slug: guide.slug }))).not.toContain("Draft, not reviewed yet");
    for (const map of maps) expect(map).toContain(`/guides/${guide.slug}`);
  }
});

test("every raid checklist item link names an item present in held client data", () => {
  const outputs = new Set(recipes.professions.flatMap((p) => p.recipes.map((r) => r[1])));
  for (const row of RAID_CHECKLIST.filter((item) => item.href)) {
    const id = Number(row.href!.split("/").at(-1));
    expect(outputs.has(id) || relationships.edges.some((e) => e[0] === "item" && e[1] === id)).toBe(true);
  }
});

test("raid supply labels match the held profession, without an unverified mana claim", () => {
  for (const id of [14530, 13446, 13444]) {
    const profession = recipes.professions.find((p) => p.recipes.some((r) => r[1] === id))!;
    const row = RAID_CHECKLIST.find((item) => item.href === `/database/items/${id}`)!;
    expect(row.text).toContain(`${profession.name} recipe output ${id}`);
    expect(row.linkText).toContain(`${profession.name} output item ${id}`);
  }
  expect(RAID_CHECKLIST.find((item) => item.href?.endsWith("13444"))!.text).not.toMatch(/mana/i);
});

test("clear control and defensive spells are represented and talent examples are qualified", async () => {
  expect(CLASS_LAYOUTS.paladin["crowd-control"]).toBeDefined();
  expect(CLASS_LAYOUTS.hunter.defensive).toBeDefined();
  expect(CLASS_LAYOUTS.rogue.defensive).toBeDefined();
  const html = renderToStaticMarkup(await ReferencePage({ slug: "macros" }));
  expect(html).toContain("Talent-dependent examples");
  expect(html).toContain("not starting-level abilities");
});

test("every suggested or macro spell exists for its class in the held Forever extract", () => {
  for (const [classSlug, layout] of Object.entries(CLASS_LAYOUTS)) {
    for (const spell of Object.values(layout)) {
      if (!spell) continue;
      expect(classes.classes[classSlug as keyof typeof classes.classes].spells).toContain(spell.id);
      expect(Object.keys(spell)).toEqual(["id"]);
    }
  }
  expect(starterMacros(CLASS_LAYOUTS)).toEqual([]);
});

test("rendered private spell names carry the quiet marker and missing names have no macro", async () => {
  vi.mocked(loadReferenceSpells).mockResolvedValueOnce({ warrior: { cooldowns: { id: 12328, name: "Example private spell" } } });
  const html = renderToStaticMarkup(await ReferencePage({ slug: "macros" }));
  expect(html).toContain("/cast Example private spell");
  expect(html).toContain('data-badge="files"');
  expect(html).toContain("From the game files, not yet confirmed by players");
  const missing = renderToStaticMarkup(await ReferencePage({ slug: "macros" }));
  expect(missing).not.toContain("/cast Spell ");
  expect(missing).not.toContain("Copy warrior macro");
});
