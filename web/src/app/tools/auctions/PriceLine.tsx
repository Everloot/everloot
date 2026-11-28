"use client";

import { useState } from "react";
import { useMeasuredWidth } from "@/lib/use-measured-width";

/** One public day as the chart draws it: its value in copper, the label hover gives, and whether the trim took it out. */
export interface PriceLineDay { day: string; value: number; label: string; outlier: boolean }

const LEFT = 80, RIGHT = 16, TOP = 24, BOTTOM = 180;

/**
 * The realm item page's 60-day line, drawn one viewBox unit to a pixel (as the census chart is) so its labels keep their
 * size on a phone. The y-axis runs 0 / step / 2 × step over the days the market value keeps; a day the trim took out
 * sits on the top line with a hollow dot, and its hover label says so. Every day is a hover and focus target.
 */
export default function PriceLine({ days, step, axis, title }: { days: PriceLineDay[]; step: number; axis: [string, string, string]; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [box, width] = useMeasuredWidth();
  const top = step * 2;
  const plot = width - LEFT - RIGHT;
  const first = Date.parse(`${days[0]!.day}T00:00:00Z`);
  const span = Math.max(1, Date.parse(`${days.at(-1)!.day}T00:00:00Z`) - first);
  const xs = days.map((d) => LEFT + ((Date.parse(`${d.day}T00:00:00Z`) - first) / span) * plot);
  const y = (v: number) => BOTTOM - (Math.min(v, top) / top) * (BOTTOM - TOP);
  const path = days.map((d, i) => `${i ? "L" : "M"}${xs[i]},${y(d.value)}`).join(" ");
  // Each target reaches half-way to its neighbours, so the whole plot answers a hover.
  const edge = (i: number) => (i <= 0 ? LEFT : i >= days.length ? LEFT + plot : (xs[i - 1]! + xs[i]!) / 2);
  return (
    <div ref={box} className="relative" onMouseLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${width} 204`} width={width} height="204" role="img" aria-label={title} className="block max-w-full text-accent">
        {[0, step, top].map((n, i) => (
          <g key={n}>
            <line data-gridline={n} x1={LEFT} x2={LEFT + plot} y1={y(n)} y2={y(n)} className="stroke-line" />
            <text data-axis-label x={LEFT - 8} y={y(n) + 4} textAnchor="end" className="fill-muted font-mono text-xs">{axis[i]}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {days.map((d, i) => (d.outlier
          ? <circle key={d.day} data-point={d.day} data-outlier cx={xs[i]} cy={y(d.value)} r="4" strokeWidth="2" className="fill-panel stroke-fg-2" />
          : <circle key={d.day} data-point={d.day} cx={xs[i]} cy={y(d.value)} r={active === i ? 4 : 2} className="fill-current" />))}
        {active !== null && <line data-crosshair x1={xs[active]} x2={xs[active]} y1={TOP} y2={BOTTOM} className="stroke-muted" strokeDasharray="4 4" />}
        {days.map((d, i) => (
          <rect
            key={d.day} x={edge(i)} y={TOP - 8} width={Math.max(1, edge(i + 1) - edge(i))} height={BOTTOM - TOP + 16} fill="transparent"
            tabIndex={0} role="button" aria-label={d.label} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
          >
            <title>{d.label}</title>
          </rect>
        ))}
        <text x={LEFT} y="198" className="fill-muted text-xs">{days[0]!.day.slice(5)}</text>
        <text x={LEFT + plot} y="198" textAnchor="end" className="fill-muted text-xs">{days.at(-1)!.day.slice(5)}</text>
      </svg>
      {active !== null && <div role="tooltip" className="absolute right-2 top-0 rounded-control border border-edge bg-panel px-3 py-2 text-sm text-fg">{days[active]!.label}</div>}
    </div>
  );
}
