import { CLIENT_RECIPES } from "@/data/game-data/client-recipes";
import { slugify } from "../../../kb/src/item-taxonomy";

/**
 * The professions and their recipes as the game files list them (data/game-data/client-recipes.json), shaped for
 * the profession pages. Found in game files, unconfirmed: nothing here says a recipe is in the game, or how a
 * player learns it. What players saw is a separate layer the pages put beside it.
 */

export interface RecipeView {
  spellId: number;
  /** The item the recipe makes; null for one that makes none (an enchant). */
  itemId: number | null;
  /** The files' MinSkillLineRank, only where it is above 1: the files give one for few recipes. */
  learn: number | null;
  /** Where the recipe turns yellow and grey by the files; null where they give none. */
  yellow: number | null;
  grey: number | null;
  reagents: { itemId: number; count: number }[];
}

export interface ProfessionInfo {
  id: number;
  name: string;
  slug: string;
  recipes: RecipeView[];
  /** Spells on the line that make and cost nothing (rank spells, rows this build lacks), counted, not listed. */
  otherSpells: number;
}

/** In the order the site lists professions elsewhere (the profession icon list), then any other the files add. */
const ORDER = ["Alchemy", "Blacksmithing", "Enchanting", "Engineering", "Herbalism", "Leatherworking", "Mining", "Skinning", "Tailoring", "Cooking", "First Aid", "Fishing"];
const rank = (name: string) => { const i = ORDER.indexOf(name); return i < 0 ? ORDER.length : i; };
const orNull = (n: number) => (n > 0 ? n : null);

export const CLIENT_PROFESSIONS: ProfessionInfo[] = CLIENT_RECIPES.professions
  .map((p) => ({
    id: p.id, name: p.name, slug: slugify(p.name), otherSpells: p.otherSpells,
    recipes: p.recipes.map(([spellId, item, learn, yellow, grey, reagents]) => ({
      spellId, itemId: orNull(item), learn: learn > 1 ? learn : null, yellow: orNull(yellow), grey: orNull(grey),
      reagents: reagents.map(([itemId, count]) => ({ itemId, count })),
    })),
  }))
  .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));

export const RECIPES_BUILD = CLIENT_RECIPES.build.version;
export const RECIPES_EXTRACTED_AT = new Date(CLIENT_RECIPES.build.extractedAt);

export function professionBySlug(slug: string): ProfessionInfo | undefined {
  return CLIENT_PROFESSIONS.find((p) => p.slug === slug);
}

/** A profession by its name in any case ("first aid"), for the old `?profession=` links. */
export function professionByName(name: string): ProfessionInfo | undefined {
  const wanted = name.trim().toLowerCase();
  return CLIENT_PROFESSIONS.find((p) => p.name.toLowerCase() === wanted);
}

/** A profession's page; a skill line the files do not list as a profession has none. */
export const professionHref = (slug: string) => `/tools/professions/${slug}`;
export const professionHrefById = (skillId: number) => {
  const p = CLIENT_PROFESSIONS.find((x) => x.id === skillId);
  return p ? professionHref(p.slug) : null;
};

/**
 * The skill brackets the page groups recipes in, by the rank where a recipe turns yellow. Plain number ranges of
 * our own choosing, 75 ranks wide, not the game's training tiers.
 */
export const SKILL_BRACKETS = [[1, 75], [76, 150], [151, 225], [226, 300], [301, 999]].map(([min, max]) => ({ min, max }));

export interface RecipeGroup { key: string; label: string; recipes: RecipeView[] }

/** "Skill 76–150", "Skill 301+". */
const bracketLabel = (b: { min: number; max: number }) => (b.max >= 999 ? `Skill ${b.min}+` : `Skill ${b.min}–${b.max}`);

/**
 * A profession's recipes in skill brackets, lowest first; in each, by yellow then grey rank, then spell id. The
 * recipes the files give no ranks for come last, in their own group. Empty brackets are left out.
 */
export function recipeGroups(recipes: readonly RecipeView[]): RecipeGroup[] {
  const sorted = [...recipes].sort((a, b) => (a.yellow ?? 9999) - (b.yellow ?? 9999) || (a.grey ?? 9999) - (b.grey ?? 9999) || a.spellId - b.spellId);
  const groups: RecipeGroup[] = SKILL_BRACKETS.map((b) => ({
    key: `${b.min}`, label: bracketLabel(b),
    recipes: sorted.filter((r) => r.yellow !== null && r.yellow >= b.min && r.yellow <= b.max),
  }));
  groups.push({ key: "unranked", label: "No skill ranks in the files", recipes: sorted.filter((r) => r.yellow === null) });
  return groups.filter((g) => g.recipes.length > 0);
}

/** Every item a list of recipes names, made or used, once each: the ids a page asks names and icons for. */
export function recipeItemIds(recipes: readonly RecipeView[]): number[] {
  const ids = new Set<number>();
  for (const r of recipes) {
    if (r.itemId) ids.add(r.itemId);
    for (const x of r.reagents) ids.add(x.itemId);
  }
  return [...ids];
}
