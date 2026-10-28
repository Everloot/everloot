import { normalizeCatalog } from "./adapter";
import type { TalentCatalog } from "./types";

// One catalog per class, loaded on demand so a class page ships only its own tree.
const loaders = {
  warrior: () => import("@/data/game-data/talents/warrior.json"),
  paladin: () => import("@/data/game-data/talents/paladin.json"),
  hunter: () => import("@/data/game-data/talents/hunter.json"),
  rogue: () => import("@/data/game-data/talents/rogue.json"),
  priest: () => import("@/data/game-data/talents/priest.json"),
  shaman: () => import("@/data/game-data/talents/shaman.json"),
  mage: () => import("@/data/game-data/talents/mage.json"),
  warlock: () => import("@/data/game-data/talents/warlock.json"),
  druid: () => import("@/data/game-data/talents/druid.json"),
} as const;

export type TalentClassSlug = keyof typeof loaders;

export const TALENT_CLASSES = Object.keys(loaders) as TalentClassSlug[];

export const isTalentClass = (slug: string): slug is TalentClassSlug => Object.hasOwn(loaders, slug);

export async function loadCatalog(slug: TalentClassSlug): Promise<TalentCatalog> {
  const data = await loaders[slug]();
  return normalizeCatalog(data.default);
}
