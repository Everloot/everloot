/**
 * What a class hub shows, from readers the site already has: the class's published guides, through guidesFor so a
 * draft never shows, and the races Blizzard's race and class article lets play it. None of it is advice, and no
 * role is worked out from a talent tree: a guide's roles are the ones it was reviewed for. The class pages call this
 * while the site builds, so kb/guides is read then and never on a request.
 */
import { NEW_COMBOS, RACES, type ClassName } from "@/data/wow-forever";
import { classLabel, type ClassSlug } from "./class-context";
import { guidesFor, loadGuides, type Guide } from "./guides";
import { TALENT_CLASSES } from "./talents/catalogs";

/** The class's published guides, the lowest levels first. */
export const classGuides = (slug: ClassSlug, guides: Map<string, Guide> = loadGuides()): Guide[] => guidesFor(guides, { classSlug: slug });

/** A hub is indexed once it lists a reviewed guide; an empty one stays out of search, like an empty wiki hub. */
export const hubIndexable = (slug: ClassSlug, guides: Map<string, Guide> = loadGuides()): boolean => classGuides(slug, guides).length > 0;

/** The class index is indexed once one of its hubs is. */
export const classesIndexable = (guides: Map<string, Guide> = loadGuides()): boolean => TALENT_CLASSES.some((slug) => hubIndexable(slug, guides));

export interface FactionRaces { faction: string; races: { race: string; isNew: boolean }[] }

/** Who can be the class, per faction in the article's order; `isNew` marks the combinations it names as new. */
export function classRaces(slug: ClassSlug): FactionRaces[] {
  const name = classLabel(slug) as ClassName;
  return Object.entries(RACES.factions)
    .map(([faction, rows]) => ({
      faction,
      races: Object.entries(rows)
        .filter(([, classes]) => (classes as readonly ClassName[]).includes(name))
        .map(([race]) => ({ race, isNew: NEW_COMBOS.some(([r, c]) => r === race && c === name) })),
    }))
    .filter((f) => f.races.length > 0);
}
