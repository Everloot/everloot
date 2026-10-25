"use client";
import { useEffect, useId, useState } from "react";
import { Card, DataTable, SectionHeading, type Column } from "@/components/ui";
import { parseEverlootLua } from "@/lib/sv-parse";
import {
  RIVER_DAYS, categoryLabel, characterKey, isMoneyLedger, narrowLedger, summarizeMoney,
  type CategoryTotal, type GoldSeries, type MoneyLedger, type Receipt, type RiverDay, type RosterRow,
} from "@/lib/money-ledger";
import { formatCopper } from "../../../../../kb/src/gold-ledger";

/** Where "Remember on this browser" keeps the summary. The raw file is never stored. */
export const STORAGE_KEY = "everloot:gold-ledger";
const MAX_BYTES = 20_000_000;
const FILE_PATH = "World of Warcraft/<game version>/WTF/Account/<account>/SavedVariables/Everloot.lua";

const gold = (copper: number | null) => (copper === null ? "unrecorded" : formatCopper(copper));
const signed = (copper: number) => (copper < 0 ? `-${formatCopper(-copper)}` : formatCopper(copper));
const when = (at: string) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const day = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function readStored(): MoneyLedger | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return isMoneyLedger(value) ? value : null;
  } catch { return null; }
}

/**
 * The gold ledger from the player's own Everloot.lua, read in this browser: nothing is uploaded. The summary
 * (not the file) can be kept in localStorage until the player forgets it.
 */
export default function LocalLedger() {
  const [ledger, setLedger] = useState<MoneyLedger | null>(null);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    const stored = readStored();
    if (stored) { setLedger(stored); setRemember(true); }
  }, []);

  async function loadFile(file: File) {
    setError(null); setReading(true);
    try {
      if (file.size > MAX_BYTES) throw new Error("This file is over 20 MB, which is larger than an Everloot.lua should be.");
      const next = summarizeMoney(parseEverlootLua(await file.text()).records);
      setLedger(next);
      if (remember) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      setError(e instanceof Error ? `This file could not be read: ${e.message}` : "This file could not be read.");
    } finally { setReading(false); }
  }

  function toggleRemember(on: boolean) {
    setRemember(on);
    if (on && ledger) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
    if (!on) window.localStorage.removeItem(STORAGE_KEY);
  }

  function forget() {
    window.localStorage.removeItem(STORAGE_KEY);
    setRemember(false); setLedger(null); setError(null);
  }

  return (
    <section aria-labelledby="ledger-yours" className="space-y-6">
      <h2 id="ledger-yours" className="sr-only">Your ledger</h2>
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && !reading) void loadFile(f); }}>
        <Card>
          <p className="text-fg">Drop your Everloot.lua here to see your gold.</p>
          <p className="mt-1 text-sm text-fg-2">The file stays on this computer. It is read in this browser and nothing is sent.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="btn btn-primary cursor-pointer">Choose Everloot.lua
              <input aria-label="Choose Everloot.lua" type="file" accept=".lua" className="sr-only" disabled={reading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ""; }} />
            </label>
            <label className="flex items-center gap-2 text-sm text-fg-2">
              <input type="checkbox" checked={remember} onChange={(e) => toggleRemember(e.target.checked)} />
              Remember on this browser
            </label>
            {ledger && <button type="button" className="btn" onClick={forget}>Forget</button>}
          </div>
          {reading && <p className="mt-3 text-sm text-muted" role="status">Reading your file…</p>}
          {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
          {!ledger && !error && (
            <p className="mt-4 text-sm text-muted">
              Log out of the game first, then find the file at <code className="font-mono text-fg-2 [overflow-wrap:anywhere]">{FILE_PATH}</code>.
              Remember keeps only the summary below, never the file.
            </p>
          )}
        </Card>
      </div>
      {ledger && <LedgerView ledger={ledger} />}
    </section>
  );
}

function LedgerView({ ledger }: { ledger: MoneyLedger }) {
  const [key, setKey] = useState<string | null>(null);
  const selectId = useId();
  const chosen = ledger.roster.find((r) => characterKey(r) === key);
  const shown = narrowLedger(ledger, key);
  // "Thrall (Moon Guard)" when one character is chosen, else "all characters".
  const who = chosen ? `${chosen.character} (${chosen.realm})` : "all characters";
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted">Read {when(ledger.madeAt)}. A missing line means the addon did not record it, not zero.</p>
      {ledger.roster.length > 1 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label htmlFor={selectId} className="text-muted">Character</label>
          <select id={selectId} value={chosen ? characterKey(chosen) : ""} onChange={(e) => setKey(e.target.value || null)}
            className="min-h-11 rounded-control border border-edge bg-canvas px-3 text-base text-fg">
            <option value="">All characters</option>
            {ledger.roster.map((r) => <option key={characterKey(r)} value={characterKey(r)}>{r.character} ({r.realm})</option>)}
          </select>
        </div>
      )}
      <WeekCard week={shown.week} who={who} />
      <Roster rows={ledger.roster} />
      <River days={shown.river} who={who} />
      <Categories rows={shown.categories} who={who} />
      <Receipts rows={shown.receipts} total={shown.eventCount} />
      <History series={shown.history} />
    </div>
  );
}

function WeekCard({ week, who }: { week: MoneyLedger["week"]; who: string }) {
  const facts = [
    { label: "Money in", value: formatCopper(week.in) },
    { label: "Money out", value: formatCopper(week.out) },
    { label: "Net", value: signed(week.net) },
  ];
  return (
    <Card as="section" aria-labelledby="ledger-week">
      <SectionHeading id="ledger-week" note={`The last 7 days, ${who}.`}>This week</SectionHeading>
      <dl className="grid grid-cols-3 gap-x-6">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-sm text-muted">{f.label}</dt>
            <dd className={`mt-1 font-mono text-lg tabular-nums [overflow-wrap:anywhere] ${f.label === "Net" && week.net < 0 ? "text-danger" : "text-fg"}`}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Roster({ rows }: { rows: RosterRow[] }) {
  const columns: Column<RosterRow>[] = [
    { key: "character", header: "Character", nowrap: true, cell: (r) => r.character },
    { key: "realm", header: "Realm", nowrap: true, cell: (r) => r.realm },
    { key: "gold", header: "Gold", numeric: true, cell: (r) => <span className={r.copper === null ? "text-muted" : undefined}>{gold(r.copper)}</span> },
    { key: "peak", header: "Peak", numeric: true, cell: (r) => <span className={r.peakCopper === null ? "text-muted" : undefined}>{gold(r.peakCopper)}</span> },
    { key: "at", header: "As of", numeric: true, cell: (r) => (r.at ? day(r.at) : "—") },
  ];
  const total = rows.reduce((s, r) => s + (r.copper ?? 0), 0);
  return (
    <section aria-labelledby="ledger-roster">
      <SectionHeading id="ledger-roster" note={rows.length ? `${formatCopper(total)} across ${rows.length} ${rows.length === 1 ? "character" : "characters"}.` : undefined}>Characters</SectionHeading>
      <DataTable caption="Gold per character" columns={columns} rows={rows} rowKey={(r) => `${r.character}-${r.realm}`}
        empty={<p className="px-4 py-6 text-sm text-fg-2">This file has no gold snapshots yet. The addon writes one when a character logs in.</p>} />
    </section>
  );
}

function River({ days, who }: { days: RiverDay[]; who: string }) {
  const high = Math.max(1, ...days.map((d) => Math.max(d.in, d.out)));
  const any = days.some((d) => d.in || d.out);
  const height = (copper: number) => (copper ? `${Math.max(2, Math.round((copper / high) * 64))}px` : "0px");
  return (
    <Card as="section" aria-labelledby="ledger-river">
      <SectionHeading id="ledger-river" note={`Money in and out per day, the last ${RIVER_DAYS} days (UTC), ${who}.`}>Money river</SectionHeading>
      {!any ? <p className="text-sm text-fg-2">No money events in the last {RIVER_DAYS} days.</p> : (
        <>
          <ol data-river className="flex items-stretch gap-px">
            {days.map((d) => {
              const label = `${d.date}: in ${formatCopper(d.in)}, out ${formatCopper(d.out)}`;
              const detail = Object.entries(d.byCategory).map(([c, v]) => `${categoryLabel(c)} ${formatCopper(v)}`).join(", ");
              return (
                <li key={d.date} className="flex min-w-0 flex-1 flex-col" title={detail ? `${label} (${detail})` : label}>
                  <span className="sr-only">{detail ? `${label}. ${detail}.` : label}</span>
                  <div aria-hidden="true" className="flex h-16 items-end border-b border-line"><div className="w-full rounded-t-sm bg-accent" style={{ height: height(d.in) }} /></div>
                  <div aria-hidden="true" className="flex h-16 items-start"><div className="w-full rounded-b-sm bg-warning" style={{ height: height(d.out) }} /></div>
                </li>
              );
            })}
          </ol>
          <div className="mt-2 flex flex-wrap justify-between gap-x-4 text-xs text-muted">
            <span>{days[0]!.date} to {days.at(-1)!.date}</span>
            <span><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent" />in, above the line <span aria-hidden="true" className="ml-3 mr-1 inline-block h-2 w-2 rounded-sm bg-warning" />out, below</span>
          </div>
        </>
      )}
    </Card>
  );
}

function Categories({ rows, who }: { rows: CategoryTotal[]; who: string }) {
  const columns: Column<CategoryTotal>[] = [
    { key: "category", header: "Category", nowrap: true, cell: (r) => categoryLabel(r.category) },
    { key: "direction", header: "In or out", cell: (r) => r.direction },
    { key: "copper", header: "Amount", numeric: true, cell: (r) => formatCopper(r.copper) },
    { key: "events", header: "Events", numeric: true, cell: (r) => r.events.toLocaleString("en-US") },
  ];
  return (
    <section aria-labelledby="ledger-categories">
      <SectionHeading id="ledger-categories" note={`Every money event in the file, ${who}.`}>Categories</SectionHeading>
      <DataTable caption="Money per category" columns={columns} rows={rows} rowKey={(r) => r.category}
        empty={<p className="px-4 py-6 text-sm text-fg-2">This file has no money events yet.</p>} />
    </section>
  );
}

function Receipts({ rows, total }: { rows: Receipt[]; total: number }) {
  const columns: Column<Receipt>[] = [
    { key: "at", header: "When", nowrap: true, cell: (r) => when(r.at) },
    { key: "character", header: "Character", nowrap: true, cell: (r) => r.character },
    { key: "category", header: "Category", nowrap: true, cell: (r) => categoryLabel(r.category) },
    { key: "copper", header: "Amount", numeric: true, cell: (r) => <span className={r.direction === "out" ? "text-warning" : "text-fg"}>{r.direction === "out" ? "-" : "+"}{formatCopper(r.copper)}</span> },
  ];
  return (
    <section aria-labelledby="ledger-receipts">
      <SectionHeading id="ledger-receipts" note={total > rows.length ? `The newest ${rows.length} of ${total.toLocaleString("en-US")}.` : undefined}>Receipts</SectionHeading>
      <DataTable caption="Money events, newest first" columns={columns} rows={rows} rowKey={(r) => `${r.at}-${r.character}-${r.realm}-${r.category}-${r.copper}`}
        empty={<p className="px-4 py-6 text-sm text-fg-2">This file has no money events yet.</p>} />
    </section>
  );
}

function History({ series }: { series: GoldSeries[] }) {
  return (
    <Card as="section" aria-labelledby="ledger-history">
      <SectionHeading id="ledger-history" note="Gold at each snapshot the addon took.">Gold history</SectionHeading>
      {series.length === 0 ? <p className="text-sm text-fg-2">No gold snapshots yet.</p> : (
        <ul className="space-y-5">
          {series.map((s) => {
            const high = Math.max(1, ...s.points.map((p) => p.copper));
            const first = s.points[0]!, last = s.points.at(-1)!;
            return (
              <li key={`${s.character}-${s.realm}`}>
                <p className="text-sm text-fg">{s.character} <span className="text-muted">{s.realm}</span></p>
                <div aria-hidden="true" className="mt-2 flex h-12 items-end gap-px border-b border-line">
                  {s.points.map((p, i) => (
                    <div key={i} className="min-w-0 flex-1 rounded-t-sm bg-accent" style={{ height: `${Math.max(2, Math.round((p.copper / high) * 48))}px` }} title={`${day(p.at)}: ${formatCopper(p.copper)}`} />
                  ))}
                </div>
                <p className="mt-1 font-mono text-xs tabular-nums text-muted">
                  {s.points.length === 1
                    ? `${formatCopper(first.copper)} on ${day(first.at)}`
                    : `${formatCopper(first.copper)} on ${day(first.at)} to ${formatCopper(last.copper)} on ${day(last.at)}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
