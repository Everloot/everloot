import { adoptOrder, orderRefusalText, validateOrder } from "./order";
import { levelFor, pointsSpent } from "./rules";
import { ORDER_LIMIT, decodeBuild, decodeOrder, resolveBuild, type DecodeError, type OrderError, type OrderOrigin } from "./share";
import type { PlanSet, Ranks, TalentCatalog } from "./types";

// What the page does with text a visitor pastes or opens: a bare share code, or a whole link that
// carries one after `#plan=`. Returns plain-English lines for everything that did not load as asked.
// importCode reads the talents and the order token; importPlan, the calculator's, adds the tree's check
// of the order (order.ts) and returns the set to put on screen.

export interface ImportReport {
  /** The game build the code was made on, and the one on screen. */
  codeBuild: string;
  treeBuild: string;
  /** Problems, one sentence each. Empty means the code loaded exactly as made. */
  problems: string[];
}

/** The spend order that came with a code: known, with who made it, or unknown and why. Known only
 *  means the token's points match the talents that loaded; whether each point could be spent at its
 *  place in the order is a separate check against the tree's rules. */
export type ImportedOrder =
  | { known: true; origin: OrderOrigin; order: number[] }
  | { known: false; reason: OrderError | "not-placed" };

export type ImportResult =
  | { ok: true; ranks: Ranks; minLevel: number; report: ImportReport; order?: ImportedOrder }
  | { ok: false; message: string };

export const DECODE_MESSAGES: Record<DecodeError, string> = {
  empty: "Paste a share code or a link first.",
  "not-base64url": "That is not a share code. Codes start with EL1 and use letters, digits, - and _ only.",
  malformed: "That share code is damaged or cut short.",
  "newer-version": "That code was made by a newer version of this tool. Reload the page, and if it still fails, ask the person who shared it to share it again.",
};

const ORDER_MESSAGES: Record<OrderError | "not-placed", string> = {
  malformed: "The plan's spend order is damaged, so the order is unknown. The talents still loaded.",
  "newer-version": "The plan's spend order was made by a newer version of this tool, so the order is unknown. Reload the page, and if it is still unknown, ask the person who shared it to share it again. The talents still loaded.",
  "unsupported-mode": "The plan's spend order is of a kind this tool does not read, so the order is unknown. The talents still loaded.",
  "over-limit": `The plan's spend order is for more than ${ORDER_LIMIT} points, the most an order carries, so the order is unknown. The talents still loaded.`,
  "extra-points": "The plan's spend order lists points the code does not have, so the order is unknown. The talents still loaded.",
  "missing-points": "The plan's spend order leaves out points the code has, so the order is unknown. The talents still loaded.",
  "not-placed": "Not every point in the code placed on this tree, so the plan's spend order is unknown.",
};

/** What a page address carries for each set: its share code and the spend order that rides with it.
 *  Links made before orders have none; a caller building one by hand may leave the orders out. */
export interface PlanHash {
  first: string | null;
  second: string | null;
  firstOrder?: string | null;
  secondOrder?: string | null;
}

/** The share codes a page address carries: the first set after #plan=, the second after &plan2=, and
 *  their spend orders after &order= and &order2=. */
export function readPlanHash(hash: string): PlanHash {
  return {
    first: /[#&]plan=([A-Za-z0-9_.-]+)/.exec(hash)?.[1] ?? null,
    second: /[#&]plan2=([A-Za-z0-9_.-]+)/.exec(hash)?.[1] ?? null,
    firstOrder: /[#&]order=([A-Za-z0-9_.-]+)/.exec(hash)?.[1] ?? null,
    secondOrder: /[#&]order2=([A-Za-z0-9_.-]+)/.exec(hash)?.[1] ?? null,
  };
}

/** The address fragment that carries both sets; empty when neither has a point. A set's spend order
 *  rides after both codes, so a reader that stops at & still finds the codes where they always were. */
export function planHash(first: string | null, second: string | null, firstOrder?: string | null, secondOrder?: string | null): string {
  const parts = [
    first && `plan=${first}`, second && `plan2=${second}`,
    first && firstOrder && `order=${firstOrder}`, second && secondOrder && `order2=${secondOrder}`,
  ].filter(Boolean);
  return parts.length ? `#${parts.join("&")}` : "";
}

const PLAN_PART = /^(?:plan|plan2|order|order2)=/;

/** `hash` with its plan parts (plan, plan2, order, order2) swapped for those of `plan`, a planHash, which go
 *  first. Every other part, such as a cookie choice kept in the address, stays after them as it was. */
export function replacePlanHash(hash: string, plan: string): string {
  const others = hash.replace(/^#/, "").split("&").filter((part) => part && !PLAN_PART.test(part));
  const parts = [...(plan ? [plan.slice(1)] : []), ...others];
  return parts.length ? `#${parts.join("&")}` : "";
}

export function extractCode(text: string): string {
  const fromLink = /[#&?]plan=([A-Za-z0-9_.-]+)/.exec(text);
  return fromLink ? fromLink[1] : text.trim();
}

/** `orderToken` is the spend order that came with the code (readPlanHash). An order that cannot be
 *  used never stops the talents loading: they load, and the report says the order is unknown. */
export function importCode(catalog: TalentCatalog, text: string, orderToken?: string | null): ImportResult {
  const decoded = decodeBuild(extractCode(text));
  if (!decoded.ok) return { ok: false, message: DECODE_MESSAGES[decoded.error] };
  const resolved = resolveBuild(catalog, decoded.build);
  if (!resolved.ok) {
    return { ok: false, message: `That code is for a different class. Open this class's calculator to load it.` };
  }
  const { ranks, unknown, clamped, rejected, buildDiffers } = resolved.build;
  const problems: string[] = [];
  if (buildDiffers) {
    problems.push(`Made on game build ${decoded.build.build}; this tree is from build ${catalog.build}. Check each talent.`);
  }
  if (unknown.length > 0) {
    const ids = unknown.map((u) => `${u.id} (${u.rank} ${u.rank === 1 ? "point" : "points"})`).join(", ");
    problems.push(`${unknown.length} ${unknown.length === 1 ? "talent in the code is" : "talents in the code are"} not in this tree and ${unknown.length === 1 ? "was" : "were"} left out: node ${ids}.`);
  }
  for (const c of clamped) {
    problems.push(c.what === "rank"
      ? `${c.name}: the code asked for rank ${c.asked}, but the most this tree allows is ${c.got}.`
      : `${c.name}: the code picked a choice this tree does not have, so the first choice is used.`);
  }
  for (const r of rejected) {
    problems.push(`${r.name}: ${r.rank} ${r.rank === 1 ? "point" : "points"} not placed. ${r.why}`);
  }
  const order = orderToken ? importedOrder(orderToken, decoded.build.ranks, ranks) : undefined;
  if (order && !order.known) problems.push(ORDER_MESSAGES[order.reason]);
  return {
    ok: true,
    ranks,
    minLevel: levelFor(catalog, pointsSpent(ranks)),
    report: { codeBuild: decoded.build.build, treeBuild: catalog.build, problems },
    ...(order ? { order } : {}),
  };
}

/** The token is read against the ranks the code asked for. The order names every one of those points,
 *  so when the tree on screen did not take them all, it no longer fits. */
function importedOrder(token: string, asked: Ranks, placed: Ranks): ImportedOrder {
  const decoded = decodeOrder(token, asked);
  if (!decoded.ok) return { known: false, reason: decoded.error };
  if (pointsSpent(placed) < pointsSpent(asked)) return { known: false, reason: "not-placed" };
  return { known: true, origin: decoded.origin, order: decoded.order };
}

/** A set as it loaded: its ranks, and its order only when the token reads and every point of it could be taken
 *  where it stands on this tree. `requested` is what the code asked for, before the tree placed it; `token` is the
 *  order token that came with the code, as it came. */
export type PlanImport =
  | { ok: true; set: PlanSet; requested: Ranks; token: string | null; minLevel: number; report: ImportReport }
  | { ok: false; message: string };

/** `text` is a share code, or a link whose fragment carries one set's code and order: the first set's after
 *  #plan= and &order=, or the second's after #plan2= and &order2= when the link has only that one (Copy for
 *  addon's set two). With `orderToken` given, even as null, `text` is a code and that is its order. Like
 *  importCode, an order that cannot be used never stops the talents loading: the set's order is unknown. */
export function importPlan(catalog: TalentCatalog, text: string, orderToken?: string | null): PlanImport {
  const [code, token] = orderToken === undefined ? linkPair(text) : [text, orderToken];
  const result = importCode(catalog, code, token);
  if (!result.ok) return result;
  const decoded = decodeBuild(extractCode(code));
  const requested = decoded.ok ? decoded.build.ranks : result.ranks;
  const known = result.order?.known ? result.order : null;
  const set = adoptOrder(catalog, result.ranks, known && known.order, known && known.origin);
  const problems = [...result.report.problems];
  if (known && !set.order) {
    const verdict = validateOrder(catalog, result.ranks, known.order);
    const where = verdict.ok ? "" : ` ${orderRefusalText(catalog, result.ranks, known.order, verdict)}`;
    problems.push(`The plan's spend order breaks this tree's rules, so the order is unknown.${where} The talents still loaded.`);
  }
  return { ok: true, set, requested, token, minLevel: result.minLevel, report: { ...result.report, problems } };
}

/** The code and order a pasted text names: one set's pair from a link's fragment, or the text as a code. */
function linkPair(text: string): [string, string | null] {
  if (!/[#&]plan2?=/.test(text)) return [text, null];
  const hash = readPlanHash(text);
  if (hash.first) return [hash.first, hash.firstOrder ?? null];
  return [hash.second ?? text, hash.secondOrder ?? null];
}
