import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { guideHref, guidesDir, guidesFor, loadGuides, publishedGuide, publishedGuides } from "./guides";
import { fixture } from "./talents/fixture";
import { encodeBuild, encodeOrder } from "./talents/share";
import type { Ranks } from "./talents/types";

const RANKS: Ranks = { 11: { rank: 5 }, 21: { rank: 1 } };
const code = (classSlug: string) => encodeBuild({ classSlug, specId: fixture.specId, build: fixture.build, ranks: RANKS });
const order = (origin: "planned" | "provisional") => encodeOrder(RANKS, [11, 11, 11, 11, 11, 21], origin)!;

interface Fixture { id: number; slug: string; title: string; status?: string; classSlug?: string; activity?: string; roles?: string; levels?: string; order?: string; reviewed?: string }

const REVIEWED = "{ by: Kai, on: 2026-10-20, build: 1.0.0.1 }";

function guide(g: Fixture): string {
  const status = g.status ?? "published";
  const reviewed = g.reviewed ?? (status === "published" ? REVIEWED : "null");
  return `---
id: ${g.id}
slug: ${g.slug}
version: 1
status: ${status}
title: ${g.title}
summary: "A test guide."
classSlug: ${g.classSlug ?? "mage"}
activity: ${g.activity ?? "leveling"}
roles: ${g.roles ?? "[damage]"}
levels: ${g.levels ?? "{ from: 10, to: 60 }"}
code: ${code(g.classSlug ?? "mage")}
order: ${g.order ?? order("planned")}
author: Robin
reviewed: ${reviewed}
history: ${reviewed === "null" ? "[]" : "[{ version: 1, on: 2026-10-20, by: Kai, build: 1.0.0.1, note: First published version. }]"}
---

## Who it is for

Test words.
`;
}

const GUIDES: Fixture[] = [
  { id: 1, slug: "frost-leveling", title: "Frost leveling" },
  { id: 2, slug: "arcane-dungeons", title: "Arcane in dungeons", activity: "dungeons", roles: "[damage]", levels: "{ from: 40, to: 60 }" },
  { id: 3, slug: "warrior-tanking", title: "Warrior tanking", classSlug: "warrior", activity: "dungeons", roles: "[tank, damage]", levels: "{ from: 20, to: 60 }" },
  { id: 4, slug: "fire-leveling", title: "Fire leveling", status: "draft" },
  // Published on paper, but breaking the contract: the reader leaves both out, like a draft.
  { id: 5, slug: "unreviewed", title: "Unreviewed", reviewed: "null" },
  { id: 6, slug: "provisional", title: "Provisional order", order: order("provisional") },
];

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "guides-"));
  writeFileSync(join(dir, "README.md"), "# not a guide");
  for (const g of GUIDES) writeFileSync(join(dir, `${g.slug}.md`), guide(g));
  // A file whose slug is not its name is not read either.
  writeFileSync(join(dir, "misnamed.md"), guide({ id: 7, slug: "named-otherwise", title: "Misnamed" }));
  return dir;
}

test("every guide that parses is read, drafts included; a published guide that breaks the contract is not", () => {
  const guides = loadGuides(fixtureDir());
  expect([...guides.keys()].sort()).toEqual(["arcane-dungeons", "fire-leveling", "frost-leveling", "warrior-tanking"]);
  expect(guides.get("frost-leveling")).toMatchObject({ version: 1, reviewed: { by: "Kai", on: "2026-10-20", build: "1.0.0.1" }, history: [{ version: 1 }], sources: [] });
  expect(guides.get("frost-leveling")?.blocks[0]).toMatchObject({ type: "heading", text: "Who it is for" });
});

test("drafts never leave the reader: publishedGuides, publishedGuide and guidesFor skip them", () => {
  const guides = loadGuides(fixtureDir());
  expect(publishedGuides(guides).map((g) => g.slug)).toEqual(["arcane-dungeons", "frost-leveling", "warrior-tanking"]);
  expect(publishedGuide(guides, "fire-leveling")).toBeNull();
  expect(publishedGuide(guides, "unreviewed")).toBeNull();
  expect(publishedGuide(guides, "frost-leveling")?.title).toBe("Frost leveling");
  expect(guidesFor(guides, { classSlug: "mage", activity: "leveling" }).map((g) => g.slug)).toEqual(["frost-leveling"]);
});

test("guidesFor narrows by class, activity, role and level", () => {
  const guides = loadGuides(fixtureDir());
  const slugs = (filter: Parameters<typeof guidesFor>[1]) => guidesFor(guides, filter).map((g) => g.slug);
  expect(slugs({ classSlug: "mage" })).toEqual(["frost-leveling", "arcane-dungeons"]);
  expect(slugs({ classSlug: "mage", activity: "dungeons" })).toEqual(["arcane-dungeons"]);
  expect(slugs({ classSlug: "mage", level: 25 })).toEqual(["frost-leveling"]);
  expect(slugs({ classSlug: "mage", level: 60 })).toEqual(["frost-leveling", "arcane-dungeons"]);
  expect(slugs({ classSlug: "warrior", role: "tank" })).toEqual(["warrior-tanking"]);
  expect(slugs({ classSlug: "warrior", role: "healer" })).toEqual([]);
  expect(slugs({ classSlug: "druid" })).toEqual([]);
});

test("a guide's address is /guides/<slug>, and the site reads the committed guides from kb/guides", () => {
  expect(guideHref("frost-leveling")).toBe("/guides/frost-leveling");
  expect(guidesDir()).toBe(join(process.cwd(), "..", "kb", "guides"));
  expect(loadGuides().has("README")).toBe(false);
});
