import type { SavedBuild } from "@/lib/saved-builds";
import { isTalentClass, loadCatalog } from "@/lib/talents/catalogs";
import { codeFreshness, compareGameBuilds, savedPlanNote, type ClassTalentChanges } from "@/lib/talents/freshness";
import { importCode } from "@/lib/talents/import";
import { buildTitle, summarizeBuild } from "@/lib/talents/summary";

/** What a list says about a build beyond its name: how players say it ("Fire Mage 17/34/0"), and whether
 *  it was made on an older or a newer game build than the calculator's tree. Neither when a build cannot be read.
 *  `note`: what the change records say changed in its talents since an older build (savedPlanNote), else null. */
export interface BuildFacts { title: string; older: boolean; newer: boolean; note: string | null }

export const className = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

/** One catalog per class, loaded once; a code that no longer loads keeps the class name as its title. `changesFor`
 *  reads a class's change records (publishedClassChanges), handed in by the server code so that this file, whose
 *  `className` browser code uses, never brings the records along. */
export async function describeBuilds(builds: SavedBuild[], changesFor: (classId: number) => ClassTalentChanges): Promise<Map<string, BuildFacts>> {
  const classes = [...new Set(builds.map((b) => b.classSlug))].filter(isTalentClass);
  const catalogs = new Map(await Promise.all(classes.map(async (slug) => [slug, await loadCatalog(slug)] as const)));
  const changes = new Map([...catalogs.values()].map((catalog) => [catalog.classId, changesFor(catalog.classId)] as const));
  const facts = new Map<string, BuildFacts>();
  for (const build of builds) {
    const catalog = isTalentClass(build.classSlug) ? catalogs.get(build.classSlug) : undefined;
    if (!catalog) { facts.set(build.id, { title: className(build.classSlug), older: false, newer: false, note: null }); continue; }
    const loaded = importCode(catalog, build.code);
    const order = compareGameBuilds(build.gameBuild, catalog.build);
    facts.set(build.id, {
      title: loaded.ok ? buildTitle(catalog, summarizeBuild(catalog, loaded.ranks)) : catalog.className,
      older: order === -1,
      newer: order === 1,
      note: savedPlanNote([build.code, build.code2].map((code) => (code ? codeFreshness(catalog, changes.get(catalog.classId)!, code) : null))),
    });
  }
  return facts;
}
