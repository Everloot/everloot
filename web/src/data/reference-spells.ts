import data from "./game-data/reference-spells.json";

export type AbilityRole = "interrupt" | "defensive" | "crowd-control" | "cooldowns";
export interface ReferenceSpell { id: number; name?: string; evidence?: string }
export const CLASS_LAYOUTS: Record<string, Partial<Record<AbilityRole, ReferenceSpell>>> = data.layouts;
export const REFERENCE_CLASSES = Object.keys(CLASS_LAYOUTS);

export const SPELL_BUILD = data.build.version;
export const SPELL_NOTE = data.label;
export type ReferenceLayouts = typeof CLASS_LAYOUTS;

// Names arrive only from the server reader; missing names never produce a macro.
export function starterMacros(layouts: ReferenceLayouts) {
  return Object.entries(layouts).flatMap(([classSlug, layout]) => {
    const spell = layout.cooldowns;
    return spell?.name ? [{ classSlug, spell, text: `/cast ${spell.name}` }] : [];
  });
}
