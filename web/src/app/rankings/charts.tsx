"use client";

import type { CensusCount } from "@kb/census";
import { axisStep } from "@/lib/chart-axis";
import type { ChartSeries, RankingWeek } from "@/lib/rankings";
import { useMeasuredWidth } from "@/lib/use-measured-width";
import { fill, nameOf, number, percent, weekLabel, weekTick } from "./chart-words";

// The hub's two charts, drawn at the width they are laid out at, one viewBox unit a CSS pixel, so their labels keep
// their size on a phone and at 1440 instead of scaling with the picture; 720 until the width is measured.

const TH = 200;
const TPAD = { left: 48, right: 16, top: 22, bottom: 28 };

/** Characters counted each week, one bar a week, each labelled with its number; a collecting week has no bar and says so. */
export function WeeklyTotalsChart({ points, title }: { points: { week: RankingWeek; count: CensusCount }[]; title: string }) {
  const [box, width] = useMeasuredWidth();
  const step = axisStep(Math.max(...points.map((p) => p.count ?? 0)));
  const top = step * 2;
  const plotW = width - TPAD.left - TPAD.right;
  const plotH = TH - TPAD.top - TPAD.bottom;
  const slot = plotW / points.length;
  const barW = Math.min(48, slot * 0.6);
  const x = (i: number) => TPAD.left + slot * i + (slot - barW) / 2;
  const y = (v: number) => TPAD.top + (1 - v / top) * plotH;
  return (
    <div ref={box}>
      <svg viewBox={`0 0 ${width} ${TH}`} width={width} height={TH} role="img" aria-label={`${title}, ${points.length} weeks`} className="block max-w-full">
        <title>{title}</title>
        {[0, step, top].map((v) => (
          <g key={v}>
            <line x1={TPAD.left} x2={width - TPAD.right} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
            <text x={TPAD.left - 6} y={y(v) + 4} textAnchor="end" className="fill-muted font-mono text-caption">{number(v)}</text>
          </g>
        ))}
        {points.map((p, i) => (
          <g key={p.week.start}>
            {p.count === null ? (
              <text x={x(i) + barW / 2} y={y(0) - 6} textAnchor="middle" className="fill-muted text-caption">collecting</text>
            ) : (
              <>
                <rect x={x(i)} y={y(p.count)} width={barW} height={Math.max(0, y(0) - y(p.count))} rx={2} className="fill-fg-2">
                  <title>{`${weekLabel(p.week)}: ${number(p.count)} characters`}</title>
                </rect>
                <text x={x(i) + barW / 2} y={y(p.count) - 6} textAnchor="middle" className="fill-fg-2 font-mono text-caption">{number(p.count)}</text>
              </>
            )}
            <text x={x(i) + barW / 2} y={TH - 8} textAnchor="middle" className="fill-muted font-mono text-caption">{weekTick(p.week)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

const SH = 300;
const SPAD = { left: 40, right: 16, top: 20, bottom: 28 };
/** The space between two segments of a bar, in chart units. */
const GAP = 2;

/**
 * One bar per week, each stacked from the series' shares of that week's characters, bottom up in the order given.
 * `partial` marks a week missing some (or all) of its numbers.
 */
export function StackedWeeksChart({ weeks, series, partial, title }: { weeks: RankingWeek[]; series: ChartSeries[]; partial: ("collecting" | "partial" | null)[]; title: string }) {
  const [box, width] = useMeasuredWidth();
  const plotW = width - SPAD.left - SPAD.right;
  const plotH = SH - SPAD.top - SPAD.bottom;
  const slot = plotW / weeks.length;
  const barW = Math.min(56, slot * 0.64);
  const x = (i: number) => SPAD.left + slot * i + (slot - barW) / 2;
  const y = (v: number) => SPAD.top + (1 - v) * plotH;
  const bars = weeks.map((w, i) => {
    let top = y(0);
    const segments = series.flatMap((s) => {
      const p = s.points[i];
      if (p === null) return [];
      const h = Math.min(p * plotH, top - SPAD.top);
      top -= h;
      return [{ key: s.key, name: nameOf(s), y: top, h: Math.max(0, h - GAP), p, fill: fill(s) }];
    });
    return { week: w, i, top, segments };
  });
  return (
    <div ref={box}>
      <svg viewBox={`0 0 ${width} ${SH}`} width={width} height={SH} role="img" aria-label={title} className="block max-w-full">
        <title>{title}</title>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={SPAD.left} x2={width - SPAD.right} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
            <text x={SPAD.left - 6} y={y(v) + 4} textAnchor="end" className="fill-muted font-mono text-caption">{percent(v)}</text>
          </g>
        ))}
        {bars.map(({ week, i, top, segments }) => (
          <g key={week.start}>
            {segments.map((seg) => (
              <rect key={seg.key} x={x(i)} y={seg.y} width={barW} height={seg.h} rx={1} className={seg.fill}>
                <title>{`${seg.name}, ${weekLabel(week)}: ${percent(seg.p)}`}</title>
              </rect>
            ))}
            {partial[i] && (
              <text x={x(i) + barW / 2} y={top - 6} textAnchor="middle" className="fill-muted text-caption">{partial[i]}</text>
            )}
            <text x={x(i) + barW / 2} y={SH - 8} textAnchor="middle" className="fill-muted font-mono text-caption">{weekTick(week)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
