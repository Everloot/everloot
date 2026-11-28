"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CopyButton, SectionHeading } from "@/components/ui";
import type { LegacyPerkCatalog, Node } from "@kb/legacy-perks/catalog";
import { createPlanner, decodePlan, encodePlan, isPlannable, orderedPerks, perkName, treeName, type Purchase } from "./plan";

const STORAGE_KEY = "everloot.legacy-plan";
const HASH_KEY = "legacy=";
const hashParts = (hash: string) => hash.slice(1).split("&").filter(Boolean);
const action = "btn text-sm disabled:cursor-not-allowed disabled:opacity-50";
const rankButton = "btn min-h-9 min-w-9 px-0 text-base disabled:cursor-not-allowed disabled:opacity-40";

export default function LegacyPlanner({ catalog }: { catalog: LegacyPerkCatalog }) {
  const planner = useMemo(() => createPlanner(catalog), [catalog]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const [manualLink, setManualLink] = useState(false);

  const readPlan = useCallback((code: string, source: "linked" | "saved") => {
    const plan = decodePlan(code);
    if (!plan) {
      setMessage(`This ${source} Legacy plan is damaged or uses an unsupported format.`);
      return;
    }
    const result = planner.replay(plan.purchases);
    setPurchases(result.purchases);
    setImportNotes([...new Set(result.skipped)]);
    setManualLink(false);
    const loaded = `Loaded the ${source} plan`;
    const origin = plan.buildId !== catalog.build.buildId ? ` from build ${plan.buildId} using build ${catalog.build.version}` : "";
    const skipped = result.skipped.length === 1 ? "1 rank could not be restored." : `${result.skipped.length} ranks could not be restored.`;
    setMessage(`${loaded}${origin}. ${result.skipped.length ? skipped : ""}`.trim());
  }, [planner, catalog.build.buildId, catalog.build.version]);

  useEffect(() => {
    const loadLink = () => {
      const value = hashParts(window.location.hash).find((part) => part.startsWith(HASH_KEY));
      if (value) readPlan(value.slice(HASH_KEY.length), "linked");
    };
    const checkSave = () => {
      try { setSaved(window.localStorage.getItem(STORAGE_KEY) !== null); }
      catch { setSaved(false); }
    };
    loadLink();
    checkSave();
    window.addEventListener("hashchange", loadLink);
    window.addEventListener("storage", checkSave);
    return () => {
      window.removeEventListener("hashchange", loadLink);
      window.removeEventListener("storage", checkSave);
    };
  }, [readPlan]);

  const code = encodePlan(catalog.build.buildId, purchases);
  function shareURL() {
    const url = new URL(window.location.pathname, window.location.origin);
    url.hash = `${HASH_KEY}${code}`;
    return url.href;
  }

  function savePlan() {
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
      setSaved(true);
      setMessage("Plan saved in this browser.");
    } catch {
      setMessage("This browser could not save the plan.");
    }
  }

  function loadPlan() {
    try {
      const savedCode = window.localStorage.getItem(STORAGE_KEY);
      if (savedCode !== null) readPlan(savedCode, "saved");
      else {
        setSaved(false);
        setMessage("There is no saved plan in this browser.");
      }
    } catch {
      setMessage("This browser could not read the saved plan.");
    }
  }

  return (
    <section aria-labelledby="legacy-planner" className="space-y-4">
      <SectionHeading id="legacy-planner">Plan your Legacy perks</SectionHeading>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2" aria-live="polite">
          <strong className="tabular-nums text-fg">{purchases.length} {purchases.length === 1 ? "rank" : "ranks"} planned</strong>
          {planner.totals(purchases).map(({ currencyId, spent, cap }) => (
            <div key={currencyId} className="text-sm tabular-nums text-fg-2">
              {catalog.currencies.length > 1 && <span>{`Currency ${currencyId}. `}</span>}
              {spent === null ? "Estimated points spent unknown" : `${spent} estimated points spent`}<span aria-hidden="true"> · </span>
              {cap === null ? "Estimated shared cap unknown" : `Estimated shared cap ${cap}`}
              {spent !== null && cap !== null && spent > cap && <span className="font-medium text-fg">{` (${spent - cap} over estimate)`}</span>}
            </div>
          ))}
        </div>
        <p className="text-sm text-muted">
          Point costs, the shared cap and where spend gates count are unconfirmed game-file estimates. Rank limits and known prerequisites govern this plan.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton className={`${action} btn-primary`} text={shareURL} label="Copy plan link" disabled={!purchases.length} onResult={(ok) => {
            setManualLink(!ok);
            setMessage(ok ? "Plan link copied." : "Clipboard unavailable. Select the plan link below to copy it.");
          }} />
          <button type="button" className={action} onClick={savePlan} disabled={!purchases.length}>Save on this device</button>
          <button type="button" className={action} onClick={loadPlan} disabled={!saved}>Load saved plan</button>
          <button type="button" className={action} disabled={!purchases.length && !importNotes.length} onClick={() => {
            setPurchases([]);
            setImportNotes([]);
            setManualLink(false);
            setMessage("Plan reset.");
            const url = new URL(window.location.href);
            url.hash = hashParts(url.hash).filter((part) => !part.startsWith(HASH_KEY)).join("&");
            window.history.replaceState(window.history.state, "", url);
          }}>Reset plan</button>
        </div>
        {manualLink && <input className="w-full rounded-control border border-line bg-canvas p-2 text-sm text-fg" aria-label="Plan link" value={shareURL()} readOnly onFocus={(event) => event.currentTarget.select()} />}
        <p className="text-sm text-fg-2 empty:hidden" role="status">{message}</p>
        {importNotes.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">{importNotes.map((note) => <li key={note}>{note}</li>)}</ul>}
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        {catalog.trees.map((tree) => {
          const name = treeName(tree);
          const titleId = `legacy-plan-tree-${tree.id}`;
          return (
            <Card key={tree.id} as="section" aria-labelledby={titleId} className="min-w-0">
              <h3 id={titleId} className="border-b border-line pb-2 font-semibold text-fg">{name ? `${name} tree` : `Legacy tree ${tree.id}`}</h3>
              <ul className="divide-y divide-line">
                {orderedPerks(tree.nodes).filter(isPlannable).map((node) => (
                  <PerkRanks key={node.id} node={node} planner={planner} purchases={purchases} onChange={setPurchases}
                    gates={tree.gates.filter((gate) => gate.guards.includes(node.id))} />
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function PerkRanks({ node, planner, purchases, onChange, gates }: {
  node: Node;
  planner: ReturnType<typeof createPlanner>;
  purchases: Purchase[];
  onChange: (purchases: Purchase[]) => void;
  gates: LegacyPerkCatalog["trees"][number]["gates"];
}) {
  const [choice, setChoice] = useState(node.entries[0]?.id);
  const name = perkName(node);
  const bought = purchases.filter(([id]) => id === node.id);
  const chosen = bought[0]?.[1] ?? choice;
  const next = planner.next(purchases, node, chosen);
  const remaining = bought.length ? planner.remove(purchases, node.id) : null;
  const rankLimit = node.kind === "choice" ? node.entries.find((entry) => entry.id === chosen)?.maxRanks : node.ranks.value;
  const firstRankIndex = purchases.findIndex(([id]) => id === node.id);
  const beforeFirstRank = firstRankIndex === -1 ? purchases : purchases.slice(0, firstRankIndex);
  const detailsId = `legacy-perk-details-${node.id}`;

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-fg">{name}</p>
        {node.kind === "choice" && (
          <select className="my-1 max-w-full rounded-control border border-line bg-canvas p-1 text-fg" aria-label={`Choice for ${name}`}
            value={chosen} disabled={bought.length > 0} onChange={(event) => setChoice(Number(event.currentTarget.value))}>
            {node.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.name ?? `Entry ${entry.id}`}</option>)}
          </select>
        )}
        <div id={detailsId} className="mt-0.5 space-y-0.5 text-xs text-muted">
          {"reason" in next && next.reason !== "Maximum ranks reached." && <p>{next.reason}</p>}
          {bought.length > 0 && remaining === null && <p>Remove dependent ranks first.</p>}
          {node.prereqs.some((prereq) => prereq.rule === null) && <p>A prerequisite rule is unknown.</p>}
          {gates.map((gate) => {
            const points = planner.gatePoints(gate, beforeFirstRank);
            const before = firstRankIndex !== -1 ? " before first rank" : "";
            return <p key={gate.condId}>{points === null
              ? `${gate.amount}-point gate. Spend estimate unavailable.`
              : `Estimated gate spend ${points}/${gate.amount}${before}${points < gate.amount ? " (below gate)" : ""}.`}</p>;
          })}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" className={rankButton} aria-label={`Remove rank from ${name}`} aria-describedby={detailsId} disabled={remaining === null}
          onClick={() => { if (remaining) onChange(remaining); }}>−</button>
        <span className="min-w-9 text-center text-xs tabular-nums text-fg-2" aria-label={`${name}: ${bought.length} of ${rankLimit ?? "unknown"} ranks`}>{`${bought.length}/${rankLimit ?? "?"}`}</span>
        <button type="button" className={rankButton} aria-label={`Add rank to ${name}`} aria-describedby={detailsId} disabled={"reason" in next}
          onClick={() => { if ("purchase" in next) onChange([...purchases, next.purchase]); }}>+</button>
      </div>
    </li>
  );
}
