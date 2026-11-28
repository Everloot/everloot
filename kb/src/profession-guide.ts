export type GuideMode = "materials" | "vendor" | "auction" | "disenchant";
export type GuideEvidence = "observed" | "verified" | "modeled";
export type GuideReagent = { itemId: number; count: number };
type SkillRange = { fromSkill: number; toSkill: number };

export type GuideWindow = SkillRange & {
  /** The starting skill is included and the ending skill is excluded. */
  points: number;
  chance: number;
  /** When present, interpolate linearly through the chance at the exclusive end. */
  chanceAtEnd?: number;
  evidence: GuideEvidence;
};

export type GuideRecipe = {
  /** The recipe spell, which may produce an item with a different ID. */
  id: number;
  name: string;
  reagents: readonly GuideReagent[];
  /** Confirmed eligibility at these ranks. A recipe's windows must not overlap. */
  windows: readonly GuideWindow[];
  /** Copper per attempt, net of any recovery in the selected mode. Null means unpriced. */
  prices: Partial<Record<GuideMode, number | null>> & { materials: number | null };
  /** Omit for recipes with no trainer fee, or pass null for an unknown fee. */
  trainingCopper?: number | null;
};

export type GuideChoice = {
  recipeId: number;
  recipeName: string;
  expectedCrafts: number;
  /** Rounded expectation for the shopping list. Skill-ups can take more or fewer. */
  plannedCrafts: number;
  expectedCopper: number | null;
  evidence: GuideEvidence;
  probabilistic: boolean;
};

export type GuideStep = SkillRange & GuideChoice & {
  reagents: GuideReagent[];
  alternatives: GuideChoice[];
  trainingCopper?: number | null;
};

type GuideQuery = SkillRange & { mode: GuideMode; excludedRecipeIds?: readonly number[] };

export type GuidePlan = SkillRange & {
  mode: GuideMode;
  steps: GuideStep[];
  gaps: SkillRange[];
  reagents: GuideReagent[];
  totalExpectedCrafts: number;
  totalPlannedCrafts: number;
  probabilistic: boolean;
  /** Expected cost over the full route, excluding training. Null when incomplete. */
  expectedCopper: number | null;
  knownExpectedCopper: number;
  trainingCopper: number | null;
  knownTrainingCopper: number;
  unknownTrainingCount: number;
};

type Action = { recipe: GuideRecipe; window: GuideWindow; chance: number; copper: number | null; units: number };
type Edge = { nextSkill: number; action?: Action };
type Score = { gaps: number; unpriced: number; copper: number; modeled: number; units: number; crafts: number };

function price(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mergeReagents(reagents: Iterable<GuideReagent>): GuideReagent[] {
  const byId = new Map<number, number>();
  for (const { itemId, count } of reagents) byId.set(itemId, (byId.get(itemId) ?? 0) + count);
  return Array.from(byId, ([itemId, count]) => ({ itemId, count })).sort((a, b) => a.itemId - b.itemId);
}

function choice(action: Action, expectedCrafts: number, evidence = action.window.evidence, probabilistic = action.chance < 1): GuideChoice {
  return {
    recipeId: action.recipe.id,
    recipeName: action.recipe.name,
    expectedCrafts,
    plannedCrafts: Math.ceil(expectedCrafts - Number.EPSILON * expectedCrafts),
    expectedCopper: action.copper === null ? null : expectedCrafts * action.copper,
    evidence,
    probabilistic,
  };
}

const EVIDENCE_ORDER: Record<GuideEvidence, number> = { verified: 0, observed: 1, modeled: 2 };

function alternatives(actions: Map<number, Action>[], start: number, end: number, target: number, currentId: number): GuideChoice[] {
  const choices: GuideChoice[] = [];
  for (const first of actions[start]!.values()) {
    if (first.recipe.id === currentId) continue;
    let expectedCrafts = 0;
    let evidence = first.window.evidence;
    let probabilistic = false;
    let nextSkill = start;
    for (; nextSkill < end;) {
      const action = actions[nextSkill]!.get(first.recipe.id);
      if (!action) break;
      expectedCrafts += 1 / action.chance;
      probabilistic ||= action.chance < 1;
      if (EVIDENCE_ORDER[action.window.evidence] > EVIDENCE_ORDER[evidence]) evidence = action.window.evidence;
      nextSkill = Math.min(target, nextSkill + action.window.points);
    }
    if (nextSkill === end) choices.push(choice(first, expectedCrafts, evidence, probabilistic));
  }
  return choices.sort((a, b) => {
    const aCost = a.expectedCopper ?? Number.POSITIVE_INFINITY;
    const bCost = b.expectedCopper ?? Number.POSITIVE_INFINITY;
    return aCost - bCost || EVIDENCE_ORDER[a.evidence] - EVIDENCE_ORDER[b.evidence] || a.expectedCrafts - b.expectedCrafts || a.recipeId - b.recipeId;
  }).slice(0, 3);
}

export function planProfessionGuide(recipes: readonly GuideRecipe[], query: GuideQuery): GuidePlan {
  const { fromSkill, toSkill, mode } = query;
  if (!Number.isInteger(fromSkill) || !Number.isInteger(toSkill) || fromSkill < 1 || toSkill > 500 || fromSkill >= toSkill) {
    throw new RangeError("Choose whole skills between 1 and 500, with the target above the start.");
  }

  const excluded = new Set(query.excludedRecipeIds);
  const actions = Array.from({ length: toSkill }, () => new Map<number, Action>());
  for (const recipe of [...recipes].sort((a, b) => a.id - b.id)) {
    if (excluded.has(recipe.id)) continue;
    const copper = price(recipe.prices[mode]);
    const units = recipe.reagents.reduce((total, reagent) => total + reagent.count, 0);
    for (const window of recipe.windows) {
      if (!Number.isInteger(window.fromSkill) || !Number.isInteger(window.toSkill) || !Number.isInteger(window.points)
        || window.toSkill <= window.fromSkill || window.points < 1 || !(window.chance > 0 && window.chance <= 1)) continue;
      const end = window.chanceAtEnd ?? window.chance;
      if (!(end >= 0 && end <= 1)) continue;
      const slope = (end - window.chance) / (window.toSkill - window.fromSkill);
      for (let skill = Math.max(fromSkill, window.fromSkill); skill < Math.min(toSkill, window.toSkill); skill++) {
        const chance = window.chance + slope * (skill - window.fromSkill);
        if (!(chance > 0 && chance <= 1) || !Number.isFinite(1 / chance)) continue;
        if (mode !== "materials" && window.evidence === "modeled" && chance < 0.1 - Number.EPSILON) continue;
        actions[skill]!.set(recipe.id, { recipe, window, chance, copper, units });
      }
    }
  }

  const best: (Score & Edge)[] = [];
  best[toSkill] = { nextSkill: toSkill, gaps: 0, unpriced: 0, copper: 0, modeled: 0, units: 0, crafts: 0 };
  const compare = (a: Score, b: Score) => a.gaps - b.gaps || a.unpriced - b.unpriced || a.copper - b.copper
    || a.modeled - b.modeled || a.units - b.units || a.crafts - b.crafts;
  for (let skill = toSkill - 1; skill >= fromSkill; skill--) {
    const next = best[skill + 1]!;
    let selected: Score & Edge = { ...next, nextSkill: skill + 1, gaps: next.gaps + 1, action: undefined };
    for (const action of actions[skill]!.values()) {
      const nextSkill = Math.min(toSkill, skill + action.window.points);
      const rest = best[nextSkill]!;
      // A failed attempt leaves skill unchanged, so reaching the next rank takes 1 / p attempts on average.
      const attempts = 1 / action.chance;
      const candidate = {
        nextSkill, action, gaps: rest.gaps, unpriced: rest.unpriced + (action.copper === null ? nextSkill - skill : 0),
        copper: rest.copper + attempts * (action.copper ?? 0),
        modeled: rest.modeled + (action.window.evidence === "modeled" ? nextSkill - skill : 0),
        units: rest.units + attempts * action.units, crafts: rest.crafts + attempts,
      };
      if (compare(candidate, selected) < 0) selected = candidate;
    }
    best[skill] = selected;
  }

  const gaps: SkillRange[] = [];
  const groups: (SkillRange & { action: Action; expectedCrafts: number; probabilistic: boolean })[] = [];
  for (let skill = fromSkill; skill < toSkill;) {
    const { action, nextSkill } = best[skill]!;
    if (action) {
      const last = groups.at(-1);
      const probabilistic = action.chance < 1;
      const expectedCrafts = 1 / action.chance;
      if (last?.toSkill === skill && last.action.recipe.id === action.recipe.id
          && last.action.window.evidence === action.window.evidence && last.probabilistic === probabilistic) {
        last.toSkill = nextSkill;
        last.expectedCrafts += expectedCrafts;
      } else groups.push({ fromSkill: skill, toSkill: nextSkill, action, expectedCrafts, probabilistic });
    } else {
      const last = gaps.at(-1);
      if (last?.toSkill === skill) last.toSkill = nextSkill;
      else gaps.push({ fromSkill: skill, toSkill: nextSkill });
    }
    skill = nextSkill;
  }

  let knownExpectedCopper = 0;
  let knownTrainingCopper = 0;
  let unknownTrainingCount = 0;
  const learned = new Set<number>();
  const steps = groups.map(({ fromSkill: start, toSkill: end, action, expectedCrafts, probabilistic }): GuideStep => {
    const selected = choice(action, expectedCrafts, action.window.evidence, probabilistic);
    const training = learned.has(action.recipe.id) ? undefined : action.recipe.trainingCopper;
    learned.add(action.recipe.id);
    knownExpectedCopper += selected.expectedCopper ?? 0;
    knownTrainingCopper += training ?? 0;
    unknownTrainingCount += Number(training === null);
    return {
      ...selected, fromSkill: start, toSkill: end,
      reagents: mergeReagents(action.recipe.reagents.map((r) => ({ ...r, count: r.count * selected.plannedCrafts }))),
      alternatives: alternatives(actions, start, end, toSkill, action.recipe.id),
      ...(training === undefined ? {} : { trainingCopper: training }),
    };
  });

  return {
    fromSkill, toSkill, mode, steps, gaps,
    reagents: mergeReagents(steps.flatMap((step) => step.reagents)),
    totalExpectedCrafts: steps.reduce((sum, step) => sum + step.expectedCrafts, 0),
    totalPlannedCrafts: steps.reduce((sum, step) => sum + step.plannedCrafts, 0),
    probabilistic: steps.some((step) => step.probabilistic),
    expectedCopper: gaps.length || steps.some((step) => step.expectedCopper === null) ? null : knownExpectedCopper,
    knownExpectedCopper,
    trainingCopper: unknownTrainingCount ? null : knownTrainingCopper,
    knownTrainingCopper,
    unknownTrainingCount,
  };
}
