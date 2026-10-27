/**
 * What a class hub shows, from readers the site already has: the class's published guides, through guidesFor so a
 * draft never shows, and the races Blizzard's race and class article lets play it. None of it is advice, and no
 * role is worked out from a talent tree: a guide's roles are the ones it was reviewed for. The class pages call this
 * while the site builds, so kb/guides is read then and never on a request.
 */
import { NEW_COMBOS, RACES, type ClassName } from "@/data/wow-forever";
import { classLabel, type ClassSlug } from "./class-context";
import { guidesFor, loadGuides, type Guide } from "./guides";
import { RACE_TABLE } from "./race-traits";
import type { RaceTable } from "../../../kb/src/client-races";
import { TALENT_CLASSES } from "./talents/catalogs";

/** The class's published guides, the lowest levels first. */
export const classGuides = (slug: ClassSlug, guides: Map<string, Guide> = loadGuides()): Guide[] => guidesFor(guides, { classSlug: slug });

/** Whether the game files give racial traits for a race that can be the class: content of its own on the hub. */
const hasRaceTraits = (slug: ClassSlug, table: RaceTable): boolean =>
  table.races.some((r) => r.traits.length > 0 && r.classes.some((c) => c.name === classLabel(slug)));

/**
 * A hub is indexed once it lists a reviewed guide or its races' traits from the game files; one with neither stays
 * out of search, like an empty wiki hub.
 */
export const hubIndexable = (slug: ClassSlug, guides: Map<string, Guide> = loadGuides(), table: RaceTable = RACE_TABLE): boolean =>
  classGuides(slug, guides).length > 0 || hasRaceTraits(slug, table);

/** The class index is indexed once one of its hubs is. */
export const classesIndexable = (guides: Map<string, Guide> = loadGuides(), table: RaceTable = RACE_TABLE): boolean =>
  TALENT_CLASSES.some((slug) => hubIndexable(slug, guides, table));

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
