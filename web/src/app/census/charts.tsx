"use client";

import { useState } from "react";
import { CLASS_BG, classColour } from "@/components/ui/class-colour";
import { HIDDEN_LABEL, type CensusCount } from "@kb/census";
import type { CensusIcons } from "@/lib/census-media";

const number = (n: number) => n.toLocaleString("en-US");
const value = (n: CensusCount) => n === null ? HIDDEN_LABEL : number(n);
const factionColour = (f: string) => f === "Alliance" ? "bg-faction-alliance" : "bg-faction-horde";
type ChartRow = { key: string; label: string; count: CensusCount; faction?: string; icon?: string };

/** The name is always present, including when media is unknown or fails to load. */
export function IconName({ label, url }: { label: string; url?: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="inline-flex items-center gap-2">
    {url && !failed && (
      // The media endpoint owns these URLs; render them directly and keep the name on failure.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={`${label} icon`} width={24} height={24} loading="lazy" className="h-6 w-6 rounded-control" onError={() => setFailed(true)} />
    )}
    <span>{label}</span>
  </span>;
}

export function Bars({ title, rows, byClass = false, icons = {} }: { title: string; rows: ChartRow[]; byClass?: boolean; icons?: CensusIcons }) {
  const max = Math.max(1, ...rows.flatMap((r) => r.count === null ? [] : [r.count]));
  return <div aria-label={`${title} bar chart`} className="mb-6 space-y-2">
    {rows.some((r) => r.count !== null) && <div className="flex justify-between text-xs text-muted sm:ml-52"><span>0</span><span>{number(max)} characters</span></div>}
    {rows.map((r) => <div key={r.key} title={`${r.label}: ${value(r.count)}`} tabIndex={0} className="grid min-h-10 items-center gap-x-4 gap-y-1 rounded-control py-2 text-sm text-fg sm:grid-cols-[12rem_1fr_7rem]">
      <span className="flex items-center gap-2">
        {r.faction && <span aria-hidden="true" className={`h-2 w-2 shrink-0 ${factionColour(r.faction)}`} />}
        <IconName label={r.label} url={icons[r.icon ?? ""]} />
      </span>
      {r.count === null ? <span className="text-muted sm:col-span-2">{HIDDEN_LABEL}</span> : <>
        <div className="border-l border-line py-2" aria-hidden="true">
          <div data-bar={r.label} className={`h-3 rounded-r-[4px] ${byClass ? classColour(CLASS_BG, r.label) : "bg-fg-2"}`} style={{ width: `${r.count / max * 100}%` }} />
        </div>
        <span className="font-mono tabular-nums text-fg">{number(r.count)}</span>
      </>}
    </div>)}
  </div>;
}

export function Factions({ rows, total }: { rows: ChartRow[]; total: CensusCount }) {
  // Never infer a missing side, nor stretch a known side to 100%.
  const complete = total !== null && total > 0 && rows.every((r) => r.count !== null);
  const share = (r: ChartRow) => complete ? `${Math.round(r.count! / total! * 100)}%` : HIDDEN_LABEL;
  return <div className="mb-6 space-y-4">
    <ul aria-label="Faction legend" className="flex flex-wrap gap-6 text-sm text-fg">
      {rows.map((r) => <li key={r.key} className="flex items-center gap-2"><span aria-hidden="true" className={`h-3 w-3 ${factionColour(r.label)}`} />{r.label}: {value(r.count)} · {share(r)}</li>)}
    </ul>
    {complete && <div aria-label="Faction split" className="flex h-8 gap-[2px] bg-panel">
      {rows.map((r) => <div key={r.key} tabIndex={0} title={`${r.label}: ${value(r.count)} · ${share(r)}`} aria-label={`${r.label}: ${share(r)}`} className={`min-w-0 ${factionColour(r.label)}`} style={{ flexGrow: r.count!, flexBasis: 0 }} />)}
    </div>}
  </div>;
}

/** Five flat accent steps; ink remains readable at every magnitude in either mode. */
const HEAT = ["bg-census-1", "bg-census-2", "bg-census-3", "bg-census-4", "bg-census-5"];
export function HeatCell({ label, count, max }: { label: string; count: number; max: number }) {
  return <span tabIndex={0} title={`${label}: ${number(count)}`} className={`flex min-h-10 min-w-12 items-center justify-end rounded-control px-2 text-fg ${HEAT[Math.min(4, Math.floor(count / Math.max(1, max) * 5))]}`}>{number(count)}</span>;
}

export function DailyChart({ days }: { days: { day: string; count: CensusCount }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...days.flatMap((d) => d.count === null ? [] : [d.count]));
  const x = (i: number) => 64 + i / Math.max(1, days.length - 1) * 600;
  const targetWidth = 600 / Math.max(1, days.length - 1);
  const y = (n: number) => 180 - n / max * 156;
  const path = days.map((d, i) => d.count === null ? "" : `${i && days[i - 1].count !== null ? "L" : "M"}${x(i)},${y(d.count)}`).join(" ");
  if (!days.some((d) => d.count !== null)) return <p aria-label="Daily characters line chart" className="mb-6 text-muted">{HIDDEN_LABEL}</p>;
  return <div className="relative mb-6" onMouseLeave={() => setActive(null)}>
    <svg viewBox="0 0 720 224" role="img" aria-label="Daily characters line chart" className="w-full min-h-48">
      {[0, max / 2, max].map((n) => <g key={n}><line x1="64" x2="664" y1={y(n)} y2={y(n)} className="stroke-line" /><text x="56" y={y(n) + 4} textAnchor="end" className="fill-muted text-xs">{number(n)}</text></g>)}
      <path d={path} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" className="stroke-fg-2" />
      {days.map((d, i) => <g key={d.day}>
        {(i === 0 || i === days.length - 1) && <text x={x(i)} y="212" textAnchor="middle" className="fill-muted text-xs">{d.day.slice(5)}</text>}
        {d.count !== null && <circle data-point={d.day} cx={x(i)} cy={y(d.count)} r="0.5" strokeWidth="8" vectorEffect="non-scaling-stroke" className="fill-fg-2 stroke-fg-2" />}
      </g>)}
      {active !== null && <line data-crosshair x1={x(active)} x2={x(active)} y1="24" y2="180" className="stroke-muted" strokeDasharray="4 4" />}
      {days.map((d, i) => <rect key={d.day} x={Math.max(64, x(i) - targetWidth / 2)} y="16" width={days.length === 1 ? 600 : i === 0 || i === days.length - 1 ? targetWidth / 2 : targetWidth} height="176" fill="transparent" tabIndex={0} role="button" aria-label={`${d.day}: ${value(d.count)}`} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}><title>{d.day}: {value(d.count)}</title></rect>)}
    </svg>
    {active !== null && <div role="tooltip" className="absolute right-2 top-0 rounded-control border border-edge bg-panel px-3 py-2 text-sm text-fg">{days[active].day}: {value(days[active].count)}</div>}
  </div>;
}
