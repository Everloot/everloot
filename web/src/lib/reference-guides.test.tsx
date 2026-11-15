import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { REFERENCE_GUIDES, publicReferenceGuides, referenceMetadata } from "./reference-guides";
import ReferencePage from "@/components/reference/ReferencePage";
import { llmsFullTxt, llmsTxt } from "./llms";
import classes from "@/data/game-data/client-class-spells.json";
import values from "@/data/game-data/spell-values.json";
import { CLASS_LAYOUTS, STARTER_MACROS } from "@/data/reference-spells";
import GuidesIndex, { generateMetadata as indexMetadata } from "@/app/guides/page";
import { RAID_CHECKLIST } from "@/data/reference-content";
import recipes from "@/data/game-data/client-recipes.json";
import relationships from "@/data/game-data/client-layer.json";

const gate = vi.hoisted(() => ({ published: false }));
vi.mock("@/lib/reference-guide-status", () => ({ get REFERENCE_GUIDES_PUBLISHED() { return gate.published; } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/guides", notFound: () => { throw Error("not found"); } }));
beforeEach(() => { gate.published = false; });

test("all six reference URLs render a visible draft notice and request noindex", () => {
  expect(REFERENCE_GUIDES.map((g) => g.slug)).toEqual(["glossary", "keybinds", "macros", "stats", "pvp", "raid-prep"]);
  expect(publicReferenceGuides()).toEqual([]);
  for (const guide of REFERENCE_GUIDES) {
    expect(referenceMetadata(guide.slug).robots).toEqual({ index: false, follow: true });
    expect(renderToStaticMarkup(<ReferencePage slug={guide.slug} />)).toContain("Draft, not reviewed yet");
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
    expect(renderToStaticMarkup(<ReferencePage slug={guide.slug} />)).not.toContain("Draft, not reviewed yet");
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

test("every suggested or macro spell exists for its class in the held Forever extract", () => {
  for (const [classSlug, layout] of Object.entries(CLASS_LAYOUTS)) {
    for (const spell of Object.values(layout)) {
      if (!spell) continue;
      expect(classes.classes[classSlug as keyof typeof classes.classes].spells).toContain(spell.id);
      expect((values.spells as Record<string, { name: string }>)[spell.id]?.name).toBe(spell.name);
      expect(spell.evidence.length).toBeGreaterThan(10);
    }
  }
  expect(STARTER_MACROS).toHaveLength(9);
  for (const macro of STARTER_MACROS) {
    expect(classes.classes[macro.classSlug as keyof typeof classes.classes].spells).toContain(macro.spell.id);
    expect(macro.text).toBe(`/cast ${macro.spell.name}`);
  }
});
