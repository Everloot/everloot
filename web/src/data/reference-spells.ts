import data from "./reference-spells.json";

export type AbilityRole = "interrupt" | "defensive" | "crowd-control" | "cooldowns";
export interface ReferenceSpell { id: number; name: string; definitionId: number; evidence: string }
export const CLASS_LAYOUTS: Record<string, Partial<Record<AbilityRole, ReferenceSpell>>> = data.layouts;
export const REFERENCE_CLASSES = Object.keys(CLASS_LAYOUTS);
export const SPELL_SOURCE = data.source;
export const SPELL_BUILD = data.build.version;
export const SPELL_NOTE = data.label;
// A single cast is deliberately the starting point. No unverified macro conditions, spell chains or automation.
export const STARTER_MACROS = REFERENCE_CLASSES.map((classSlug) => {
  const spell = CLASS_LAYOUTS[classSlug].cooldowns!;
  return { classSlug, spell, text: `/cast ${spell.name}` };
});
