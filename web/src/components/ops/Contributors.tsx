"use client";

import { useState } from "react";
import type { OpsContributor } from "@/lib/ops/types";
import RealmControl from "./RealmControl";
import ContributorIdentity from "./ContributorIdentity";

const control = "min-h-11 rounded-control border border-edge bg-canvas px-3 py-2 text-base text-fg";

export default function Contributors({ rows, asOf }: { rows: OpsContributor[]; asOf: string }) {
  const [realm, setRealm] = useState("");
  const [kind, setKind] = useState("");
  const [days, setDays] = useState("7");
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const start = new Date(asOf.slice(0, 10) + "T00:00:00Z");
  start.setUTCDate(start.getUTCDate() - Number(days) + 1);
  const since = start.toISOString().slice(0, 10);
  const until = asOf.slice(0, 10);
  const visible = rows.filter(row => (includeExcluded || !row.excluded) && (!realm || row.realms.includes(realm)) && (!kind || row.kinds.includes(kind)) && row.daysActive.some(day => day >= since && day <= until));
  const contributor = visible.find(row => row.id === selected);
  return <section aria-labelledby="contributors" className="space-y-3">
    <h2 id="contributors" className="text-lg font-semibold text-fg">Contributors</h2>
    <p className="text-cell text-fg-2">Stable installation aliases, not unique people. Observed realms do not identify the submitting character. Counts cover the retained snapshot; filters select active installations.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-meta text-muted">Realm<select aria-label="Realm" className={control} value={realm} onChange={event => setRealm(event.target.value)}><option value="">All realms</option>{[...new Set(rows.flatMap(row => row.realms))].sort().map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="grid gap-1 text-meta text-muted">Contribution kind<select aria-label="Contribution kind" className={control} value={kind} onChange={event => setKind(event.target.value)}><option value="">All kinds</option>{[...new Set(rows.flatMap(row => row.kinds))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="grid gap-1 text-meta text-muted">Active window<select aria-label="Active window" className={control} value={days} onChange={event => setDays(event.target.value)}><option value="7">Past 7 UTC days</option><option value="30">Past 30 UTC days</option><option value="90">Past 90 UTC days</option></select></label>
      <label className="flex min-h-11 items-center gap-2 text-cell text-fg-2"><input type="checkbox" checked={includeExcluded} onChange={event => setIncludeExcluded(event.target.checked)} />Include known owner/test installs</label>
    </div>
    <p role="status" className="text-meta text-muted">{visible.length} installations · {since}–{until} UTC (today partial)</p>
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full text-left text-cell">
        <caption className="sr-only">Contributing installations</caption>
        <thead className="bg-panel text-meta text-muted"><tr>{["Installation", "Observed realms", "Kinds", "Successful receipts / uploads", "Records", "Last received (UTC)"].map(label => <th key={label} scope="col" className="px-3 py-2 font-normal">{label}</th>)}</tr></thead>
        <tbody>{visible.map(row => <tr key={row.id} className="border-t border-line align-top">
          <td className="px-3 py-2"><button type="button" aria-expanded={contributor?.id === row.id} onClick={() => setSelected(selected === row.id ? null : row.id)} className="min-h-11 text-left text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{row.alias}</button><p className="text-meta text-muted">{row.excluded ? "Known owner/test" : "Outside known exclusions"}</p></td>
          <td className="px-3 py-2">{row.realms.length ? row.realms.map(value => <div key={value}><RealmControl realm={value} onFilter={setRealm} /></div>) : "Unknown"}</td>
          <td className="px-3 py-2 text-fg-2">{row.kinds.join(", ") || "Unknown"}</td>
          <td className="px-3 py-2 font-mono">{row.successfulReceipts.toLocaleString("en-US")}<p className="text-meta text-muted">{row.series === "receipts" ? "Receipt history" : "Stored-upload baseline"}</p></td>
          <td className="px-3 py-2 font-mono">{row.records.toLocaleString("en-US")}</td><td className="whitespace-nowrap px-3 py-2 text-meta text-fg-2">{row.lastReceivedAt}</td>
        </tr>)}</tbody>
      </table>
      {!visible.length && <p className="px-3 py-4 text-cell text-muted">No installations match these filters.</p>}
    </div>
    {contributor && <section aria-label={`Activity for ${contributor.alias}`} className="rounded-card border border-line bg-panel p-4">
      <h3 className="font-semibold text-fg">{contributor.alias}</h3>
      <p className="mt-1 text-meta text-muted">Active UTC dates · {contributor.series === "receipts" ? "Successful receipt activity" : "Stored uploads only; receipt coverage unavailable"}</p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-meta text-fg-2">{contributor.daysActive.slice().sort().reverse().map(day => <li key={day}>{day}</li>)}</ul>
      <ContributorIdentity key={`${contributor.id}:${asOf}`} id={contributor.id} />
    </section>}
  </section>;
}
