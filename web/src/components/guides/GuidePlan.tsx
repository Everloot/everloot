import { CopyButton, SectionHeading } from "@/components/ui";
import type { GuideSet } from "@/lib/guide-freshness";
import { absoluteUrl } from "@/lib/seo";
import { planHash } from "@/lib/talents/import";
import { orderSteps } from "@/lib/talents/order";
import { entryAtRank, forSet, levelFor, nodeMap, pointsSpent } from "@/lib/talents/rules";
import { buildTitle, summarizeBuild } from "@/lib/talents/summary";
import type { Ranks, TalentCatalog } from "@/lib/talents/types";

// A guide's plan: each talent set as the calculator opens it from the guide's link, its spend order labelled planned
// or unknown, and the two ways on from the page. The calculator link carries both sets exactly as the guide stores
// them; Copy for addon copies one set, for the addon's Import. Nothing here re-encodes a code or re-stamps a build.
// Why a set no longer fits is the freshness note's to say, above the plan.

/** The calculator with both sets as the guide stores them: their codes and order tokens, byte for byte. */
export function guideCalculatorHref(classSlug: string, sets: GuideSet[]): string {
  const [one, two] = sets;
  return `/tools/talents/${classSlug}${planHash(one?.code ?? null, two?.code ?? null, one?.order, two?.order)}`;
}

/** Copy for addon's link for one set: the full class calculator address with only that set's pair, plan= and order=
 *  for set 1, plan2= and order2= for set 2, which the addon's Import reads as that set. Null for a set the guide does
 *  not have, one that no longer fits the tree, and one with a provisional order: a guide hands on only a planned one. */
export function guideAddonLink(classSlug: string, set: GuideSet | undefined): string | null {
  if (!set || set.problems.length > 0 || set.plan?.orderOrigin === "provisional") return null;
  const hash = set.set === 1 ? planHash(set.code, null, set.order) : planHash(null, set.code, null, set.order);
  return absoluteUrl(`/tools/talents/${classSlug}${hash}`);
}

const ORDER_LABEL = {
  planned: ["Planned order.", "The points in the order they were spent in the calculator. A plan, not a record of play."],
  provisional: ["Provisional order.", "Made by the calculator when asked, not planned, so a guide is not published with it."],
  none: ["Spend order unknown.", "The guide gives this set's talents without an order to take them in, so none is shown and none is guessed."],
  lost: ["Spend order unknown.", "The order the guide carries does not fit this tree, so none is shown and none is guessed."],
} as const;

function orderLabel(set: GuideSet): readonly [string, string] {
  if (set.plan?.order && set.plan.orderOrigin) return ORDER_LABEL[set.plan.orderOrigin];
  return set.order ? ORDER_LABEL.lost : ORDER_LABEL.none;
}

/** The talent a node's `rank`-th point buys: a choice node's chosen entry, a tiered node's entry at that rank. */
function pointName(catalog: TalentCatalog, ranks: Ranks, id: number, rank: number): string {
  const node = nodeMap(catalog).get(id);
  if (!node) return `Node ${id}, rank ${rank}`;
  const entry = node.kind === "choice" ? node.entries[ranks[id]?.choice ?? 0] ?? node.entries[0] : entryAtRank(node, rank - 1);
  return `${entry.name}, rank ${rank}`;
}

function SetPlan({ catalog, set, copy }: { catalog: TalentCatalog; set: GuideSet; copy: string | null }) {
  const plan = set.plan;
  const points = plan ? pointsSpent(plan.ranks) : 0;
  const summary = plan && points > 0 ? summarizeBuild(catalog, plan.ranks) : null;
  // The levels the set's points come at, as the calculator lists them: the second set's wait for the level it opens at.
  const schedule = forSet(catalog, set.set === 1 ? 0 : 1);
  const steps = plan ? orderSteps(schedule, plan) : null;
  const [label, about] = orderLabel(set);
  const [lead, ...rest] = set.stale ? [] : set.changes;
  return (
    <div data-guide-set={set.set} className="space-y-2 rounded-card border border-line bg-panel p-4 text-sm text-fg-2">
      <h3 className="text-base font-semibold text-fg">Set {set.set}{summary ? `: ${buildTitle(catalog, summary)}` : ""}</h3>
      {plan
        ? <p>{set.set === 1 ? `${points} talent points, the last at level ${levelFor(schedule, points)}.` : `${points} talent points. The second set opens at level ${levelFor(schedule, 1)}.`}</p>
        : <p>This set&apos;s code does not load on this tree.</p>}
      <p><span className="font-semibold text-fg">{label}</span> {about}</p>
      {plan && steps && steps.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-3 hover:text-fg">All {steps.length} points in order</summary>
          <ol className="list-decimal space-y-1 pl-6">
            {steps.map((s, i) => <li key={i}>Level {s.level}: {pointName(catalog, plan.ranks, s.id, s.rank)}</li>)}
          </ol>
        </details>
      )}
      {/* What the change records say since the plan was made, when the freshness note above has not said it already. */}
      {lead && (
        <div data-guide-changes className="space-y-1">
          <p className="text-fg">{lead}</p>
          {rest.length > 0 && <ul className="list-disc space-y-1 pl-5">{rest.map((line, i) => <li key={i}>{line}</li>)}</ul>}
        </div>
      )}
      {copy
        ? <CopyButton className="btn text-sm" text={copy} label={`Copy set ${set.set} for addon`} failedLabel="Copy failed" />
        : <p>Copy for addon is off for set {set.set} until the guide is reviewed again; the note above says why.</p>}
    </div>
  );
}

export default function GuidePlan({ classSlug, catalog, sets }: { classSlug: string; catalog: TalentCatalog; sets: GuideSet[] }) {
  const copies = sets.map((s) => guideAddonLink(classSlug, s));
  const both = sets.length > 1;
  return (
    <section aria-labelledby="plan" className="mt-8 space-y-4">
      <SectionHeading id="plan">The plan</SectionHeading>
      {sets.map((s, i) => <SetPlan key={s.set} catalog={catalog} set={s} copy={copies[i]} />)}
      <div className="flex flex-wrap items-center gap-3">
        <a className="btn text-sm" href={guideCalculatorHref(classSlug, sets)}>Open in the calculator</a>
        <p className="text-sm text-fg-2">{both ? "Both sets open" : "The set opens"} in the talent calculator as this guide stores {both ? "them" : "it"}.</p>
      </div>
      {copies.some(Boolean) && (
        <p className="text-sm text-fg-2">
          Copy for addon copies one set as a link. In the game: <code>/everloot</code> → Talents → paste → Import. Addon 0.3.12 loads the
          talents from the link but not the spend order, so spend each point yourself.
        </p>
      )}
    </section>
  );
}
