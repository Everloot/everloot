"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Card, SectionHeading } from "@/components/ui";
import { deviceStorage, type Failure } from "@/lib/player-workspace";
import { planHash } from "@/lib/talents/import";
import { examplesHidden, hideExamples, type ExampleAlt, type ExamplePlan } from "@/lib/workspace-examples";
import type { WorkspaceIcons } from "@/lib/workspace-icons";
import { Chip, ClassIcon, ClassIconWithLevel, ClassName, ExampleTag, FactionTag, ProfessionChips, classEdge } from "./marks";

// What Plans and Alts on this device look like filled in, shown while the visitor has nothing saved and has not
// hidden it. Nothing here is stored until Copy to my device is pressed (lib/workspace-examples.ts).

/** Whether this browser has hidden a page's examples; null until storage is read, so nothing flashes on load. */
export function useExamplesShown(page: "builds" | "alts"): [boolean | null, () => void] {
  const [shown, setShown] = useState<boolean | null>(null);
  useEffect(() => setShown(!examplesHidden(deviceStorage(), page)), [page]);
  return [shown, () => { hideExamples(deviceStorage(), page); setShown(false); }];
}

/** The calculator's address for an example plan; it opens there like any plan. */
const examplePath = (plan: ExamplePlan) => `/tools/talents/${plan.classSlug}${planHash(plan.code, null)}`;

function Frame({ label, note, copyLabel, onCopy, onHide, children }: {
  label: string;
  note: string;
  copyLabel: string;
  onCopy: () => Promise<{ ok: true } | Failure>;
  onHide: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card as="section" aria-labelledby={id}>
      <SectionHeading id={id} note={note}><span className="inline-flex flex-wrap items-center gap-2">{label} <ExampleTag /></span></SectionHeading>
      {children}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary text-sm" disabled={busy} onClick={async () => {
          setBusy(true);
          const result = await onCopy();
          setBusy(false);
          setError(result.ok ? null : result.message);
        }}>{copyLabel}</button>
        <button type="button" className="btn text-sm" onClick={onHide}>Hide examples</button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Card>
  );
}

function PlanRow({ plan, icons }: { plan: ExamplePlan; icons: WorkspaceIcons }) {
  return (
    <li className={`flex items-start gap-3 py-3 ${classEdge(plan.classSlug)}`}>
      <ClassIcon slug={plan.classSlug} icons={icons} />
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="font-semibold text-fg">{plan.name}</h3>
        </div>
        <p className="text-sm"><ClassName slug={plan.classSlug} /> <span className="text-muted">· {plan.notes}</span></p>
        <a href={examplePath(plan)} className="inline-flex min-h-8 items-center text-cell text-fg-2 hover:text-accent">Open in the calculator</a>
      </div>
    </li>
  );
}

export function ExamplePlans({ plans, icons, onCopy, onHide }: {
  plans: ExamplePlan[];
  icons: WorkspaceIcons;
  onCopy: () => Promise<{ ok: true } | Failure>;
  onHide: () => void;
}) {
  if (plans.length === 0) return null;
  return (
    <Frame label="Example plans" note="Made-up plans showing what this list looks like. They are not saved unless you copy them."
      copyLabel="Copy to my device" onCopy={onCopy} onHide={onHide}>
      <ul className="space-y-2">{plans.map((plan) => <PlanRow key={plan.key} plan={plan} icons={icons} />)}</ul>
    </Frame>
  );
}

export function ExampleAlts({ alts, plans, icons, onCopy, onHide }: {
  alts: ExampleAlt[];
  plans: ExamplePlan[];
  icons: WorkspaceIcons;
  onCopy: () => Promise<{ ok: true } | Failure>;
  onHide: () => void;
}) {
  return (
    <Frame label="Example alts" note="Made-up characters showing what this list looks like. Copying them also adds the example plans they use."
      copyLabel="Copy to my device" onCopy={onCopy} onHide={onHide}>
      <ul className="space-y-2">
        {alts.map((alt) => {
          const used = plans.filter((p) => alt.plans.includes(p.key));
          return (
            <li key={alt.name} className={`flex items-start gap-3 py-3 ${classEdge(alt.classSlug)}`}>
              <ClassIconWithLevel slug={alt.classSlug} level={alt.level} icons={icons} />
              <div className="min-w-0 space-y-2">
                <h3 className="font-semibold text-fg">{alt.name}</h3>
                <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
                  <span>{alt.realm} ·</span><ClassName slug={alt.classSlug} /><span>· Level {alt.level} ·</span><FactionTag faction={alt.faction} icons={icons} />
                </p>
                <ProfessionChips professions={alt.professions} icons={icons} />
                {used.length > 0 && (
                  <p className="flex flex-wrap gap-1.5"><span className="sr-only">Plans: </span>{used.map((p) => <Chip key={p.key} href={examplePath(p)}>{p.name}</Chip>)}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Frame>
  );
}
