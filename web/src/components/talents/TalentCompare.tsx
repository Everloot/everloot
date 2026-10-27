"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Card, CopyButton, DataTable, Field, SectionHeading } from "@/components/ui";
import {
  compareHash, comparePlans, planRef, readCompareHash, replaceCompareHash, type ComparedPlan, type Comparison, type PlanRef, type Side,
  type TalentDifference,
} from "@/lib/talents/compare";
import { codeFreshness, freshnessLines, type ClassTalentChanges } from "@/lib/talents/freshness";
import type { BuildSummary } from "@/lib/talents/summary";
import type { TalentCatalog } from "@/lib/talents/types";

// Two plans of one class side by side (lib/talents/compare.ts), read from the page address (#a=, &ao=, &b=, &bo=) or
// from the two boxes. The server cannot see the address, so the comparison starts out of the page, in the server HTML
// and the first render alike, and appears once the browser has read it. Opening a comparison writes nothing. Compare
// writes the boxes' plans into the address as they came, so a plan from an older game build keeps its code, and each
// plan says what the game files changed in its talents since that build (lib/talents/freshness.ts).

type Pair = { a: PlanRef | null; b: PlanRef | null };

const SIDES: Side[] = ["a", "b"];
const LETTER: Record<Side, string> = { a: "A", b: "B" };
const NONE = { code: "", order: null };

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const split = (s: BuildSummary) => s.trees.map((t) => `${t.name} ${t.points}`).join(" / ");
/** A talent's rank in one plan, and for a choice node the entry it picked. */
const rank = (d: TalentDifference, side: Side) => `${d[side]}/${d.maxRanks}${d.choices?.[side] ? ` · ${d.choices[side]}` : ""}`;

/** Whose plans these are, in a sentence: "plan B", "plans A and B". */
const plans = (sides: Side[]) => (sides.length === 1 ? `plan ${LETTER[sides[0]]}` : "plans A and B");

export default function TalentCompare({ catalog, changes }: {
  catalog: TalentCatalog;
  /** This class's change records (freshness.ts classTalentChanges), read on the server. */
  changes: ClassTalentChanges;
}) {
  const [pair, setPair] = useState<Pair | null>(null);
  const [text, setText] = useState<Record<Side, string>>({ a: "", b: "" });

  // Read when the page opens and whenever the address changes, so a comparison link pasted into an open tab shows.
  // An address with neither plan, such as a cookie choice alone, leaves the page as it is.
  useEffect(() => {
    const follow = () => {
      const sent = readCompareHash(window.location.hash);
      if (!sent.a && !sent.b) return;
      setPair(sent);
      setText({ a: sent.a?.code ?? "", b: sent.b?.code ?? "" });
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  const result = useMemo(() => pair && comparePlans(catalog, pair.a ?? NONE, pair.b ?? NONE), [catalog, pair]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A box still holding the code it showed keeps the order that came with it; a pasted link brings its own.
    const side = (value: string, was: PlanRef | null): PlanRef | null => {
      const ref = planRef(value);
      if (!ref.code) return null;
      return was && ref.code === was.code && ref.order === null ? was : ref;
    };
    const next = { a: side(text.a, pair?.a ?? null), b: side(text.b, pair?.b ?? null) };
    setPair(next);
    setText({ a: next.a?.code ?? "", b: next.b?.code ?? "" });
    const hash = replaceCompareHash(window.location.hash, compareHash(next.a, next.b));
    if (hash !== window.location.hash) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${hash}`);
  }

  const link = () => (pair ? `${window.location.origin}${window.location.pathname}${compareHash(pair.a, pair.b)}` : null);

  return (
    <div className="space-y-6">
      <form onSubmit={submit} aria-label="Plans to compare" className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          {SIDES.map((side) => (
            <Field
              key={side} id={`compare-${side}`} label={`Plan ${LETTER[side]}`} value={text[side]} mono
              onChange={(e) => { const value = e.target.value; setText((t) => ({ ...t, [side]: value })); }}
              placeholder={`EL1-${catalog.classSlug}-… or a calculator link`} spellCheck={false} autoComplete="off" autoCapitalize="off"
            />
          ))}
        </div>
        <p className="text-sm text-muted">
          Paste a {catalog.className} share code or calculator link into each box. The page address keeps the comparison, so it can be shared.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary">Compare</button>
          {result?.ok && <CopyButton className="btn" text={link} label="Copy link" failedLabel="Copy failed" />}
        </div>
      </form>

      <div role="status" className="space-y-1 text-sm text-fg">
        {result && !result.ok && (
          <>
            <p className="font-semibold">These plans cannot be compared.</p>{" "}
            <ul className="list-disc space-y-1 pl-5">
              {result.errors.map((e) => <li key={e.side}>{e.message}</li>)}
            </ul>
          </>
        )}
        {result?.ok && <p className="font-semibold">{headline(result.comparison)}</p>}
      </div>

      {result?.ok && <Results catalog={catalog} changes={changes} comparison={result.comparison} />}
    </div>
  );
}

function headline(c: Comparison): string {
  if (!c.same) return `${c.differences.length} ${c.differences.length === 1 ? "talent differs" : "talents differ"}.`;
  const rejected = c.a.rejected.length + c.b.rejected.length > 0 ? " Not every point loaded as its code asked: each plan says what." : "";
  const order = c.sameOrder === null
    ? " Whether they spend their points in the same order is unknown."
    : c.sameOrder ? " They spend their points in the same order." : " They spend their points in a different order: Level by level shows where.";
  return `The two plans are identical: the same talents at the same ranks.${rejected}${order}`;
}

function Results({ catalog, changes, comparison: c }: { catalog: TalentCatalog; changes: ClassTalentChanges; comparison: Comparison }) {
  const tree = (id: number) => catalog.trees.find((t) => t.id === id)?.name ?? "";
  const unknown = SIDES.filter((side) => !c[side].set.order);
  const provisional = SIDES.filter((side) => c[side].set.orderOrigin === "provisional");
  const orderNote = c.milestones === null
    ? `Level by level needs both plans' spend orders, and ${plans(unknown)} ${unknown.length === 1 ? "has" : "have"} none this page can use.`
    : provisional.length === 1
      ? `Plan ${LETTER[provisional[0]]}'s spend order is provisional, made by the calculator when asked: its levels are not a recommendation.`
      : provisional.length === 2 ? "Both plans' spend orders are provisional, made by the calculator when asked: their levels are not a recommendation." : null;

  return (
    <div data-comparison className="space-y-8">
      <div className="grid gap-4 md:grid-cols-2">
        {SIDES.map((side) => <PlanCard key={side} side={side} plan={c[side]} catalog={catalog} changes={changes} />)}
      </div>

      <section aria-labelledby="compare-trees">
        <SectionHeading id="compare-trees">Points per tree</SectionHeading>
        <DataTable
          caption="Points per tree"
          rows={[...c.splits, { tree: "All trees", a: c.a.summary.spent, b: c.b.summary.spent }]}
          rowKey={(r) => r.tree}
          columns={[
            { key: "tree", header: "Tree", cell: (r) => r.tree },
            { key: "a", header: "Plan A", cell: (r) => r.a, numeric: true },
            { key: "b", header: "Plan B", cell: (r) => r.b, numeric: true },
          ]}
        />
      </section>

      {c.differences.length > 0 && (
        <section aria-labelledby="compare-talents">
          <SectionHeading id="compare-talents">Talents that differ</SectionHeading>
          <DataTable
            caption="Talents that differ"
            rows={c.differences}
            rowKey={(d) => String(d.id)}
            columns={[
              { key: "talent", header: "Talent", cell: (d) => d.name },
              { key: "tree", header: "Tree", cell: (d) => tree(d.treeId), nowrap: true },
              { key: "a", header: "Plan A", cell: (d) => rank(d, "a"), numeric: true },
              { key: "b", header: "Plan B", cell: (d) => rank(d, "b"), numeric: true },
            ]}
          />
        </section>
      )}

      <section aria-labelledby="compare-levels" className="text-sm text-fg-2">
        <SectionHeading id="compare-levels" note="The points each plan has spent by a level, in its spend order. A plan, not a record of play.">Level by level</SectionHeading>
        {orderNote && <p data-level-order className="mb-3">{orderNote}</p>}
        {c.milestones && (
          <ol data-milestones className="space-y-4">
            {c.milestones.map((m) => (
              <li key={m.level} className="space-y-1">
                <p className="font-semibold text-fg">Level {m.level} · {plural(m.points, "point")}</p>
                <p>Plan A: {plural(m.a.spent, "point")}, {split(m.a)}. Plan B: {plural(m.b.spent, "point")}, {split(m.b)}.</p>
                {/* Closed until asked for: two different plans can differ in dozens of talents at every level. */}
                {m.differences.length > 0 ? (
                  <details>
                    <summary className="min-h-11 cursor-pointer py-3 text-fg-2 hover:text-fg">
                      {m.differences.length} {m.differences.length === 1 ? "talent differs" : "talents differ"}
                    </summary>
                    <ul className="list-disc space-y-1 pl-5">
                      {m.differences.map((d) => <li key={d.id}>{d.name}: plan A {rank(d, "a")}, plan B {rank(d, "b")}</li>)}
                    </ul>
                  </details>
                ) : <p>The same talents.</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

const ORDER_LABEL = {
  planned: "Planned spend order. A plan made in the calculator, not a record of play.",
  provisional: "Provisional spend order: made by the calculator when asked. Not a recommendation or a record of play.",
} as const;

function PlanCard({ side, plan, catalog, changes }: { side: Side; plan: ComparedPlan; catalog: TalentCatalog; changes: ClassTalentChanges }) {
  const freshness = codeFreshness(catalog, changes, plan.code);
  const [lead, ...rest] = freshness ? freshnessLines(freshness) : [];
  const { problems } = plan.report;
  const order = plan.set.order && plan.set.orderOrigin
    ? ORDER_LABEL[plan.set.orderOrigin]
    : plan.token ? "Spend order unknown." : "Spend order unknown: none came with this plan.";
  return (
    <div data-plan={side} className="min-w-0">
      <Card as="section" aria-labelledby={`compare-plan-${side}`} className="h-full space-y-3 text-sm text-fg-2">
        <h2 id={`compare-plan-${side}`} className="text-base font-semibold text-fg">Plan {LETTER[side]}</h2>
        <p className="text-fg">{plural(plan.summary.spent, "point")}, level {plan.minLevel}: {split(plan.summary)}</p>
        <p>{order}</p>
        <section aria-label="What loaded" className="space-y-1">
          <p>{problems.length === 0 ? "Loaded as made." : `Loaded, with ${plural(problems.length, "change")}.`}</p>
          {problems.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 [overflow-wrap:anywhere]">
              {problems.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          )}
        </section>
        {lead && (
          // What the game files changed since the plan's build. It only reads: the plan keeps the code it came with.
          <section aria-label="Game build changes" className="space-y-1 rounded-control border border-line bg-canvas p-3">
            <p className="font-semibold text-fg">{lead}</p>
            {rest.length > 0 && (
              <ul className="list-disc space-y-1 pl-5">
                {rest.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            )}
            <p className="font-mono text-xs text-muted">From the game build change records · {catalog.label}</p>
          </section>
        )}
      </Card>
    </div>
  );
}
