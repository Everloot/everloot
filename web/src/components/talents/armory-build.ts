import druid from "@/data/game-data/talents/druid.json";
import hunter from "@/data/game-data/talents/hunter.json";
import mage from "@/data/game-data/talents/mage.json";
import paladin from "@/data/game-data/talents/paladin.json";
import priest from "@/data/game-data/talents/priest.json";
import rogue from "@/data/game-data/talents/rogue.json";
import shaman from "@/data/game-data/talents/shaman.json";
import warlock from "@/data/game-data/talents/warlock.json";
import warrior from "@/data/game-data/talents/warrior.json";
import { normalizeCatalog } from "@/lib/talents/adapter";
import { isLegal, pointsAtLevel, pointsSpent } from "@/lib/talents/rules";
import { encodeBuild } from "@/lib/talents/share";
import type { Ranks, TalentCatalog } from "@/lib/talents/types";

// A character's talents as the armory stores them (Blizzard's tree and talent names, with ranks), put on the
// calculator's nodes. A tree matches by its name, a talent by its name inside that tree. Anything that does not match,
// or does not fit the tree's rules, gives a reason instead, and the armory page keeps Blizzard's list.

const RAW: Record<string, unknown> = { druid, hunter, mage, paladin, priest, rogue, shaman, warlock, warrior };
const cache = new Map<string, TalentCatalog>();

/** The calculator's catalog for a class slug, read at once (the armory sheet renders on the server); null for none. */
export function armoryCatalog(slug: string): TalentCatalog | null {
  if (!Object.hasOwn(RAW, slug)) return null;
  let catalog = cache.get(slug);
  if (!catalog) cache.set(slug, (catalog = normalizeCatalog(RAW[slug])));
  return catalog;
}

export interface ArmoryTree { name: string; points: number; talents: { name: string; rank: number }[] }

export type ArmoryBuild =
  | { ok: true; ranks: Ranks; href: string }
  | { ok: false; reason: string };

export function armoryBuild(catalog: TalentCatalog, trees: readonly ArmoryTree[]): ArmoryBuild {
  const ranks: Ranks = {};
  for (const tree of trees) {
    const t = catalog.trees.find((x) => x.name === tree.name);
    if (!t) return { ok: false, reason: `The calculator has no ${tree.name} tree for this class.` };
    let sum = 0;
    for (const talent of tree.talents) {
      const nodes = catalog.nodes.filter((n) => n.treeId === t.id && n.entries.some((e) => e.name === talent.name));
      if (nodes.length !== 1) return { ok: false, reason: `${tree.name}: ${talent.name} is not in the calculator's tree.` };
      const node = nodes[0];
      if (talent.rank > node.maxRanks) return { ok: false, reason: `${tree.name}: ${talent.name} rank ${talent.rank} is above its most, ${node.maxRanks}.` };
      if (talent.rank > 0) ranks[node.id] = { rank: talent.rank };
      sum += talent.rank;
    }
    if (sum !== tree.points) return { ok: false, reason: `${tree.name}: the armory says ${tree.points} points, its talents add up to ${sum}.` };
  }
  if (!isLegal(catalog, ranks) || pointsSpent(ranks) > pointsAtLevel(catalog, catalog.rules.maxLevel)) {
    return { ok: false, reason: "These talents do not fit the calculator's tree rules." };
  }
  const code = encodeBuild({ classSlug: catalog.classSlug, specId: catalog.specId, build: catalog.build, ranks });
  return { ok: true, ranks, href: `/tools/talents/${catalog.classSlug}/b/${code}` };
}
