"use client";

import type { CensusCount } from "@kb/census";
import { axisStep, percentAxisStep } from "@/lib/chart-axis";
import type { ChartSeries, RankingWeek } from "@/lib/rankings";
import { useMeasuredWidth } from "@/lib/use-measured-width";
import { fill, nameOf, number, percent, stroke, weekLabel, weekTick } from "./chart-words";

// The hub's two charts and a ranking's trend chart, drawn at the width they are laid out at, one viewBox unit a CSS pixel, so their labels keep
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

const LH = 300;
const LPAD = { left: 40, right: 24, top: 16, bottom: 28 };
/** Room for the names at the lines' ends (with LPAD.right, 140 as before); a phone's card has none to spare, and the legend names every line anyway. */
const END_ROOM = 116;
const END_MIN_WIDTH = 480;

/**
 * Each series' share of the week's characters, a line over the weeks. The share axis runs 0 / step / 2 × step in
 * whole percents, so each label is its gridline's value. Lines break where a week's count is hidden; with four lines
 * or fewer, and room for it, each is also named at its last point, nudged apart so the names never overlap.
 */
export function WeeklyLinesChart({ weeks, series, title }: { weeks: RankingWeek[]; series: ChartSeries[]; title: string }) {
  const [box, width] = useMeasuredWidth();
  const step = percentAxisStep(Math.max(0, ...series.flatMap((s) => s.points.filter((p): p is number => p !== null))));
  const max = step * 2;
  const named = series.length <= 4 && width >= END_MIN_WIDTH;
  const right = LPAD.right + (named ? END_ROOM : 0);
  const x = (i: number) => LPAD.left + (weeks.length === 1 ? 0 : (i / (weeks.length - 1)) * (width - LPAD.left - right));
  const y = (v: number) => LPAD.top + (1 - v / max) * (LH - LPAD.top - LPAD.bottom);
  const path = (points: (number | null)[]) =>
    points.map((p, i) => (p === null ? "" : `${i > 0 && points[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)}`)).join(" ").trim();
  const ends = (named ? series : [])
    .map((s) => {
      const i = s.points.reduce<number>((last, p, j) => (p !== null ? j : last), -1);
      return i < 0 ? null : { key: s.key, label: nameOf(s), y: y(s.points[i]!) };
    })
    .filter((e): e is { key: string; label: string; y: number } => e !== null)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 12);
  return (
    <div ref={box}>
      <svg viewBox={`0 0 ${width} ${LH}`} width={width} height={LH} role="img" aria-label={title} className="block max-w-full">
        <title>{title}</title>
        {[0, step, max].map((v) => (
          <g key={v}>
            <line x1={LPAD.left} x2={width - right} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
            <text x={LPAD.left - 6} y={y(v) + 4} textAnchor="end" className="fill-muted font-mono text-caption">{percent(v)}</text>
          </g>
        ))}
        {weeks.map((w, i) => (
          <text key={w.start} x={x(i)} y={LH - 8} textAnchor="middle" className="fill-muted font-mono text-caption">{weekTick(w)}</text>
        ))}
        {series.map((s) => (
          <g key={s.key}>
            <title>{nameOf(s)}</title>
            <path d={path(s.points)} fill="none" strokeWidth={2} strokeLinejoin="round" strokeDasharray={s.faction === "Horde" ? "6 3" : undefined} className={stroke(s)} />
            {s.points.map((p, i) => p !== null && (
              <circle key={i} cx={x(i)} cy={y(p)} r={4} className={`${fill(s)} stroke-panel`} strokeWidth={2}>
                <title>{`${nameOf(s)}, ${weekLabel(weeks[i])}: ${percent(p)}`}</title>
              </circle>
            ))}
          </g>
        ))}
        {ends.map((e) => (
          <text key={e.key} x={width - right + 8} y={e.y + 4} className="fill-fg-2 text-caption">{e.label}</text>
        ))}
      </svg>
    </div>
  );
}
