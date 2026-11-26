/**
 * What a class hub shows, from readers the site already has: the class's published guides, through guidesFor so a
 * draft never shows, and the races Blizzard's race and class article lets play it. None of it is advice, and no
 * role is worked out from a talent tree: a guide's roles are the ones it was reviewed for. The class pages call this
 * while the site builds, so kb/guides is read then and never on a request.
 */
import { CLIENT_CLASS_GEAR } from "@/data/game-data/client-class-gear";
import { CLIENT_CLASS_SPELLS } from "@/data/game-data/client-class-spells";
import { CLIENT_SPELLS } from "@/data/game-data/client-spells";
import { NEW_COMBOS, RACES, type ClassName } from "@/data/wow-forever";
import { classLabel, ROLES, withClassContext, type ClassSlug } from "./class-context";
import { guidesFor, loadGuides, type Guide } from "./guides";
import { CLIENT_TAXONOMY, itemsHref } from "./items";
import { RACE_TABLE } from "./race-traits";
import type { ClientClassGear } from "@kb/client-class-gear";
import type { ClientClassSpells } from "@kb/client-class-spells";
import type { ClientSpells } from "@kb/client-spells";
import type { RaceTable } from "@kb/client-races";
import type { GuideRole } from "@kb/guides/guide";
import type { Taxonomy } from "@kb/item-taxonomy";
import { TALENT_CLASSES } from "./talents/catalogs";

/** Item classes in the game files: weapons and armor. */
const WEAPON = 2, ARMOR = 4;

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

/** The roles the class's reviewed guides were written for, once each, in the guides' role order. Never a tree's. */
export const guideRoles = (guides: readonly Guide[]): GuideRole[] => ROLES.filter((r) => guides.some((g) => g.roles.includes(r)));

/** One armor or weapon type a class's proficiencies name. Without a name in the taxonomy it keeps its number. */
export type GearType =
  | { name: string; level: number; href: string }
  | { name: null; level: number; href: null; subclass: number };

/**
 * What a class can wear and wield by the game files (kb/src/client-class-gear.ts): each armor (item class 4) and weapon
 * (item class 2) type its proficiencies name, with the level the files give it, in the taxonomy's order. Each links the
 * item list for that type, narrowed to the class. Found in game files, unconfirmed.
 */
export function classGear(slug: ClassSlug, gear: ClientClassGear = CLIENT_CLASS_GEAR, taxonomy: Taxonomy = CLIENT_TAXONOMY): { armor: GearType[]; weapons: GearType[] } {
  const mine = gear.classes[slug]?.gear ?? [];
  const of = (itemClass: number): GearType[] => {
    const cls = taxonomy.classes.find((c) => c.id === itemClass);
    return mine
      .filter(([ic]) => ic === itemClass)
      .map(([, subclass, level]) => ({ subclass, level, sub: taxonomy.subclasses.find((s) => s.classId === itemClass && s.id === subclass) }))
      .sort((a, b) => a.subclass - b.subclass)
      .map(({ subclass, level, sub }): GearType => sub?.name && cls
        ? { name: sub.name, level, href: withClassContext(itemsHref(cls.slug, sub.slug), { classSlug: slug }) }
        : { name: null, level, href: null, subclass });
  };
  return { armor: of(ARMOR), weapons: of(WEAPON) };
}

/**
 * A class's spells by the level the files give each (SpellLevels, in client-spells.json), lowest level first. The
 * spells on its class skill lines are ranks, talents, passives and helper spells mixed, as the files have them; one
 * with no level is counted, never placed at a level.
 */
export function classSpellLevels(slug: ClassSlug, classSpells: ClientClassSpells = CLIENT_CLASS_SPELLS, spells: ClientSpells = CLIENT_SPELLS): { levels: { level: number; spells: number[] }[]; unleveled: number } {
  const byLevel = new Map<number, number[]>();
  let unleveled = 0;
  for (const id of classSpells.classes[slug]?.spells ?? []) {
    const level = spells.spells[String(id)]?.level;
    if (!level) { unleveled++; continue; }
    byLevel.set(level, [...(byLevel.get(level) ?? []), id]);
  }
  return { levels: [...byLevel].sort((a, b) => a[0] - b[0]).map(([level, ids]) => ({ level, spells: ids })), unleveled };
}

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
