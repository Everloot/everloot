/** Only recorded levels belong here. Null means a data family is unavailable, [] means no matches. */
export interface LevelClass { slug: string; name: string; pointLevels: readonly number[] }
export interface LevelSpell { id: number; name: string; rank?: string; classSlug: string; level: number; href: string }
export interface LevelPlace { name: string; href: string; min: number | null; max: number | null }
export interface LevelTrainer { name: string; href: string; level: number; classSlug?: string }
export interface LevelData {
  classes: readonly LevelClass[];
  spells: readonly LevelSpell[] | null;
  zones: readonly LevelPlace[] | null;
  instances: readonly (LevelPlace & { raid: boolean | null })[];
  trainers: readonly LevelTrainer[] | null;
}
export const LEVELS = Array.from({ length: 60 }, (_, i) => i + 1);
export function parseLevel(value: string): number | null {
  return /^(?:[1-9]|[1-5][0-9]|60)$/.test(value) ? Number(value) : null;
}
export function levelHref(level: number, classSlug = ""): string {
  return `/tools/level/${level}${classSlug ? `?class=${encodeURIComponent(classSlug)}` : ""}`;
}
export function buildLevelUnlocks(data: LevelData, level: number, classSlug?: string) {
  if (!Number.isInteger(level) || level < 1 || level > 60) throw new RangeError("Level must be 1–60");
  const matchesClass = (slug?: string) => !classSlug || !slug || slug === classSlug;
  const covers = (p: LevelPlace) => p.min !== null && p.max !== null && p.min <= level && level <= p.max;
  const spells = data.spells?.filter((s) => s.level === level && matchesClass(s.classSlug)) ?? null;
  const zones = data.zones?.filter(covers) ?? null;
  const dungeons = data.instances.filter((p) => p.raid === false && covers(p));
  const raids = level === 60 ? data.instances.filter((p) => p.raid === true && covers(p)) : [];
  const trainers = data.trainers?.filter((t) => t.level === level && matchesClass(t.classSlug)) ?? null;
  const talents = data.classes.filter((c) => matchesClass(c.slug)).flatMap((c) => {
    const gained = c.pointLevels.filter((n) => n === level).length;
    return gained ? [{ slug: c.slug, name: c.name, gained, total: c.pointLevels.filter((n) => n <= level).length }] : [];
  });
  return { spells, zones, dungeons, raids, trainers, talents,
    hasData: Boolean(spells?.length || zones?.length || dungeons.length || raids.length || trainers?.length || talents.length) };
}
export type LevelUnlocks = ReturnType<typeof buildLevelUnlocks>;
