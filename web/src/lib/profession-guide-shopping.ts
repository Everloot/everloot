import type { GuideReagent, GuideStep } from "@kb/profession-guide";

type ShoppingStep = Pick<GuideStep, "recipeId" | "fromSkill" | "plannedCrafts" | "reagents"> & { toSkill?: number };
type UnitBuyCopper = (itemId: number) => number | null;

export type GuideShoppingRecipe = {
  id: number;
  name: string;
  reagents: readonly GuideReagent[];
  output: { itemId: number; minimum: number | null } | null;
  /** Materials consumed once to acquire a quest recipe. */
  unlockReagents?: readonly GuideReagent[];
  /** True only when evidence supports repeating this craft without a cooldown or special requirement. */
  repeatable?: boolean;
};

export type GuideExtraCraft = {
  recipeId: number;
  recipeName: string;
  itemId: number;
  crafts: number;
  outputCount: number;
  beforeSkill: number;
};

export type GuidePurchase = GuideReagent & { unitCopper: number | null; copper: number | null };
export type GuideShoppingPlan = {
  purchases: GuidePurchase[];
  crafts: GuideExtraCraft[];
  leftovers: GuideReagent[];
  copper: number | null;
  knownCopper: number;
};

type Producer = GuideShoppingRecipe & { output: { itemId: number; minimum: number } };
type State = {
  stock: Map<number, number>;
  purchases: GuideReagent[];
  crafts: GuideExtraCraft[];
  knownCopper: number;
  missingQuote: boolean;
};

function hasGuaranteedOutput(recipe: GuideShoppingRecipe | undefined): recipe is Producer {
  const output = recipe?.output;
  return output != null && Number.isSafeInteger(output.itemId) && output.itemId > 0
    && output.minimum !== null && Number.isSafeInteger(output.minimum) && output.minimum > 0;
}

function counted(rows: Iterable<GuideReagent>): GuideReagent[] {
  const quantities = new Map<number, number>();
  for (const { itemId, count } of rows) quantities.set(itemId, (quantities.get(itemId) ?? 0) + count);
  return Array.from(quantities, ([itemId, count]) => ({ itemId, count })).sort((a, b) => a.itemId - b.itemId);
}

/**
 * Walk ordered route steps. Extra crafts compare whole-batch marginal purchase costs at that step.
 * Produced items can only satisfy later needs. A plan neither assumes inventory nor credits sales.
 */
export function planGuideShopping(
  steps: readonly ShoppingStep[],
  recipes: readonly GuideShoppingRecipe[],
  unitBuyCopper: UnitBuyCopper,
  options: {
    makeIfCheaper?: boolean;
    knownFromSkill?: ReadonlyMap<number, number>;
    rankRequirements?: readonly { beforeSkill: number; reagents: readonly GuideReagent[] }[];
  } = {},
): GuideShoppingPlan {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const byOutput = new Map<number, Producer[]>();
  if (options.makeIfCheaper) {
    for (const recipe of [...recipes].sort((a, b) => a.id - b.id)) {
      if (!recipe.repeatable || !hasGuaranteedOutput(recipe)) continue;
      const makers = byOutput.get(recipe.output.itemId) ?? [];
      makers.push(recipe);
      byOutput.set(recipe.output.itemId, makers);
    }
  }
  const known = new Set<number>();
  const isKnown = (recipeId: number, skill: number) => known.has(recipeId)
    || (options.knownFromSkill?.get(recipeId) ?? Number.POSITIVE_INFINITY) <= skill;
  const quotes = new Map<number, number | null>();
  function quote(itemId: number): number | null {
    if (!quotes.has(itemId)) {
      const price = unitBuyCopper(itemId);
      quotes.set(itemId, price !== null && Number.isFinite(price) && price >= 0 ? price : null);
    }
    return quotes.get(itemId) ?? null;
  }

  function provide(state: State, need: GuideReagent, skill: number, visiting: ReadonlySet<number>): boolean {
    const { itemId, count } = need;
    if (visiting.has(itemId)) return false;
    const stock = state.stock.get(itemId) ?? 0;
    const shortfall = Math.max(0, count - stock);
    if (stock) state.stock.set(itemId, Math.max(0, stock - count));
    if (!shortfall) return true;

    const price = quote(itemId);
    const buyCost = price === null ? Number.POSITIVE_INFINITY : price * shortfall;
    let best: State | undefined;
    for (const recipe of byOutput.get(itemId) ?? []) {
      if (!isKnown(recipe.id, skill)) continue;
      const crafts = Math.ceil(shortfall / recipe.output.minimum);
      const candidate: State = { stock: new Map(state.stock), purchases: [], crafts: [], knownCopper: 0, missingQuote: false };
      const chain = new Set(visiting).add(itemId);
      const inputs = counted(recipe.reagents);
      const possible = inputs.every(({ itemId: reagent, count: perCraft }) =>
        provide(candidate, { itemId: reagent, count: perCraft * crafts }, skill, chain));
      if (!possible || candidate.missingQuote || candidate.knownCopper >= (best?.knownCopper ?? buyCost)) continue;
      const outputCount = crafts * recipe.output.minimum;
      candidate.stock.set(itemId, outputCount - shortfall);
      candidate.crafts.push({ recipeId: recipe.id, recipeName: recipe.name, itemId, crafts, outputCount, beforeSkill: skill });
      best = candidate;
    }

    if (best) {
      state.stock = best.stock;
      state.purchases.push(...best.purchases);
      state.crafts.push(...best.crafts);
      state.knownCopper += best.knownCopper;
    } else {
      state.purchases.push({ itemId, count: shortfall });
      state.knownCopper += price === null ? 0 : buyCost;
      state.missingQuote ||= price === null;
    }
    return true;
  }

  const state: State = { stock: new Map(), purchases: [], crafts: [], knownCopper: 0, missingQuote: false };
  const start = new Set<number>();
  const rankRequirements = [...(options.rankRequirements ?? [])].sort((a, b) => a.beforeSkill - b.beforeSkill);
  let rankIndex = 0;
  function collectRanks(until: number, skill: number) {
    while (rankIndex < rankRequirements.length && rankRequirements[rankIndex]!.beforeSkill < until) {
      for (const reagent of counted(rankRequirements[rankIndex++]!.reagents)) provide(state, reagent, skill, start);
    }
  }
  for (const step of steps) {
    collectRanks(step.toSkill ?? step.fromSkill + 1, step.fromSkill);
    const recipe = byId.get(step.recipeId);
    const unlock = isKnown(step.recipeId, step.fromSkill) ? [] : recipe?.unlockReagents ?? [];
    for (const reagent of counted([...unlock, ...step.reagents])) provide(state, reagent, step.fromSkill, start);
    if (hasGuaranteedOutput(recipe)) {
      const { itemId, minimum } = recipe.output;
      state.stock.set(itemId, (state.stock.get(itemId) ?? 0) + step.plannedCrafts * minimum);
    }
    known.add(step.recipeId);
  }
  if (steps.length > 0) collectRanks(Number.POSITIVE_INFINITY, steps.at(-1)!.fromSkill);

  return {
    purchases: counted(state.purchases).map((line) => {
      const unitCopper = quote(line.itemId);
      return { ...line, unitCopper, copper: unitCopper === null ? null : unitCopper * line.count };
    }),
    crafts: state.crafts,
    leftovers: Array.from(state.stock, ([itemId, count]) => ({ itemId, count }))
      .filter((line) => line.count > 0).sort((a, b) => a.itemId - b.itemId),
    copper: state.missingQuote ? null : state.knownCopper,
    knownCopper: state.knownCopper,
  };
}
