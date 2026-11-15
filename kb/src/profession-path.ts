/**
 * Leveling path from Everloot uploads.
 * A recipe is public after 3 distinct install reports agree on the name, the
 * skill window, the points per craft, and the reagents. Costs use unscoped
 * observed prices or an NPC vendor price 3 installs agree on. A bracket with
 * no agreed recipe is a gap, not a guess. Same agreement bar as drop rates.
 * Do not feed this a copied guide.
 */

import { WORLD_AGREEMENT } from "./world-pages.js";

export const PATH_AGREEMENT = 3;

export const PATH_RULE =
  "A recipe joins the path when 3 distinct install reports agree on its name, skill window, points per craft, and reagents. A recipe can also join from the colours players' profession windows showed: only the ranks where 3 installs' data shows it orange (a guaranteed skill-up, counted as 1 point per craft), starting at the trainer's required rank when 3 installs agree on it, else at the lowest rank it was seen orange, with the reagents 3 installs saw. Routes prioritize recipe coverage, then priced skill gains, then estimated reagent cost. Estimates use median reagent prices from at least 3 distinct install reports: unscoped observed prices without realm, build, or observation time, not a guaranteed current realm minimum. A price report is a reported price or an install's latest per-unit auction scan of that reagent, from any realm, or an NPC vendor price 3 installs agree on. Missing prices prevent comparison of all recipes; unpriced steps keep their cost unknown. Training costs are listed apart from reagent gold, as the median of 3 installs' trainer prices, and do not change the route. A bracket with no agreed recipe is a gap, not a guess.";

export type Reagent = { item: string; count: number };

export type RecipeSighting = {
  installId: string;
  profession: string;
  recipe: string;
  /** Inclusive skill where this craft still grants points. */
  skillMin: number;
  /** Exclusive skill where it stops. */
  skillMax: number;
  points: number;
  reagents: Reagent[];
};

export type PriceSighting = { installId: string; item: string; copper: number };

export type PathStep = {
  recipe: string;
  fromSkill: number;
  toSkill: number;
  crafts: number;
  points: number;
  reagents: Reagent[];
  copper: number | null;
  reporters: number;
  /** Derived steps only: agreed training cost, or null when unrecorded. */
  trainingCopper?: number | null;
};

export type ProfessionPath = {
  profession: string;
  fromSkill: number;
  toSkill: number;
  steps: PathStep[];
  gaps: { fromSkill: number; toSkill: number }[];
  reagents: Reagent[];
  copper: number | null;
};

/** A recipe step the planner can use: agreed from recipe_seen rows, or derived (recipe-thresholds). */
export type AgreedRecipe = {
  recipe: string;
  skillMin: number;
  skillMax: number;
  points: number;
  reagents: Reagent[];
  reporters: number;
  /** Derived steps only: the median training cost of 3 installs' trainers, or null when unrecorded. */
  trainingCopper?: number | null;
};

function clean(value: string): string {
  return value.trim().toLowerCase();
}

export function reagentKey(reagents: Reagent[]): string {
  return [...reagents]
    .map((reagent) => ({ item: clean(reagent.item), count: reagent.count }))
    .sort((a, b) => a.item.localeCompare(b.item) || a.count - b.count)
    .map((reagent) => `${reagent.item}:${reagent.count}`)
    .join(",");
}

function usableSighting(row: RecipeSighting): boolean {
  return (
    row.installId.trim().length > 0 &&
    row.profession.trim().length > 0 &&
    row.recipe.trim().length > 0 &&
    Number.isInteger(row.skillMin) &&
    Number.isInteger(row.skillMax) &&
    row.skillMax > row.skillMin &&
    Number.isInteger(row.points) &&
    row.points >= 1 &&
    row.reagents.length > 0 &&
    row.reagents.every((reagent) => reagent.item.trim().length > 0 && Number.isInteger(reagent.count) && reagent.count >= 1)
  );
}

export function agreeRecipes(sightings: RecipeSighting[], profession: string): AgreedRecipe[] {
  const groups = new Map<string, { row: RecipeSighting; installs: Set<string> }>();
  for (const row of sightings) {
    if (!usableSighting(row) || clean(row.profession) !== clean(profession)) continue;
    const key = [clean(row.recipe), row.skillMin, row.skillMax, row.points, reagentKey(row.reagents)].join("|");
    const group = groups.get(key) ?? { row, installs: new Set<string>() };
    group.installs.add(row.installId);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.installs.size >= PATH_AGREEMENT)
    .map((group) => ({
      recipe: group.row.recipe.trim(),
      skillMin: group.row.skillMin,
      skillMax: group.row.skillMax,
      points: group.row.points,
      reagents: group.row.reagents.map((reagent) => ({ item: reagent.item.trim(), count: reagent.count })),
      reporters: group.installs.size,
    }));
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function agreePrices(prices: PriceSighting[]): Map<string, number> {
  const latest = new Map<string, number>();
  for (const row of prices) {
    if (!row.installId.trim() || !row.item.trim() || !Number.isInteger(row.copper) || row.copper < 0) continue;
    latest.set(`${clean(row.item)}|${row.installId}`, row.copper);
  }
  const byItem = new Map<string, number[]>();
  for (const [key, copper] of latest) {
    const item = key.slice(0, key.lastIndexOf("|"));
    const list = byItem.get(item) ?? [];
    list.push(copper);
    byItem.set(item, list);
  }
  const agreed = new Map<string, number>();
  for (const [item, coppers] of byItem) {
    if (coppers.length >= PATH_AGREEMENT) agreed.set(item, median(coppers));
  }
  return agreed;
}

/** Player agreed price, else vendor, else the lower of the two. Vendor never overwrites player sightings. */
export function mergeVendorPrices(agreed: Map<string, number>, vendorAgreed: Map<string, number>): Map<string, number> {
  const out = new Map(agreed);
  for (const [item, copper] of vendorAgreed) {
    const player = out.get(item);
    out.set(item, player === undefined ? copper : Math.min(player, copper));
  }
  return out;
}

function units(reagents: Reagent[]): number {
  return reagents.reduce((sum, reagent) => sum + reagent.count, 0);
}

function scale(reagents: Reagent[], crafts: number): Reagent[] {
  return reagents.map((reagent) => ({ item: reagent.item, count: reagent.count * crafts }));
}

function merge(lists: Reagent[][]): Reagent[] {
  const totals = new Map<string, { item: string; count: number }>();
  for (const list of lists) {
    for (const reagent of list) {
      const key = clean(reagent.item);
      const current = totals.get(key) ?? { item: reagent.item, count: 0 };
      current.count += reagent.count;
      totals.set(key, current);
    }
  }
  return [...totals.values()].sort((a, b) => a.item.localeCompare(b.item));
}

function stepCost(reagents: Reagent[], prices: Map<string, number>): number | null {
  let copper = 0;
  for (const reagent of reagents) {
    const price = prices.get(clean(reagent.item));
    if (price === undefined) return null;
    copper += price * reagent.count;
  }
  return copper;
}

export function professionPath(
  sightings: RecipeSighting[],
  prices: PriceSighting[],
  query: { profession: string; fromSkill: number; toSkill: number },
  derived: (AgreedRecipe & { profession: string })[] = [],
  vendorPrices: Map<string, number> = new Map(),
): ProfessionPath {
  const recipes = [
    ...agreeRecipes(sightings, query.profession),
    ...derived.filter((step) => clean(step.profession) === clean(query.profession)).map(({ profession: _, ...step }) => step),
  ];
  const priceByItem = mergeVendorPrices(agreePrices(prices), vendorPrices);
  const steps: PathStep[] = [];
  const gaps: { fromSkill: number; toSkill: number }[] = [];
  type Plan = { gapSkills: number; unpricedSkills: number; copper: number; units: number; crafts: number; nextSkill: number; recipe?: AgreedRecipe };
  const plans = new Map<number, Plan>();
  const craftPrices = new Map(recipes.map((recipe) => [recipe, stepCost(recipe.reagents, priceByItem)]));
  // Stable order resolves otherwise equal plans, including multiple windows for one recipe.
  recipes.sort((a, b) => a.recipe.localeCompare(b.recipe) || a.skillMin - b.skillMin || a.skillMax - b.skillMax || b.points - a.points || reagentKey(a.reagents).localeCompare(reagentKey(b.reagents)));
  plans.set(query.toSkill, { gapSkills: 0, unpricedSkills: 0, copper: 0, units: 0, crafts: 0, nextSkill: query.toSkill });
  const compare = (a: Plan, b: Plan): number => a.gapSkills - b.gapSkills || a.unpricedSkills - b.unpricedSkills || a.copper - b.copper || a.units - b.units || a.crafts - b.crafts;

  // Callers bound skill ranges to a few hundred points. One craft per edge allows
  // switches at unlocks and counts the full cost of a craft that overshoots a target.
  if (Number.isInteger(query.fromSkill) && Number.isInteger(query.toSkill)) {
    for (let skill = query.toSkill - 1; skill >= query.fromSkill; skill--) {
      const open = recipes.filter((recipe) => recipe.skillMin <= skill && skill < recipe.skillMax);
      if (open.length === 0) {
        const rest = plans.get(skill + 1)!;
        plans.set(skill, { ...rest, gapSkills: rest.gapSkills + 1, nextSkill: skill + 1, recipe: undefined });
        continue;
      }
      let best: Plan | undefined;
      for (const recipe of open) {
        const nextSkill = Math.min(skill + recipe.points, query.toSkill);
        const rest = plans.get(nextSkill)!;
        const copper = craftPrices.get(recipe)!;
        const candidate: Plan = {
          gapSkills: rest.gapSkills,
          unpricedSkills: rest.unpricedSkills + (copper === null ? nextSkill - skill : 0),
          copper: rest.copper + (copper ?? 0),
          units: rest.units + units(recipe.reagents),
          crafts: rest.crafts + 1,
          nextSkill,
          recipe,
        };
        if (!best || compare(candidate, best) < 0) best = candidate;
      }
      plans.set(skill, best!);
    }
  }

  let skill = query.fromSkill;
  let previousRecipe: AgreedRecipe | undefined;
  while (skill < query.toSkill && plans.has(skill)) {
    const { recipe: chosen, nextSkill } = plans.get(skill)!;
    if (!chosen) {
      const previous = gaps[gaps.length - 1];
      if (previous?.toSkill === skill) previous.toSkill = nextSkill;
      else gaps.push({ fromSkill: skill, toSkill: nextSkill });
      previousRecipe = undefined;
    } else {
      const previous = steps[steps.length - 1];
      const crafts = chosen === previousRecipe && previous ? previous.crafts + 1 : 1;
      const reagents = scale(chosen.reagents, crafts);
      if (chosen === previousRecipe && previous) {
        previous.toSkill = nextSkill;
        previous.crafts = crafts;
        previous.reagents = reagents;
        previous.copper = stepCost(reagents, priceByItem);
      } else {
        steps.push({
          recipe: chosen.recipe,
          fromSkill: skill,
          toSkill: nextSkill,
          crafts,
          points: chosen.points,
          reagents,
          copper: stepCost(reagents, priceByItem),
          reporters: chosen.reporters,
          trainingCopper: chosen.trainingCopper,
        });
      }
      previousRecipe = chosen;
    }
    skill = nextSkill;
  }

  const reagents = merge(steps.map((step) => step.reagents));
  const copper = steps.length > 0 && steps.every((step) => step.copper !== null)
    ? steps.reduce((sum, step) => sum + (step.copper ?? 0), 0)
    : null;
  return { profession: query.profession.trim(), fromSkill: query.fromSkill, toSkill: query.toSkill, steps, gaps, reagents, copper };
}

export function formatCopper(copper: number): string {
  const gold = Math.floor(copper / 10000);
  const silver = Math.floor((copper % 10000) / 100);
  const coins = copper % 100;
  const parts: string[] = [];
  if (gold > 0) parts.push(`${gold}g`);
  if (silver > 0 || gold > 0) parts.push(`${silver}s`);
  parts.push(`${coins}c`);
  return parts.join(" ");
}

export function formatProfessionPath(path: ProfessionPath): string {
  if (!Number.isInteger(path.fromSkill) || !Number.isInteger(path.toSkill) || path.toSkill <= path.fromSkill) {
    return "The target skill has to be above the starting skill.";
  }
  const lines = [`${path.profession}, skill ${path.fromSkill}–${path.toSkill}`, PATH_RULE];
  if (path.steps.length === 0 && path.gaps.length === 0) return lines.join("\n");
  for (const step of path.steps) {
    const mats = step.reagents.map((reagent) => `${reagent.count} ${reagent.item}`).join(", ");
    const gold = step.copper === null ? "no agreed price yet" : `estimated ${formatCopper(step.copper)}`;
    lines.push(
      `${step.fromSkill}–${step.toSkill}  ${step.recipe}  ${step.crafts} crafts × ${step.points}  ${mats}  ${step.reporters} reporters  ${gold}`,
    );
  }
  for (const gap of path.gaps) lines.push(`Gap ${gap.fromSkill}–${gap.toSkill}. No agreed recipe.`);
  const trainable = [...new Map(path.steps.filter((step) => step.trainingCopper !== undefined).map((step) => [clean(step.recipe), step])).values()];
  if (trainable.length > 0) {
    const known = trainable.filter((step): step is PathStep & { trainingCopper: number } => typeof step.trainingCopper === "number");
    const unknown = trainable.filter((step) => step.trainingCopper === null).map((step) => step.recipe);
    const parts: string[] = [];
    if (known.length > 0) {
      const total = known.reduce((sum, step) => sum + step.trainingCopper, 0);
      parts.push(`Training, if not yet learned: ${formatCopper(total)} (${known.map((step) => `${step.recipe} ${formatCopper(step.trainingCopper)}`).join(", ")}).`);
    }
    if (unknown.length > 0) parts.push(`Training for ${unknown.join(", ")} unrecorded.`);
    lines.push(parts.join(" "));
  }
  if (path.reagents.length > 0) {
    const partial = path.gaps.length > 0;
    const mats = path.reagents.map((reagent) => `${reagent.count} ${reagent.item}`).join(", ");
    lines.push(partial ? `Reagents for agreed steps: ${mats}` : `Reagents: ${mats}`);
    if (path.copper === null) {
      lines.push("Estimated gold: waiting on agreed prices.");
    } else if (partial) {
      const gaps = path.gaps.map((gap) => `${gap.fromSkill}–${gap.toSkill}`).join(", ");
      lines.push(`Estimated gold for agreed steps: ${formatCopper(path.copper)}. Gold for ${gaps} unrecorded.`);
    } else {
      lines.push(`Estimated gold: ${formatCopper(path.copper)}`);
    }
  }
  return lines.join("\n");
}

export function professionFactsFromRecords(records: unknown[]): { sightings: RecipeSighting[]; prices: PriceSighting[]; vendorPrices: Map<string, number> } {
  const sightings: RecipeSighting[] = [];
  const prices: PriceSighting[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.installId !== "string") continue;
    if (
      row.kind === "recipe_seen" &&
      typeof row.profession === "string" &&
      typeof row.recipe === "string" &&
      typeof row.skillMin === "number" &&
      typeof row.skillMax === "number" &&
      typeof row.points === "number" &&
      Array.isArray(row.reagents)
    ) {
      const reagents: Reagent[] = [];
      for (const reagent of row.reagents) {
        if (!reagent || typeof reagent !== "object") continue;
        const item = (reagent as { item?: unknown }).item;
        const count = (reagent as { count?: unknown }).count;
        if (typeof item === "string" && typeof count === "number") reagents.push({ item, count });
      }
      sightings.push({
        installId: row.installId,
        profession: row.profession,
        recipe: row.recipe,
        skillMin: row.skillMin,
        skillMax: row.skillMax,
        points: row.points,
        reagents,
      });
    }
    if (row.kind === "price_seen" && typeof row.item === "string" && typeof row.copper === "number") {
      prices.push({ installId: row.installId, item: row.item, copper: row.copper });
    }
  }
  return { sightings, prices: [...prices, ...auctionPrices(records)], vendorPrices: agreeVendorPrices(records) };
}

/**
 * The name most installs' clients reported for each item ID. Recipes name
 * reagents, scans and vendor rows carry item IDs, so both price paths share it.
 */
function itemNames(records: unknown[]): Map<number, string> {
  const namers = new Map<number, Map<string, Set<string>>>();
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.installId !== "string" || typeof row.itemId !== "number") continue;
    if (row.kind === "item_seen" && typeof row.name === "string" && row.name.trim()) {
      const names = namers.get(row.itemId) ?? new Map<string, Set<string>>();
      names.set(row.name.trim(), (names.get(row.name.trim()) ?? new Set()).add(row.installId));
      namers.set(row.itemId, names);
    }
  }
  const out = new Map<number, string>();
  for (const [itemId, names] of namers) {
    const sorted = [...names].sort(([a, x], [b, y]) => y.size - x.size || a.localeCompare(b));
    if (sorted.length > 0) out.set(itemId, sorted[0]![0]);
  }
  return out;
}

/**
 * Agreed NPC vendor price per reagent name. A price counts when at least
 * WORLD_AGREEMENT distinct installs reported the same itemId at the same
 * priceCopper (same rule as vendorPage, across vendors). Several agreed
 * prices for one item keep the lowest: anyone can buy from that vendor.
 */
export function agreeVendorPrices(records: unknown[]): Map<string, number> {
  const names = itemNames(records);
  const groups = new Map<string, { itemId: number; priceCopper: number; installs: Set<string> }>();
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.installId !== "string" || !row.installId.trim()) continue;
    if (row.kind !== "vendor" || typeof row.vendorNpcId !== "number" || !Array.isArray(row.items)) continue;
    for (const rawItem of row.items) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const offer = rawItem as { itemId?: unknown; priceCopper?: unknown };
      if (!Number.isInteger(offer.itemId) || (offer.itemId as number) < 1) continue;
      if (!Number.isInteger(offer.priceCopper) || (offer.priceCopper as number) < 0) continue;
      const key = `${offer.itemId as number}|${offer.priceCopper as number}`;
      const group = groups.get(key) ?? { itemId: offer.itemId as number, priceCopper: offer.priceCopper as number, installs: new Set<string>() };
      group.installs.add(row.installId.trim());
      groups.set(key, group);
    }
  }
  const out = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.installs.size < WORLD_AGREEMENT) continue;
    const name = names.get(group.itemId);
    if (!name) continue;
    const key = clean(name);
    const prev = out.get(key);
    if (prev === undefined || group.priceCopper < prev) out.set(key, group.priceCopper);
  }
  return out;
}

/**
 * Per-unit auction scans as price reports. Recipes name reagents, scans carry item IDs, so the
 * name is the one most installs' clients reported for that ID. Latest scan per install, any realm.
 */
function auctionPrices(records: unknown[]): PriceSighting[] {
  const names = itemNames(records);
  const latest = new Map<string, { installId: string; itemId: number; copper: number; seenAt: string }>();
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.installId !== "string" || typeof row.itemId !== "number") continue;
    // 0.2.1 rows stored a whole stack's buyout; only per-unit rows price one reagent.
    if (row.kind === "auction_scan" && row.priceBasis === "unit" && typeof row.copper === "number") {
      const seenAt = typeof row.capturedAt === "string" ? row.capturedAt : "";
      const key = `${row.installId}|${row.itemId}`;
      const prev = latest.get(key);
      if (!prev || seenAt > prev.seenAt) latest.set(key, { installId: row.installId, itemId: row.itemId, copper: row.copper, seenAt });
    }
  }
  const out: PriceSighting[] = [];
  for (const scan of latest.values()) {
    const name = names.get(scan.itemId);
    if (name !== undefined) out.push({ installId: scan.installId, item: name, copper: scan.copper });
  }
  return out;
}

export function handleProfessionPath(
  args: { profession: string; fromSkill?: number; toSkill?: number },
  sightings: RecipeSighting[] = [],
  prices: PriceSighting[] = [],
  derived: (AgreedRecipe & { profession: string })[] = [],
  vendorPrices: Map<string, number> = new Map(),
): string {
  const profession = args.profession.trim();
  if (!profession) return "Name a profession.";
  const fromSkill = args.fromSkill ?? 1;
  const toSkill = args.toSkill ?? fromSkill;
  return formatProfessionPath(professionPath(sightings, prices, { profession, fromSkill, toSkill }, derived, vendorPrices));
}
