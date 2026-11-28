import type { AuctionHouse } from "@everloot/protocol";

// The recipe card is a client component: the realm and house readers are restated here rather than importing the
// market modules into the browser bundle. Tests hold them to lib/auction-house.ts's slugParam, houseParam and realmSlug.
function slugParam(raw: string): string | null {
  let slug: string;
  try { slug = decodeURIComponent(raw).toLowerCase(); } catch { return null; }
  return slug.length <= 40 && /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(slug) ? slug : null;
}
const HOUSE_SLUGS: Readonly<Record<string, AuctionHouse>> = { alliance: "Alliance", horde: "Horde", neutral: "Neutral" };
const houseParam = (raw: string): AuctionHouse | null => (Object.prototype.hasOwnProperty.call(HOUSE_SLUGS, raw) ? HOUSE_SLUGS[raw] : null);
/** A realm name's URL slug, as lib/auction-house.ts realmSlug makes it. */
export function realmSlugOf(name: string): string {
  const slug = name.trim().toLowerCase().replace(/['\u2019]/g, "").replace(/[\s-]+/g, "-").replace(/-+$/, "");
  return slug === "item" ? "item-realm" : slug;
}

/**
 * The website's crafting estimate, held to the addon's calculator (addon/modules/crafting.lua) and planner
 * (addon/modules/crafting_plan.lua) by the shared fixture addon/tests/fixtures/crafting-parity.json. Copper is
 * integer. Profit and margin are per craft; the sale for a craft count is rounded once, for the whole count.
 *
 * The website's sources differ from the addon's, and say so: an auction house quote is Everloot's community market
 * value for the selected realm and house, a material without one stays unpriced (its minimum is never the basis), and
 * a community vendor observation is an offer, never a unit price (its schema has no purchase quantity or extra cost).
 * No verified vendor sell price is published, so the vendor destination stays unavailable here. Catalog recipes are
 * hypothetical routes the reader allows, never checked against any character.
 */

export type Destination = "ah" | "vendor";
export type Strategy = "buy" | "cheapest";

/** An item's newest public day older than this many days is stale (the addon's E.STALE_DAYS). */
export const STALE_DAYS = 2;
/** The auction house cut, percent (the addon's SellCheck.CUT). */
export const HOUSE_CUT: Readonly<Record<AuctionHouse, number>> = { Alliance: 5, Horde: 5, Neutral: 15 };

/** What is known about buying or selling one item. Every field is optional: absent is unknown, never zero. */
export interface ItemQuotes {
  /**
   * The auction market value per unit and its day; unit null when the item has only a minimum. `ageDays`, when the
   * server gives it, is the day's age it computed; otherwise the age is counted from `today`.
   */
  market?: { unit: number | null; day: string | null; ageDays?: number } | null;
  /** Verified single-unit merchant price with no extra cost. The website has none. */
  vendorUnit?: number | null;
  /** Verified vendor sell price for one unit. The website has none. */
  vendorSell?: number | null;
}
export type QuoteBook = ReadonlyMap<number, ItemQuotes>;

export interface CraftRecipe {
  id: number;
  name: string;
  /** The item the recipe makes (the files' output item ID); priced by this ID, never by name. */
  product: number | null;
  /** One craft's output; null or a null range is unknown and never counts as one. */
  output: { minimum: number | null; maximum: number | null } | null;
  reagents: readonly { itemId: number; count: number }[];
}

export interface UnitQuote { unit: number; vendor: boolean; day: string | null; ageDays?: number }

/** Whether a market quote is stale: the server's age when given, else its day against `today`. */
export function staleQuote(q: { day: string | null; ageDays?: number } | null | undefined, today: string): boolean {
  if (!q) return false;
  return typeof q.ageDays === "number" ? q.ageDays > STALE_DAYS : staleDay(q.day, today);
}

/**
 * Quotes from the market price rows (`fields=full` tuples: itemId, market, min, historical, quantity, day, reporters,
 * updatedAt, ageDays, ...). Only the market value is a price; a row with only a minimum stays unpriced.
 */
export function quotesFromPriceRows(rows: readonly (readonly unknown[])[]): Map<number, ItemQuotes> {
  const out = new Map<number, ItemQuotes>();
  for (const row of rows) {
    const [itemId, market, , , , day, , , ageDays] = row;
    if (typeof itemId !== "number") continue;
    out.set(itemId, { market: { unit: typeof market === "number" && Number.isFinite(market) && market >= 0 ? market : null, day: typeof day === "string" ? day : null,
      ...(typeof ageDays === "number" ? { ageDays } : {}) } });
  }
  return out;
}

export interface PartEstimate {
  itemId: number;
  count: number;
  unit: number | null;
  source: "ah" | "vendor" | null;
  day: string | null;
  stale: boolean;
}

export interface CraftEstimate {
  id: number;
  name: string;
  crafts: number;
  destination: Destination;
  cutPercent: number;
  parts: PartEstimate[];
  unpriced: number;
  /** Materials per craft; null when any material has no price. */
  cost: number | null;
  /** The product's auction value per unit and its day. */
  value: number | null;
  valueDay: string | null;
  /** A verified vendor sell price per unit. */
  vendorValue: number | null;
  /** Average items per craft (the expected sale); null when unknown. */
  yield: number | null;
  /** Per craft at the destination. */
  profit: number | null;
  margin: number | null;
  /** For `crafts` crafts, rounded once. */
  gross: number | null;
  cut: number | null;
  batchProfit: number | null;
  stale: boolean;
  /** Why profit is unavailable, in words, when it is. */
  unavailable: string | null;
}

const isUnit = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;

function dayNumber(day: string | null | undefined): number | null {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(day)) return null;
  const t = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : null;
}

/** Whether a community day is stale against `today` (both YYYY-MM-DD, UTC). */
export function staleDay(day: string | null | undefined, today: string): boolean {
  const seen = dayNumber(day), now = dayNumber(today);
  return seen !== null && now !== null && now - seen > STALE_DAYS;
}

/** Today's UTC day, as the addon reads it. */
export const utcToday = (now: Date = new Date()) => now.toISOString().slice(0, 10);

/** What one unit costs to buy: the market value, or a verified vendor unit price when that is lower or the only one. */
export function unitQuote(quotes: ItemQuotes | undefined): UnitQuote | null {
  const market = quotes?.market && typeof quotes.market.unit === "number" && Number.isFinite(quotes.market.unit) ? quotes.market : null;
  const vendor = isUnit(quotes?.vendorUnit) ? quotes!.vendorUnit! : null;
  if (vendor !== null && (!market || vendor < market.unit!)) return { unit: vendor, vendor: true, day: null };
  if (market) return { unit: market.unit!, vendor: false, day: market.day ?? null, ...(typeof market.ageDays === "number" ? { ageDays: market.ageDays } : {}) };
  return null;
}

function sale(unit: number, perCraft: number, crafts: number, cutPercent: number, vendor: boolean) {
  const gross = Math.floor(unit * perCraft * crafts);
  const net = vendor ? gross : Math.floor((gross * (100 - cutPercent)) / 100);
  return { gross, cut: gross - net, net };
}

/** One recipe's estimate at the selected house and destination for `crafts` crafts. */
export function evaluateCraft(recipe: CraftRecipe, quotes: QuoteBook, options: { house: AuctionHouse; destination?: Destination; crafts?: number; today: string }): CraftEstimate {
  const crafts = options.crafts ?? 1;
  const destination = options.destination === "vendor" ? "vendor" : "ah";
  const vendor = destination === "vendor";
  const cutPercent = HOUSE_CUT[options.house];
  let cost: number | null = 0;
  let unpriced = 0;
  const parts = recipe.reagents.map((g): PartEstimate => {
    const q = unitQuote(quotes.get(g.itemId));
    if (q && cost !== null) cost += q.unit * g.count;
    if (!q) { unpriced += 1; cost = null; }
    return { itemId: g.itemId, count: g.count, unit: q?.unit ?? null, source: q ? (q.vendor ? "vendor" : "ah") : null, day: q?.day ?? null,
      stale: Boolean(q && !q.vendor && staleQuote(q, options.today)) };
  });
  const product = recipe.product !== null ? quotes.get(recipe.product) : undefined;
  const market = product?.market && typeof product.market.unit === "number" ? product.market : null;
  const value = market ? market.unit : null;
  const valueDay = market?.day ?? null;
  const vendorValue = isUnit(product?.vendorSell) ? product!.vendorSell! : null;
  const out = recipe.output;
  const known = out !== null && isUnit(out.minimum) && isUnit(out.maximum) && out.minimum <= out.maximum;
  const perCraft = known ? (out!.minimum! + out!.maximum!) / 2 : null;
  const unit = vendor ? vendorValue : value;
  let profit: number | null = null, gross: number | null = null, cut: number | null = null, batchProfit: number | null = null;
  if (unit !== null && perCraft !== null) {
    const one = sale(unit, perCraft, 1, cutPercent, vendor);
    const all = sale(unit, perCraft, crafts, cutPercent, vendor);
    gross = all.gross; cut = all.cut;
    if (cost !== null) { profit = one.net - cost; batchProfit = all.net - cost * crafts; }
  }
  const unavailable = perCraft === null ? "output count unknown"
    : unit === null ? (vendor ? "no verified vendor sell price" : "no market value for the finished item")
    : cost === null ? "a material has no price" : null;
  const stale = (!vendor && value !== null && staleQuote(market, options.today)) || parts.some((p) => p.stale);
  return {
    id: recipe.id, name: recipe.name, crafts, destination, cutPercent, parts, unpriced, cost, value, valueDay, vendorValue,
    yield: perCraft, profit, margin: profit !== null && cost !== null && cost > 0 ? profit / cost : null,
    gross, cut, batchProfit, stale, unavailable,
  };
}

// Ranking --------------------------------------------------------------------------------------------------------

export interface RankRow { id: number; name: string; key?: string; profit: number | null; cost: number | null }

// Profit first, highest first; then rows whose product has no price; then those whose cost is unknown.
const rankOf = (r: RankRow) => (r.profit !== null ? 1 : r.cost !== null ? 2 : 3);
// Names compare as the addon's Lua does: by code unit, not by locale.
function byNameThenId(a: RankRow, b: RankRow): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.id !== b.id) return a.id - b.id;
  const ka = String(a.key ?? ""), kb = String(b.key ?? "");
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
function byProfit(a: RankRow, b: RankRow): number {
  const ra = rankOf(a), rb = rankOf(b);
  if (ra !== rb) return ra - rb;
  if (a.profit !== null && b.profit !== null && a.profit !== b.profit) return b.profit - a.profit;
  return byNameThenId(a, b);
}

/** Rows in a new list, the addon's Crafting.Rank order; profitableOnly keeps a known gain only. */
export function rankCrafts<T extends RankRow>(rows: readonly T[], options: { sort?: "profit" | "name"; profitableOnly?: boolean } = {}): T[] {
  const kept = rows.filter((r) => !options.profitableOnly || (r.profit !== null && r.profit > 0));
  return kept.sort(options.sort === "name" ? byNameThenId : byProfit);
}

/**
 * A profession's recipes evaluated once each for one craft at one house, ranked: the rows with a known profit in the
 * addon's order, and how many could not be estimated and why. Recipes that make nothing or take nothing are left out.
 */
export function professionRanking(
  recipes: readonly { spellId: number; itemId: number | null; reagents: readonly { itemId: number; count: number }[]; output?: { itemId: number; minimum: number | null; maximum: number | null } }[],
  quotes: QuoteBook, options: { house: AuctionHouse; today: string; name: (spellId: number) => string },
): { rows: CraftEstimate[]; summary: { total: number; ranked: number; unknownOutput: number; noSale: number; unpriced: number } } {
  const all = recipes.filter((r) => r.itemId && r.reagents.length).map((r) => evaluateCraft({
    id: r.spellId, name: options.name(r.spellId), product: r.output?.itemId ?? r.itemId,
    output: r.output ? { minimum: r.output.minimum, maximum: r.output.maximum } : null, reagents: r.reagents,
  }, quotes, { house: options.house, today: options.today }));
  const rows = rankCrafts(all.filter((e) => e.profit !== null).map((e) => ({ ...e, key: String(e.id) })));
  const count = (why: string) => all.filter((e) => e.profit === null && e.unavailable === why).length;
  return { rows, summary: { total: all.length, ranked: rows.length, unknownOutput: count("output count unknown"), noSale: count("no market value for the finished item"), unpriced: count("a material has no price") } };
}

// Plans ----------------------------------------------------------------------------------------------------------

/** A catalog recipe the planner may use when the reader allows it: hypothetical, never checked against a character. */
export interface CatalogRecipe {
  recipeId: number;
  itemId: number;
  minimum: number | null;
  maximum: number | null;
  reagents: readonly { itemId: number; count: number }[];
  /** A cooldown the game files record; such a recipe is never a route (null is not proof of none). */
  cooldownMs: number | null;
}

export interface PlanRequest {
  recipeId: number;
  crafts: number;
  recipe: { itemId: number | null; minimum: number | null; maximum: number | null; reagents: readonly { itemId: number; count: number }[] };
}

export type ExclusionReason = "output" | "cooldown" | "cycle" | "reagents" | "unknown";
export interface PlanExclusion { recipeId: number; itemId: number | null; reason: ExclusionReason }
export type PlanLimit = { kind: "depth"; itemId: number; depth: number } | { kind: "recipes"; limit: number } | { kind: "passes"; limit: number } | { kind: "purchases"; limit: number; omitted: number };

export interface CraftPlan {
  strategy: Strategy;
  purchases: { itemId: number; count: number; unit: number | null; vendor: boolean }[];
  omitted: { itemId: number; count: number; unit: number | null; vendor: boolean }[];
  steps: { recipeId: number; crafts: number }[];
  leftovers: Record<number, number>;
  possibleLeftovers: Record<number, number>;
  used: Record<number, number>;
  unpriced: { itemId: number; count: number }[];
  exclusions: PlanExclusion[];
  limits: PlanLimit[];
  decisions: { itemId: number; need: number; made: number; bought: number; recipeId: number | null; crafts: number; unpriced: boolean }[];
  /** The economic valuation of the route chosen without owned stock; null when an input is unpriced, never zero. */
  cost: number | null;
  /** What the purchases cost after owned stock is used once. */
  cashCost: number | null;
  /** The all-buy route. */
  buyCost: number | null;
  complete: boolean;
  optimality: "buy" | "bounded";
  rejected?: "no request" | "invalid count" | "invalid recipe" | "crafts";
}

/** The addon planner's bounds (CraftingPlan.LIMITS). */
export const PLAN_LIMITS = { depth: 12, recipes: 500, purchases: 50, crafts: 9999, passes: 4 } as const;

const whole = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 1;

function reagentList(list: readonly { itemId: number; count: number }[] | null | undefined) {
  if (!Array.isArray(list)) return null;
  const out: { itemId: number; count: number }[] = [];
  for (const g of list) {
    if (!g || !whole(g.itemId) || !whole(g.count)) return null;
    out.push({ itemId: g.itemId, count: g.count });
  }
  return out;
}

interface Candidate { id: number; itemId: number; reagents: { itemId: number; count: number }[]; min: number; max: number }
type Option = { kind: "buy" } | { kind: "make"; c: Candidate; mode: "floor" | "ceil" };
type MakeOption = Extract<Option, { kind: "make" }>;
interface Route {
  invalid?: false; cost: number; unpriced: Map<number, number>; buy: Map<number, number>;
  made: Map<number, { recipeId: number; crafts: number; made: number }>; leftovers: Map<number, number>; possible: Map<number, number>;
  used: Map<number, number>; need: Map<number, number>; topo: number[];
}
const INVALID = { invalid: true } as const;
type Evaluated = Route | typeof INVALID;

// a better than b: an invalid route never is; fewer unknown inputs (a strict subset) is; with the same unknown inputs
// the lower priced total is. Anything else is not comparable, and the earlier option stays.
function better(a: Evaluated, b: Evaluated): boolean {
  if (a.invalid) return false;
  if (b.invalid) return true;
  let same = true, subset = true;
  for (const [id, n] of a.unpriced) {
    const m = b.unpriced.get(id);
    if (m !== n) same = false;
    if (m === undefined || n > m) subset = false;
  }
  for (const id of b.unpriced.keys()) if (!a.unpriced.has(id)) same = false;
  if (same) return a.cost < b.cost;
  return subset;
}

const record = (map: Map<number, number>) => Object.fromEntries([...map].sort((a, b) => a[0] - b[0])) as Record<number, number>;

/**
 * Buy versus craft for the requested crafts, the addon's CraftingPlan.Resolve with the website's evidence: `catalog`
 * holds candidate recipes by ID and `makeChoices` the IDs the reader allows. An allowed recipe is a route only with a
 * fixed output and no recorded cooldown. Default strategy buy. `owned` are counts the reader typed, used once across
 * the plan; the valuation never counts them free.
 */
export function resolveCraftPlan(
  requests: readonly PlanRequest[],
  context: { quote(itemId: number): UnitQuote | null },
  catalog: ReadonlyMap<number, CatalogRecipe>,
  makeChoices: Iterable<number>,
  owned: ReadonlyMap<number, number>,
  options: { strategy?: Strategy } = {},
): CraftPlan {
  const strategy: Strategy = options.strategy === "cheapest" ? "cheapest" : "buy";
  const plan: CraftPlan = {
    strategy, purchases: [], omitted: [], steps: [], leftovers: {}, possibleLeftovers: {}, used: {}, unpriced: [], exclusions: [], limits: [],
    decisions: [], cost: null, cashCost: null, buyCost: null, complete: false, optimality: strategy === "cheapest" ? "bounded" : "buy",
  };
  const excludedOnce = new Set<string>();
  const exclude = (recipeId: number, itemId: number | null, reason: ExclusionReason) => {
    const key = `${recipeId}|${itemId}|${reason}`;
    if (excludedOnce.has(key)) return;
    excludedOnce.add(key);
    plan.exclusions.push({ recipeId, itemId, reason });
  };
  const limitedOnce = new Set<string>();
  const limit = (entry: PlanLimit, once = false) => {
    if (once) { if (limitedOnce.has(entry.kind)) return; limitedOnce.add(entry.kind); }
    plan.limits.push(entry);
  };
  const reject = (reason: NonNullable<CraftPlan["rejected"]>) => ({ ...plan, rejected: reason, cost: null, cashCost: null, buyCost: null, complete: false });

  if (!requests.length) return reject("no request");
  interface Root { recipeId: number; crafts: number; reagents: { itemId: number; count: number }[] | null }
  const roots: Root[] = [];
  const rootsById = new Map<number, Root>();
  let total = 0, rootsKnown = true;
  for (const req of requests) {
    if (!req || !whole(req.crafts)) return reject("invalid count");
    if (!whole(req.recipeId) || !req.recipe) return reject("invalid recipe");
    total += req.crafts;
    if (total > PLAN_LIMITS.crafts) return reject("crafts");
    let root = rootsById.get(req.recipeId);
    if (!root) {
      root = { recipeId: req.recipeId, crafts: 0, reagents: reagentList(req.recipe.reagents) };
      if (!root.reagents) { exclude(req.recipeId, req.recipe.itemId, "reagents"); rootsKnown = false; }
      rootsById.set(req.recipeId, root);
      roots.push(root);
    }
    root.crafts += req.crafts;
  }
  const rootNeed = new Map<number, number>();
  for (const root of roots) for (const g of root.reagents ?? []) rootNeed.set(g.itemId, (rootNeed.get(g.itemId) ?? 0) + g.count * root.crafts);
  const rootItems = [...rootNeed.keys()].sort((a, b) => a - b);

  // Candidate routes: the allowed catalog recipes, by the item they make, lowest recipe ID first.
  const allowed = new Set(makeChoices);
  const outputs = new Map<number, CatalogRecipe[]>();
  for (const id of allowed) {
    const r = catalog.get(id);
    if (!r || !whole(r.recipeId) || !whole(r.itemId)) continue;
    outputs.set(r.itemId, [...(outputs.get(r.itemId) ?? []), r]);
  }
  for (const list of outputs.values()) list.sort((a, b) => a.recipeId - b.recipeId);

  const order: number[] = [];
  const choices = new Map<number, Option[]>();
  const candidates: Candidate[] = [];
  if (strategy === "cheapest") {
    const level = new Map<number, number>();
    const queue: number[] = [];
    let count = 0;
    for (const item of rootItems) { level.set(item, 1); queue.push(item); }
    for (let head = 0; head < queue.length; head++) {
      const item = queue[head];
      order.push(item);
      const opts: Option[] = [{ kind: "buy" }];
      for (const r of outputs.get(item) ?? []) {
        let reason: ExclusionReason | null = null;
        const reagents = reagentList(r.reagents);
        if (!(whole(r.minimum) && whole(r.maximum) && r.minimum <= r.maximum)) reason = "output";
        else if (!reagents) reason = "reagents";
        else {
          if (reagents.some((g) => g.itemId === item)) reason = "cycle";
          if (!reason && r.cooldownMs !== null) reason = "cooldown";
        }
        if (reason) exclude(r.recipeId, item, reason);
        else if (level.get(item)! > PLAN_LIMITS.depth) limit({ kind: "depth", itemId: item, depth: level.get(item)! }, true);
        else if (count >= PLAN_LIMITS.recipes) limit({ kind: "recipes", limit: PLAN_LIMITS.recipes }, true);
        else {
          count += 1;
          const c: Candidate = { id: r.recipeId, itemId: item, reagents: reagents!, min: r.minimum!, max: r.maximum! };
          candidates.push(c);
          opts.push({ kind: "make", c, mode: "floor" }, { kind: "make", c, mode: "ceil" });
          for (const g of reagents!) if (!level.has(g.itemId)) { level.set(g.itemId, level.get(item)! + 1); queue.push(g.itemId); }
        }
      }
      choices.set(item, opts);
    }
    // A recipe whose reagents can lead back to its own product is named. It is still used where a purchase breaks the
    // loop; a route that actually loops is never valid.
    const byItem = new Map<number, Candidate[]>();
    for (const c of candidates) byItem.set(c.itemId, [...(byItem.get(c.itemId) ?? []), c]);
    for (const c of candidates) {
      const seen = new Set<number>();
      const stack = c.reagents.map((g) => g.itemId);
      let loops = false;
      while (stack.length && !loops) {
        const item = stack.pop()!;
        if (item === c.itemId) loops = true;
        else if (!seen.has(item)) {
          seen.add(item);
          for (const d of byItem.get(item) ?? []) for (const g of d.reagents) stack.push(g.itemId);
        }
      }
      if (loops) exclude(c.id, c.itemId, "cycle");
    }
  }

  const quoteCache = new Map<number, UnitQuote | null>();
  const quote = (id: number) => {
    if (!quoteCache.has(id)) quoteCache.set(id, context.quote(id));
    return quoteCache.get(id)!;
  };

  // One route's quantities and prices: parents before reagents, so every need is summed before it is rounded.
  const evaluate = (choice: Map<number, MakeOption>, stock: ReadonlyMap<number, number>): Evaluated => {
    const state = new Map<number, 1 | 2>();
    const topo: number[] = [];
    let cyclic = false;
    const visit = (item: number) => {
      if (state.get(item) === 2 || cyclic) return;
      if (state.get(item) === 1) { cyclic = true; return; }
      state.set(item, 1);
      const opt = choice.get(item);
      if (opt) for (const g of opt.c.reagents) visit(g.itemId);
      state.set(item, 2);
      topo.push(item);
    };
    for (const item of rootItems) visit(item);
    if (cyclic) return INVALID;
    const res: Route = { cost: 0, unpriced: new Map(), buy: new Map(), made: new Map(), leftovers: new Map(), possible: new Map(), used: new Map(), need: new Map(rootNeed), topo };
    const level = new Map<number, number>(rootItems.map((i) => [i, 1]));
    const have = new Map(stock);
    for (let i = topo.length - 1; i >= 0; i--) {
      const item = topo[i];
      const n = res.need.get(item) ?? 0;
      if (n <= 0) continue;
      const use = Math.min(n, have.get(item) ?? 0);
      if (use > 0) { have.set(item, have.get(item)! - use); res.used.set(item, use); }
      const net = n - use;
      const opt = choice.get(item);
      let remainder = net;
      if (opt && net > 0) {
        if ((level.get(item) ?? 0) > PLAN_LIMITS.depth) return INVALID;
        const c = opt.c;
        const k = Math.max(0, opt.mode === "ceil" ? Math.ceil(net / c.min) : Math.floor(net / c.min));
        if (k > 0) {
          remainder = Math.max(0, net - k * c.min);
          const consumed = net - remainder;
          res.made.set(item, { recipeId: c.id, crafts: k, made: consumed });
          if (k * c.min > consumed) res.leftovers.set(item, k * c.min - consumed);
          if (k * c.max > consumed) res.possible.set(item, k * c.max - consumed);
          for (const g of c.reagents) {
            res.need.set(g.itemId, (res.need.get(g.itemId) ?? 0) + g.count * k);
            level.set(g.itemId, Math.max(level.get(g.itemId) ?? 0, (level.get(item) ?? 0) + 1));
          }
        }
      }
      if (remainder > 0) {
        res.buy.set(item, remainder);
        const q = quote(item);
        if (q) res.cost += q.unit * remainder;
        else res.unpriced.set(item, remainder);
      }
    }
    return res;
  };
  const priced = (res: Evaluated) => !res.invalid && res.unpriced.size === 0 && rootsKnown;

  let choice = new Map<number, MakeOption>();
  const allBuy = evaluate(choice, new Map());
  let current = allBuy;
  if (strategy === "cheapest") {
    // Seed: a per-unit estimate that ignores whole batches, only a starting point for the whole-plan comparisons.
    const unit = new Map<number, number | false>();
    const estimate = (item: number, depth: number, path: Set<number>): number | null => {
      const memo = unit.get(item);
      if (memo !== undefined) return memo === false ? null : memo;
      const q = quote(item);
      let best: number | null = q ? q.unit : null;
      let pick: MakeOption | null = null;
      path.add(item);
      for (const opt of depth <= PLAN_LIMITS.depth ? choices.get(item) ?? [] : []) {
        if (opt.kind === "make" && opt.mode === "ceil") {
          let sum: number | null = 0;
          for (const g of opt.c.reagents) {
            const u = !path.has(g.itemId) ? estimate(g.itemId, depth + 1, path) : null;
            if (u === null) { sum = null; break; }
            sum += u * g.count;
          }
          if (sum !== null && (best === null || sum / opt.c.min < best)) { best = sum / opt.c.min; pick = opt; }
        }
      }
      path.delete(item);
      unit.set(item, best ?? false);
      if (pick) choice.set(item, pick);
      return best;
    };
    for (const item of rootItems) estimate(item, 1, new Set());
    current = evaluate(choice, new Map());
    if (current.invalid || !better(current, allBuy)) { choice = new Map(); current = allBuy; }
    const tie = (a: Evaluated, b: Evaluated) => !a.invalid && !b.invalid && !better(a, b) && !better(b, a) && a.cost === b.cost;
    let changed = true, passes = 0;
    while (changed && passes < PLAN_LIMITS.passes) {
      changed = false; passes += 1;
      for (const item of order) {
        const opts = choices.get(item)!;
        if (opts.length > 1 && !current.invalid && (current.need.get(item) ?? 0) > 0) {
          const before = choice.get(item) ?? null;
          let bestOpt = before, bestRes: Evaluated = current;
          for (const opt of opts) {
            const candidate = opt.kind === "make" ? opt : null;
            if (candidate === before) continue;
            if (candidate) choice.set(item, candidate); else choice.delete(item);
            const res = evaluate(choice, new Map());
            // Buy wins an exact tie; between make routes, the lower recipe ID.
            if (better(res, bestRes) || (tie(res, bestRes) && (!candidate || (bestOpt && candidate.c.id < bestOpt.c.id)))) {
              bestOpt = candidate; bestRes = res;
            }
          }
          if (bestOpt) choice.set(item, bestOpt); else choice.delete(item);
          if (bestOpt !== before) changed = true;
          current = bestRes;
        }
      }
    }
    if (changed) limit({ kind: "passes", limit: PLAN_LIMITS.passes }, true);
  }

  let valued = evaluate(choice, new Map());
  if (valued.invalid) { choice = new Map(); valued = allBuy; }
  const stock = new Map<number, number>();
  for (const [id, n] of owned) if (whole(id) && whole(n)) stock.set(id, n);
  const shopEval = stock.size ? evaluate(choice, stock) : valued;
  const shop = (shopEval.invalid ? valued : shopEval) as Route;
  const value = valued as Route;

  plan.cost = priced(value) ? value.cost : null;
  plan.cashCost = priced(shop) ? shop.cost : null;
  plan.buyCost = priced(allBuy) ? (allBuy as Route).cost : null;
  for (const id of [...shop.buy.keys()].sort((a, b) => a - b)) {
    const q = quote(id);
    const entry = { itemId: id, count: shop.buy.get(id)!, unit: q ? q.unit : null, vendor: Boolean(q?.vendor) };
    if (plan.purchases.length < PLAN_LIMITS.purchases) plan.purchases.push(entry); else plan.omitted.push(entry);
    if (!q) plan.unpriced.push({ itemId: id, count: entry.count });
  }
  if (plan.omitted.length) limit({ kind: "purchases", limit: PLAN_LIMITS.purchases, omitted: plan.omitted.length });
  const stepAt = new Map<number, { recipeId: number; crafts: number }>();
  for (const item of shop.topo) {
    const made = shop.made.get(item);
    if (made) { const step = { recipeId: made.recipeId, crafts: made.crafts }; plan.steps.push(step); stepAt.set(made.recipeId, step); }
  }
  for (const root of roots) {
    const step = stepAt.get(root.recipeId);
    if (step) step.crafts += root.crafts; else plan.steps.push({ recipeId: root.recipeId, crafts: root.crafts });
  }
  plan.leftovers = record(shop.leftovers);
  plan.possibleLeftovers = record(shop.possible);
  plan.used = record(shop.used);
  for (let i = value.topo.length - 1; i >= 0; i--) {
    const item = value.topo[i];
    const need = value.need.get(item) ?? 0;
    if (need <= 0) continue;
    const made = value.made.get(item);
    plan.decisions.push({ itemId: item, need, made: made?.made ?? 0, bought: value.buy.get(item) ?? 0, recipeId: made?.recipeId ?? null,
      crafts: made?.crafts ?? 0, unpriced: value.unpriced.has(item) });
  }
  plan.complete = plan.cost !== null && plan.cashCost !== null && plan.omitted.length === 0;
  return plan;
}

/** Sale, cut and profit for `crafts` crafts against a plan's material cost (already for every craft). */
export function planSale(estimate: CraftEstimate, crafts: number, cost: number | null): { gross: number; cut: number; profit: number | null } | null {
  const vendor = estimate.destination === "vendor";
  const unit = vendor ? estimate.vendorValue : estimate.value;
  if (unit === null || estimate.yield === null) return null;
  const s = sale(unit, estimate.yield, crafts, estimate.cutPercent, vendor);
  return { gross: s.gross, cut: s.cut, profit: cost === null ? null : s.net - cost };
}

/**
 * The catalog recipes that could make a plan's materials, breadth-first from the root's reagents through every
 * producing recipe in `byItem` (any profession: catalog planning is hypothetical), within the planner's depth and
 * recipe bounds. Recipes are in item, then recipe ID order.
 */
export function catalogTree(rootReagents: readonly { itemId: number }[], byItem: ReadonlyMap<number, readonly CatalogRecipe[]>, rootRecipeId?: number): { recipes: CatalogRecipe[]; items: number[]; truncated: boolean } {
  const level = new Map<number, number>();
  const queue: number[] = [];
  for (const g of rootReagents) if (!level.has(g.itemId)) { level.set(g.itemId, 1); queue.push(g.itemId); }
  const recipes: CatalogRecipe[] = [];
  let truncated = false;
  for (let head = 0; head < queue.length; head++) {
    const item = queue[head];
    if (level.get(item)! > PLAN_LIMITS.depth) { truncated = true; continue; }
    for (const r of [...(byItem.get(item) ?? [])].sort((a, b) => a.recipeId - b.recipeId)) {
      if (r.recipeId === rootRecipeId) continue;
      if (recipes.length >= PLAN_LIMITS.recipes) { truncated = true; break; }
      recipes.push(r);
      for (const g of r.reagents) if (!level.has(g.itemId)) { level.set(g.itemId, level.get(item)! + 1); queue.push(g.itemId); }
    }
  }
  return { recipes, items: queue, truncated };
}

/** Why a catalog recipe cannot be a make route on the website, or null when it can. */
export function routeBlock(r: CatalogRecipe): "output" | "cooldown" | null {
  if (!(whole(r.minimum) && whole(r.maximum) && r.minimum <= r.maximum)) return "output";
  if (r.cooldownMs !== null) return "cooldown";
  return null;
}

// Share links ----------------------------------------------------------------------------------------------------

/** Bounds for share links (web-crafting-qa-rulings.md). */
export const SHARE_LIMITS = { crafts: 9999, make: 64, have: 128, owned: 1_000_000, encoded: 8192 } as const;
export const SHARE_KEYS = ["recipe", "crafts", "realm", "house", "dest", "strategy", "make", "have"] as const;
type ShareKey = (typeof SHARE_KEYS)[number];

export interface CraftShareState {
  recipe: number | null;
  crafts: number;
  /** A realm slug as written; whether it is a realm with market data is the page's to check. */
  realm: string | null;
  house: AuctionHouse | null;
  destination: Destination;
  strategy: Strategy;
  /** Allowed catalog recipe IDs, ascending. */
  make: number[];
  /** Typed owned counts by item ID, ascending item IDs, counts 1..1,000,000. */
  have: [number, number][];
}
export interface ShareIssue { field: ShareKey; message: string }

export const DEFAULT_SHARE: CraftShareState = { recipe: null, crafts: 1, realm: null, house: null, destination: "ah", strategy: "buy", make: [], have: [] };

const DIGITS = /^[1-9]\d*$/;
const id = (raw: string) => (DIGITS.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null);

function idList(raw: string, max: number, what: string): { ids: number[] } | { message: string } {
  if (raw === "") return { ids: [] };
  const parts = raw.split(",");
  if (parts.length > max) return { message: `more than ${max} ${what}` };
  const ids = parts.map(id);
  if (ids.some((x) => x === null)) return { message: `not a list of ${what}` };
  if (new Set(ids).size !== ids.length) return { message: `a ${what.replace(/s$/, "")} is listed twice` };
  return { ids: (ids as number[]).sort((a, b) => a - b) };
}

/**
 * The plan state a link carries, validated field by field. A repeated key, a malformed value or an over-limit list
 * invalidates that field only: it falls back to its default and is explained, and the other fields stand.
 */
export function parseCraftShare(search: Record<string, string | string[] | undefined>): { state: CraftShareState; issues: ShareIssue[] } {
  const state: CraftShareState = { ...DEFAULT_SHARE, make: [], have: [] };
  const issues: ShareIssue[] = [];
  const read = (key: ShareKey): string | null => {
    const v = search[key];
    if (v === undefined) return null;
    if (Array.isArray(v)) {
      if (v.length === 1) return v[0];
      issues.push({ field: key, message: `${key} appears more than once in the link, so it was ignored.` });
      return null;
    }
    return v;
  };
  const recipe = read("recipe");
  if (recipe !== null) {
    const n = id(recipe);
    if (n === null) issues.push({ field: "recipe", message: "The recipe in the link is not a recipe ID." }); else state.recipe = n;
  }
  const crafts = read("crafts");
  if (crafts !== null) {
    if (/^[1-9]\d{0,3}$/.test(crafts)) state.crafts = Number(crafts);
    else issues.push({ field: "crafts", message: `Crafts in the link must be a whole number from 1 to ${SHARE_LIMITS.crafts.toLocaleString("en-US")}; using 1.` });
  }
  const realm = read("realm");
  if (realm !== null && realm !== "") {
    const slug = slugParam(realm);
    if (slug) state.realm = slug; else issues.push({ field: "realm", message: "The realm in the link is not a realm name." });
  }
  const house = read("house");
  if (house !== null && house !== "") {
    const h = houseParam(house);
    if (h) state.house = h; else issues.push({ field: "house", message: "The auction house in the link must be alliance, horde or neutral." });
  }
  const dest = read("dest");
  if (dest !== null) {
    if (dest === "ah" || dest === "vendor") state.destination = dest;
    else issues.push({ field: "dest", message: "The sale destination in the link must be ah or vendor; using the auction house." });
  }
  const strategy = read("strategy");
  if (strategy !== null) {
    if (strategy === "buy" || strategy === "cheapest") state.strategy = strategy;
    else issues.push({ field: "strategy", message: "The route in the link must be buy or cheapest; using buy." });
  }
  const make = read("make");
  if (make !== null) {
    const got = idList(make, SHARE_LIMITS.make, "recipe IDs");
    if ("ids" in got) state.make = got.ids;
    else issues.push({ field: "make", message: `The make choices in the link were ignored: ${got.message} (at most ${SHARE_LIMITS.make}).` });
  }
  const have = read("have");
  if (have !== null && have !== "") {
    const parts = have.split(",");
    const pairs = parts.map((p) => /^([1-9]\d*):(\d+)$/.exec(p));
    const why = parts.length > SHARE_LIMITS.have ? `more than ${SHARE_LIMITS.have} items`
      : pairs.some((m) => !m || !Number.isSafeInteger(Number(m[1])) || m[2].length > 7 || Number(m[2]) > SHARE_LIMITS.owned) ? "an entry is not item:count with a count up to 1,000,000"
      : new Set(pairs.map((m) => m![1])).size !== pairs.length ? "an item is listed twice" : null;
    if (why) issues.push({ field: "have", message: `The owned counts in the link were ignored: ${why}.` });
    else state.have = pairs.map((m): [number, number] => [Number(m![1]), Number(m![2])]).filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]);
  }
  return { state, issues };
}

/** The canonical query pairs for a state: defaults left out, lists ascending. */
export function shareEntries(state: CraftShareState): [ShareKey, string][] {
  const out: [ShareKey, string][] = [];
  if (state.recipe !== null) out.push(["recipe", String(state.recipe)]);
  if (state.crafts !== 1) out.push(["crafts", String(state.crafts)]);
  if (state.realm) out.push(["realm", state.realm]);
  if (state.house) out.push(["house", state.house.toLowerCase()]);
  if (state.destination !== "ah") out.push(["dest", state.destination]);
  if (state.strategy !== "buy") out.push(["strategy", state.strategy]);
  if (state.make.length) out.push(["make", [...state.make].sort((a, b) => a - b).join(",")]);
  const have = state.have.filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]);
  if (have.length) out.push(["have", have.map(([i, n]) => `${i}:${n}`).join(",")]);
  return out;
}

/**
 * A URL's search with the plan's keys replaced by the state's canonical ones; other parameters (the recipe list's
 * page, size and filters) stay as they were. Null when the plan's part would pass the share size limit.
 */
export function shareSearch(current: URLSearchParams, state: CraftShareState): string | null {
  const params = new URLSearchParams();
  for (const [k, v] of current) if (!(SHARE_KEYS as readonly string[]).includes(k)) params.append(k, v);
  // A list over its bound would be thrown out whole by parseCraftShare: never write one.
  if (state.make.length > SHARE_LIMITS.make || state.have.filter(([, n]) => n > 0).length > SHARE_LIMITS.have) return null;
  const own = new URLSearchParams(shareEntries(state)).toString();
  if (own.length > SHARE_LIMITS.encoded) return null;
  const rest = params.toString();
  return [rest, own].filter(Boolean).join("&");
}
