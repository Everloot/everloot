import guideJson from "@/data/game-data/client-profession-guide.json";
import type { GuideRecipe, GuideWindow } from "@kb/profession-guide";
import { INDEPENDENT_INSTALLS } from "@kb/drop-rollup";
import { median } from "@kb/profession-path";
import type { RecipeObservation, TrainerRow } from "@kb/recipe-thresholds";
import type { ProfessionsView } from "./profession-store";
import { RECIPES_BUILD, type ProfessionInfo } from "./professions";
import { teachingItemIds } from "./recipe-catalog";
import { SPELLS_BUILD, spellNumbers } from "./spell-card";

type ClientRecipe = {
  points: number;
  starter?: true;
  cooldown?: true;
  quantity?: number;
  focus?: number;
  tools?: number[];
  toolCategories?: number[];
};
type TrainerSourceRow = [rank: number, build: number, asOf: string, neutralCopper: number | null, npcIds: number[]];
type VendorSourceRow = [unitCopper: number | null, build: number, asOf: string, npcIds: number[]];
type QuestSourceRow = [kind: "item" | "spell", id: number, build: number, asOf: string, level: number, items: [number, number][]];
const data = guideJson as unknown as {
  version: string;
  client: Record<number, ClientRecipe | undefined>;
  teachingRequirements: Record<number, [profession: number, rank: number] | undefined>;
  trainers: Record<number, TrainerSourceRow | undefined>;
  vendors: Record<number, VendorSourceRow | undefined>;
  quests: Record<string, QuestSourceRow>;
  rankStops: Record<number, ProfessionRankStop[] | undefined>;
};

export const PROFESSION_TRAINER_SOURCE_URL = guideJson.source;
export const PROFESSION_TRAINER_LICENSE_URL = guideJson.license;

export type ProfessionGuideSource =
  | { kind: "starter" }
  | { kind: "observed"; teachingItemIds: number[] }
  | { kind: "trainer"; npcIds: number[]; provider: "everloot" | "efficient-games" | "tradebook" | "published-guide"; build?: string; asOf?: string; referenceUrl?: string; questIds?: number[]; minimumLevel?: number }
  | { kind: "teaching-item"; teachingItemIds: number[]; npcIds: number[]; build?: string; asOf?: string }
  | { kind: "quest"; questIds: number[]; teachingItemIds: number[]; minimumLevel: number; build: string; asOf: string; referenceUrl?: string };

export interface ProfessionGuideRecipe extends GuideRecipe {
  source: ProfessionGuideSource;
  output: { itemId: number; minimum: number | null; maximum: number | null; vendorSellCopper?: number } | null;
  unlockReagents?: GuideRecipe["reagents"];
  repeatable?: boolean;
  focusId?: number;
  toolIds?: number[];
  toolCategoryIds?: number[];
}
export interface ProfessionGuideData {
  recipes: ProfessionGuideRecipe[];
  rankStops: ProfessionRankStop[];
  coverage: { knownSkills: number; modeledSkills: number; unverifiedRecipes: number };
  vendorBuyCopper: Record<number, number>;
  vendorNpcIds: Record<number, number[]>;
  vendorBuySources: Record<number, { provider: "everloot" | "efficient-games"; asOf?: string; build?: string }>;
}

export interface ProfessionRankStop {
  cap: number;
  spellId: number;
  nextSpellId: number;
  nextRank: "Journeyman" | "Expert" | "Artisan";
  nextCap?: number;
  source?:
    | { kind: "trainer"; npcIds: number[]; minimumSkill: number; minimumLevel?: number; build: string; asOf: string }
    | { kind: "book"; itemId: number; minimumSkill: number; minimumLevel?: number }
    | { kind: "quest"; questIds: number[]; minimumLevel: number; requirements: GuideRecipe["reagents"]; build: string; asOf: string };
}

export function professionRankStops(professionId: number): ProfessionRankStop[] {
  return data.rankStops[professionId] ?? [];
}

type Acquisition = {
  rank: number;
  source: ProfessionGuideSource;
  trainingCopper?: number | null;
  unlockReagents?: GuideRecipe["reagents"];
};

const key = (name: string) => name.trim().toLowerCase();
const buildName = (build: number) => `1.60.1.${build}`;
const ids = (a: number[]) => [...new Set(a)].sort((x, y) => x - y);
const validRank = (rank: number) => Number.isInteger(rank) && rank >= 1 && rank <= 299;

// Forever First Aid recipes, Warcraft Wiki contributors, CC BY-SA 4.0.
const triageReference = "https://warcraft.wiki.gg/wiki/Forever_first_aid_recipes";
const triageTraining: ProfessionGuideSource = {
  kind: "trainer", provider: "published-guide", npcIds: [12920, 12939], questIds: [6622, 6624],
  minimumLevel: 35, referenceUrl: triageReference,
};
// These few later recipes are absent from the pinned EG Link trainer windows. Their exact learn ranks
// are attested by current Forever guides or a direct community trainer observation, separately credited.
const supplementalTraining: Readonly<Record<number, Acquisition | undefined>> = {
  10841: { rank: 240, source: triageTraining, trainingCopper: null },
  18629: { rank: 260, source: triageTraining, trainingCopper: null },
  18630: { rank: 290, source: triageTraining, trainingCopper: null },
  13890: {
    rank: 225, trainingCopper: null,
    source: {
      kind: "trainer", provider: "tradebook", npcIds: [11074], asOf: "2026-11-22",
      referenceUrl: "https://github.com/TankerALane/Tradebook/blob/a9b4187dfbd6b6845a543932f5ec8eec758cda8e/docs/research/community_trainers.json",
    },
  },
  13937: {
    rank: 240, trainingCopper: null,
    source: {
      kind: "trainer", provider: "published-guide", npcIds: [],
      referenceUrl: "https://warcraft.wiki.gg/wiki/Forever_enchanting_formulas",
    },
  },
};
const questRewards = Object.entries(data.quests).map(([questId, row]) => [Number(questId), ...row] as const);

function questAcquisition(professionId: number, spellId: number, linked: number[]): Acquisition | undefined {
  for (const [questId, kind, id, build, asOf, minimumLevel, items] of questRewards) {
    const teachingItemIds = kind === "item" && linked.includes(id) ? [id] : [];
    const itemRequirement = kind === "item" && data.version === RECIPES_BUILD ? data.teachingRequirements[id] : undefined;
    const match = teachingItemIds.length > 0 && itemRequirement?.[0] === professionId;
    const moonclothBoots = questId === 6032 && kind === "spell" && id === spellId;
    if (!match && !moonclothBoots) continue;
    // We only route Sacred Cloth at its published Forever tailoring requirement.
    const rank = moonclothBoots ? 285 : itemRequirement?.[1];
    if (rank === undefined || !validRank(rank)) continue;
    return {
      rank, trainingCopper: 0,
      source: {
        kind: "quest", questIds: [questId], teachingItemIds, minimumLevel, build: buildName(build), asOf,
        ...(moonclothBoots ? { referenceUrl: "https://warcraft.wiki.gg/wiki/Forever_tailoring_patterns" } : {}),
      },
      unlockReagents: items.map(([itemId, count]) => ({ itemId, count })),
    };
  }
}

/** Stable IDs win. Older localized rows are only usable when the page names exactly one spell that way. */
function indexBySpell<T>(
  rows: readonly T[], names: ReadonlyMap<string, number[]>, allIds: ReadonlySet<number>,
  identify: (row: T) => { name: string; id?: number },
): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const row of rows) {
    const named = identify(row);
    const matches = names.get(key(named.name));
    const id = named.id ?? (matches?.length === 1 ? matches[0] : undefined);
    if (id === undefined || !allIds.has(id)) continue;
    const group = out.get(id) ?? [];
    group.push(row);
    out.set(id, group);
  }
  return out;
}

function reportedTrainer(rows: readonly TrainerRow[]): Acquisition | null {
  const ranks = new Map<number, Map<string, TrainerRow>>();
  const reported = new Map<string, Set<number>>();
  for (const row of rows) {
    if (!validRank(row.requiredRank)) continue;
    const install = row.installId.trim();
    if (!install) continue;
    const history = reported.get(install) ?? new Set<number>();
    history.add(row.requiredRank);
    reported.set(install, history);
    const at = ranks.get(row.requiredRank) ?? new Map<string, TrainerRow>();
    at.set(install, row);
    ranks.set(row.requiredRank, at);
  }
  const agreed = [...ranks].map(([rank, group]) => [rank, [...group].filter(([install]) => reported.get(install)?.size === 1).map(([, row]) => row)] as const)
    .filter(([, group]) => group.length >= INDEPENDENT_INSTALLS);
  if (agreed.length !== 1) return null;
  const [rank, group] = agreed[0]!;
  const costs = group.flatMap(row => row.costCopper === undefined ? [] : [row.costCopper]);
  const onNpc = new Map<number, Set<string>>();
  for (const row of rows) {
    if (row.trainerNpcId === undefined || row.requiredRank !== rank || reported.get(row.installId.trim())?.size !== 1) continue;
    const reports = onNpc.get(row.trainerNpcId) ?? new Set<string>();
    reports.add(row.installId.trim());
    onNpc.set(row.trainerNpcId, reports);
  }
  return {
    rank,
    source: { kind: "trainer", provider: "everloot", npcIds: ids([...onNpc].filter(([, reports]) => reports.size >= INDEPENDENT_INSTALLS).map(([id]) => id)) },
    trainingCopper: costs.length >= INDEPENDENT_INSTALLS ? median(costs) : null,
  };
}

function recipeAcquisition(
  professionId: number, spellId: number, starter: boolean, rows: readonly TrainerRow[],
  observedRank: number, linked: number[], observedVendorPrices: ReadonlyMap<number, number> | undefined,
): Acquisition | null {
  if (starter) return { rank: 1, source: { kind: "starter" }, trainingCopper: 0 };
  const localTrainer = reportedTrainer(rows);
  if (localTrainer) return localTrainer;
  const externalTrainer = data.trainers[spellId];
  if (externalTrainer) {
    const [rank, build, asOf, price, npcIds] = externalTrainer;
    return { rank, source: { kind: "trainer", provider: "efficient-games", npcIds, build: buildName(build), asOf }, trainingCopper: price };
  }
  const supplemental = supplementalTraining[spellId];
  if (supplemental) return supplemental;
  const quest = questAcquisition(professionId, spellId, linked);
  if (quest) return quest;
  const pattern = linked.flatMap(itemId => {
    const requirement = data.version === RECIPES_BUILD ? data.teachingRequirements[itemId] : undefined;
    const sale = data.vendors[itemId];
    if (requirement?.[0] !== professionId || !validRank(requirement[1]) || (!sale && !observedVendorPrices?.has(itemId))) return [];
    const [price, build, asOf, npcIds] = sale ?? [null, null, null, []];
    const observedPrice = observedVendorPrices?.get(itemId);
    const found: Acquisition = {
      rank: requirement[1],
      source: {
        kind: "teaching-item", teachingItemIds: [itemId], npcIds,
        ...(build && asOf ? { build: buildName(build), asOf } : {}),
      },
      trainingCopper: observedPrice !== undefined && observedPrice > 0 ? observedPrice : price,
    };
    return [found];
  }).sort((a, b) => a.rank - b.rank)[0];
  if (pattern) return pattern;
  if (validRank(observedRank)) return { rank: observedRank, source: { kind: "observed", teachingItemIds: linked } };
  return null;
}

/** Reports justify use of a recipe without revealing one installation. Conflicting color spans are discarded. */
function reportedColors(rows: readonly RecipeObservation[]): { from: number; yellow: number; grey: number } | null {
  const reports = rows.filter(r => r.installId.trim() && Number.isInteger(r.rank) && r.rank >= 1);
  if (new Set(reports.map(r => r.installId.trim())).size < INDEPENDENT_INSTALLS) return null;
  const orange = reports.filter(r => r.difficulty === "optimal").map(r => r.rank);
  const nonOrange = reports.filter(r => r.difficulty !== "optimal").map(r => r.rank);
  const from = Math.min(...orange);
  const yellow = Math.min(...nonOrange);
  const grey = Math.min(...reports.filter(r => r.difficulty === "trivial").map(r => r.rank));
  if (orange.length && Math.max(...orange) >= yellow) return null;
  return { from, yellow, grey };
}

/** File windows and accredited observations establish availability. The post-yellow linear model is opt-in in the UI. */
export function buildProfessionGuideData(
  profession: ProfessionInfo, facts: ProfessionsView["facts"], spellName: (id: number) => string | undefined,
  vendorSellCopper?: (itemId: number) => number | undefined,
): ProfessionGuideData {
  const recipes: ProfessionGuideRecipe[] = [];
  const nameKeys = new Map<string, number[]>();
  const spellIds = new Set(profession.recipes.map(r => r.spellId));
  for (const { spellId } of profession.recipes) {
    const name = spellName(spellId);
    if (name) {
      const named = key(name);
      nameKeys.set(named, [...(nameKeys.get(named) ?? []), spellId]);
    }
  }
  const observations = indexBySpell(facts.observations.filter(row => row.recipeId !== undefined || key(row.profession) === key(profession.name)),
    nameKeys, spellIds, row => ({ id: row.recipeId, name: row.recipe }));
  const trainers = indexBySpell(facts.trainers.filter(row => row.skillLineId === profession.id || key(row.profession) === key(profession.name)),
    nameKeys, spellIds, row => ({ id: row.spellId, name: row.recipe }));
  const observedVendorPrices = facts.vendorPricesByItem;
  const vendorBuyCopper: ProfessionGuideData["vendorBuyCopper"] = {};
  const vendorNpcIds: ProfessionGuideData["vendorNpcIds"] = {};
  const vendorBuySources: ProfessionGuideData["vendorBuySources"] = {};
  const known = new Set<number>();
  const modeled = new Set<number>();
  let eligibleRecipes = 0;
  for (const row of profession.recipes) {
    if (!row.reagents.length || row.yellow === null || row.grey === null) continue;
    const client = data.version === RECIPES_BUILD ? data.client[row.spellId] : undefined;
    if (client?.cooldown || (SPELLS_BUILD === RECIPES_BUILD && spellNumbers(row.spellId)?.cooldownMs) || client?.points === 0) continue;
    eligibleRecipes++;
    const reports = observations.get(row.spellId) ?? [];
    const colors = reportedColors(reports);
    const linked = teachingItemIds([row.spellId]);
    const acquisition = recipeAcquisition(profession.id, row.spellId, client?.starter === true, trainers.get(row.spellId) ?? [],
      colors?.from ?? Infinity, linked, observedVendorPrices);
    if (!acquisition) continue;
    const yellow = Math.min(row.yellow, colors?.yellow ?? Infinity);
    const grey = Math.min(row.grey, colors?.grey ?? Infinity);
    if (yellow > grey) continue;
    const windows: GuideWindow[] = [];
    const points = client?.points ?? 1;
    if (acquisition.rank < yellow) {
      const toSkill = Math.min(yellow, 300);
      windows.push({ fromSkill: acquisition.rank, toSkill, points, chance: 1, evidence: acquisition.source.kind === "observed" ? "observed" : "verified" });
      for (let skill = acquisition.rank; skill < toSkill; skill++) known.add(skill);
    }
    const fromEstimate = Math.max(acquisition.rank, yellow);
    const toEstimate = Math.min(grey, 300);
    if (fromEstimate < toEstimate) {
      const chance = (grey - fromEstimate) / (grey - yellow);
      const chanceAtEnd = (grey - toEstimate) / (grey - yellow);
      windows.push({ fromSkill: fromEstimate, toSkill: toEstimate, points, chance, chanceAtEnd, evidence: "modeled" });
      for (let skill = fromEstimate; skill < toEstimate; skill++) modeled.add(skill);
    }
    if (!windows.length) continue;
    for (const { itemId } of [...row.reagents, ...(acquisition.unlockReagents ?? [])]) {
      const observed = observedVendorPrices?.get(itemId);
      const vendor = data.vendors[itemId];
      if (vendor) vendorNpcIds[itemId] = vendor[3];
      if (observed !== undefined && observed > 0) {
        vendorBuyCopper[itemId] = observed;
        vendorBuySources[itemId] = { provider: "everloot" };
      } else if (vendor && vendor[0] !== null) {
        vendorBuyCopper[itemId] = vendor[0];
        vendorBuySources[itemId] = { provider: "efficient-games", build: buildName(vendor[1]), asOf: vendor[2] };
      }
    }
    const displayName = spellName(row.spellId) ?? reports.find(r => r.recipe.trim())?.recipe.trim() ?? `Recipe ${row.spellId}`;
    const sell = row.itemId === null ? undefined : vendorSellCopper?.(row.itemId);
    recipes.push({
      id: row.spellId, name: displayName, reagents: row.reagents, windows, prices: { materials: null },
      source: acquisition.source, trainingCopper: acquisition.trainingCopper,
      ...(acquisition.unlockReagents ? { unlockReagents: acquisition.unlockReagents } : {}),
      output: row.itemId !== null ? {
        itemId: row.itemId, minimum: client?.quantity ?? null, maximum: client?.quantity ?? null, ...(sell === undefined ? {} : { vendorSellCopper: sell }),
      } : null,
      ...(client?.focus ? { focusId: client.focus } : {}),
      ...(client?.tools?.length ? { toolIds: client.tools } : {}),
      ...(client?.toolCategories?.length ? { toolCategoryIds: client.toolCategories } : {}),
      repeatable: Boolean(client?.quantity && !client.focus && !client.tools?.length && !client.toolCategories?.length),
    });
  }
  return {
    recipes,
    rankStops: professionRankStops(profession.id),
    coverage: { knownSkills: known.size, modeledSkills: new Set([...known, ...modeled]).size, unverifiedRecipes: eligibleRecipes - recipes.length },
    vendorBuyCopper, vendorNpcIds, vendorBuySources,
  };
}
