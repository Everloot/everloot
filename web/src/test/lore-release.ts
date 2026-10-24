import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../../kb/src/db";
import { replaceSourceRows } from "../../../kb/src/entities";
import { snapshot } from "../../../kb/src/snapshot";

const EMPTY_FACETS: Record<"expansion" | "profession" | "class" | "race" | "zone" | "faction", string[]> = { expansion: [], profession: [], class: [], race: [], zone: [], faction: [] };

/**
 * Test-only: an approved release in a temp dir with the fixture rows the lore tests share.
 * Rows: Thrall (1, indexable, categories, npc with race Orc / class Shaman and an npcbox), Stub (2,
 * untyped), a redirect (3), two "Return to Sender" (4 npc, 5 quest with faction Horde), a page saying
 * "redirected" in lowercase (6, indexable, zone, damaged), Zul'Gurub Eagle (7, npc in zone Zul'Gurub),
 * "100% Done" (8, quest), 22 "Zone n" pages mentioning grommash (100..121, type zone; odd ids Legion,
 * even ids Battle for Azeroth), and the curated forever launch date plus a curated item that must stay
 * out of lore search. `typed: false` builds the same rows with no type data, like the 2026-10-05
 * release; `facets: false` keeps the types but drops the manifest facet totals — an artifact the
 * serving gate refuses, because a typed release without them would serve slow scan paths. `dir` writes
 * into that folder instead of a new temp dir (used by `npm run sample-release`). `landing: true` adds the
 * landing's rows: two "Start here" pages (Alliance 481380, Orc 19317), two zones with the zone infobox
 * (Durotar 200, Ashenvale 201) and a town (Razor Hill 202) that the zone list leaves out.
 */
export async function buildLoreRelease(options: { typed?: boolean; facets?: boolean; dir?: string; landing?: boolean } = {}): Promise<string> {
  const typed = options.typed ?? true;
  const withFacets = options.facets ?? true;
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "everloot-lore-"));
  mkdirSync(dir, { recursive: true });
  const source = openDb(join(dir, "source.sqlite"));
  const wiki = (extId: string, name: string, body: string, data?: Record<string, unknown>) => ({
    kind: "lore_page" as const, extId, name, body, data: typed ? data : stripTypes(data), gameVersion: "lore" as const,
    sourceUrl: `https://warcraft.wiki.gg/wiki/${name.replace(/ /g, "_")}`, retrievedAt: "2023-11-13",
  });
  const facets = (over: Partial<typeof EMPTY_FACETS>) => ({ ...EMPTY_FACETS, ...over });
  const rows = [
    wiki("1", "Thrall", `Thrall is the former Warchief of the Horde. ${"He led his people. ".repeat(20)}\n\n * Son of Durotan\n * Friend of Jaina`, {
      categories: ["Orcs", "Warchiefs"], revisionTimestamp: "2023-01-14T21:40:10Z", type: "npc",
      facets: facets({ race: ["Orc"], class: ["Shaman"] }), infobox: { template: "npcbox", fields: { race: "Orc", title: "Warchief" } }, damaged: false,
    }),
    wiki("2", "Stub", "Short.", { categories: [], revisionTimestamp: "2022-01-01T00:00:00Z" }),
    wiki("3", "Old Name", "#REDIRECT [[Thrall]]"),
    wiki("4", "Return to Sender", `An animated letter. ${"It flies. ".repeat(40)}`, { type: "npc", facets: EMPTY_FACETS, damaged: false }),
    wiki("5", "Return to Sender", `An achievement. ${"Defeat him. ".repeat(40)}`, { type: "quest", facets: facets({ faction: ["Horde"] }), damaged: false }),
    wiki("6", "Redirected Road", `A road that redirected travellers. ${"It wound on. ".repeat(30)}`, { type: "zone", facets: EMPTY_FACETS, damaged: true }),
    wiki("7", "Zul'Gurub Eagle", `An eagle of the troll city. ${"It soars. ".repeat(40)}`, { type: "npc", facets: facets({ zone: ["Zul'Gurub"] }), damaged: false }),
    wiki("8", "100% Done", `A quest about finishing. ${"Finish it. ".repeat(40)}`, { type: "quest", facets: EMPTY_FACETS, damaged: false }),
    ...Array.from({ length: 22 }, (_, i) => wiki(String(100 + i), `Zone ${i + 1}`, `Zone ${i + 1} is where grommash fought. ${"Battles raged here. ".repeat(20)}`, {
      type: "zone", facets: facets({ expansion: [(100 + i) % 2 ? "Legion" : "Battle for Azeroth"] }), damaged: false,
    })),
    ...(options.landing ? [
      wiki("481380", "Alliance", `* A quote set as a list.\n\nThe Alliance is one of two major factions. ${"It fights on. ".repeat(30)}`, { type: "other", facets: EMPTY_FACETS, damaged: false }),
      wiki("19317", "Orc", `The orcs are a race from Draenor. ${"They endure. ".repeat(30)}`, { type: "other", facets: EMPTY_FACETS, damaged: false }),
      wiki("200", "Durotar", `Durotar is a zone of red earth. ${"Dust blows. ".repeat(30)}`, { type: "zone", facets: EMPTY_FACETS, infobox: { template: "infobox zone", fields: { name: "Durotar" } }, damaged: false }),
      wiki("201", "Ashenvale", `Ashenvale is a forest zone. ${"Trees stand. ".repeat(30)}`, { type: "zone", facets: EMPTY_FACETS, infobox: { template: "infobox zone", fields: { name: "Ashenvale" } }, damaged: false }),
      wiki("202", "Razor Hill", `Razor Hill is a town. ${"Orcs live here. ".repeat(30)}`, { type: "zone", facets: EMPTY_FACETS, infobox: { template: "infobox town", fields: { name: "Razor Hill" } }, damaged: false }),
    ] : []),
  ];
  await replaceSourceRows(source, "warcraft-wiki-2023", ["lore_page"], rows);
  await replaceSourceRows(source, "curated", ["lore_page", "item"], [{
    kind: "lore_page", extId: "forever-launch-date", name: "WoW Forever launch date",
    body: "World of Warcraft Forever launches globally on November 4, 2026.", gameVersion: "forever",
    sourceUrl: "https://news.blizzard.com/example", retrievedAt: "2026-09-24",
  }, {
    kind: "item", extId: "grommash-axe", name: "Axe of grommash",
    body: "A curated item that mentions grommash and must not appear in lore search.", gameVersion: "forever",
    sourceUrl: "https://example.test/grommash-axe", retrievedAt: "2026-09-24",
  }]);
  const release = join(dir, "release", "release.sqlite");
  snapshot(source, release, new Date("2026-10-15T00:00:00Z"));
  source.close();
  if (!typed) {
    // The 2026-10-05 release has no type data and no type counts in its manifest.
    const manifestPath = `${release}.manifest.json`;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    delete manifest.types;
    delete manifest.damaged;
    delete manifest.facets;
    delete manifest.letters;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } else if (!withFacets) {
    // A typed release from before the facet summaries existed: the manifest has types but no facets.
    const manifestPath = `${release}.manifest.json`;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    delete manifest.facets;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return release;
}

function stripTypes(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return data;
  const rest = { ...data };
  for (const key of ["type", "facets", "infobox", "damaged"]) delete rest[key];
  return rest;
}
