import Link from "next/link";
import type { ReactNode } from "react";
import { Card, DataTable, EmptyState, Explainer, type Column } from "@/components/ui";
import { guildsOn } from "@/lib/guild-switch";
import { leaderboardsOn } from "@/lib/leaderboard-switch";
import { GEAR_BOARDS, gearBoardPath } from "@/lib/leaderboards";
import { CENSUS_MIN_CHARACTERS, CENSUS_MIN_INSTALLS, CENSUS_MIN_REPORTERS, CENSUS_ROUND_TO, HIDDEN_LABEL } from "../../../../kb/src/census";
import type { CensusCount, Faction } from "../../../../kb/src/census";
import {
  COLLECTING_LINE, HUB_ROWS, RAIL_GROUPS, START_LINE, censusHrefOf, rankingPath,
  type Change, type ChartSeries, type HubMetrics, type Mover, type RankRow, type RankingView, type RankingWeek,
} from "@/lib/rankings";

export const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const number = (n: number) => n.toLocaleString("en-US");
/** A share of the shown total, both rounded already; a whole percent claims no more than the counts do. */
export const percent = (share: number) => `${Math.round(share * 100)}%`;
export const weekLabel = (w: RankingWeek) => (w.current ? `This week so far (from ${w.start})` : `Week of ${w.start}`);

// Whole class names, so Tailwind sees them.
const CLASS_BG: Record<string, string> = {
  WARRIOR: "bg-class-warrior", PALADIN: "bg-class-paladin", HUNTER: "bg-class-hunter",
  ROGUE: "bg-class-rogue", PRIEST: "bg-class-priest", SHAMAN: "bg-class-shaman",
  MAGE: "bg-class-mage", WARLOCK: "bg-class-warlock", DRUID: "bg-class-druid",
};
const CLASS_STROKE: Record<string, string> = {
  WARRIOR: "stroke-class-warrior", PALADIN: "stroke-class-paladin", HUNTER: "stroke-class-hunter",
  ROGUE: "stroke-class-rogue", PRIEST: "stroke-class-priest", SHAMAN: "stroke-class-shaman",
  MAGE: "stroke-class-mage", WARLOCK: "stroke-class-warlock", DRUID: "stroke-class-druid",
};
const CLASS_FILL: Record<string, string> = {
  WARRIOR: "fill-class-warrior", PALADIN: "fill-class-paladin", HUNTER: "fill-class-hunter",
  ROGUE: "fill-class-rogue", PRIEST: "fill-class-priest", SHAMAN: "fill-class-shaman",
  MAGE: "fill-class-mage", WARLOCK: "fill-class-warlock", DRUID: "fill-class-druid",
};

/**
 * The list of rankings: a rail on wide screens, a bar of links that scrolls sideways on a phone. Plain links,
 * so it works without JavaScript. `row` keeps it a bar at every width (the hub puts it under the title). With
 * EVERLOOT_GUILDS on, Population ends with the guild ladder; with EVERLOOT_LEADERBOARDS on, the gear boards lead.
 */
export function RankingRail({ current, row = false }: { current?: string; row?: boolean }) {
  const col = row ? "" : "lg:block";
  const withGuilds = guildsOn()
    ? RAIL_GROUPS.map((g, i) => (i === 0 ? { ...g, links: [...g.links, { label: "Guilds by progression", href: "/guilds" }] } : g))
    : RAIL_GROUPS;
  // With EVERLOOT_LEADERBOARDS on, the gear boards come first: named characters, each by its owner's choice.
  const groups = leaderboardsOn()
    ? [{ title: "Characters", links: (["item-level", "gear-score"] as const).map((m) => ({ label: GEAR_BOARDS[m].title, href: gearBoardPath(m) })) }, ...withGuilds]
    : withGuilds;
  return (
    <nav aria-label="Rankings" data-rankings-rail className="min-w-0">
      <div className={`-mx-4 overflow-x-auto px-4 ${row ? "" : "lg:mx-0 lg:overflow-visible lg:px-0"}`}>
        <ul className={`flex gap-x-1 whitespace-nowrap ${row ? "" : "lg:flex-col lg:gap-y-4 lg:whitespace-normal"}`}>
          {groups.map((group) => (
            <li key={group.title} className={`contents ${col}`}>
              <h2 className={`mb-1 hidden px-2 text-th text-muted ${col}`}>{group.title}</h2>
              <ul className={`contents ${col}`}>
                {group.links.map((l) => {
                  const on = l.href === current;
                  return (
                    <li key={l.href} className="shrink-0">
                      <Link
                        href={l.href}
                        aria-current={on ? "page" : undefined}
                        className={`flex min-h-8 items-center rounded-control px-2 text-control ${on ? "bg-panel text-fg" : "text-fg-2 hover:text-fg"}`}
                      >
                        {l.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

export function ChangeMark({ change }: { change: Change | null }) {
  if (change === null) return null;
  if (change === "new") return <span className="text-accent">new</span>;
  if (change === "same") return <><span aria-hidden="true" className="text-muted">—</span><span className="sr-only">unchanged</span></>;
  return (
    <span className={change.dir === "up" ? "text-accent" : "text-muted"}>
      <span aria-hidden="true">{change.dir === "up" ? "▲" : "▼"}{change.by}</span>
      <span className="sr-only">{change.dir} {change.by}</span>
    </span>
  );
}

const changeText = (c: Change | null) => (c === null ? null : c === "new" ? "new" : c === "same" ? "unchanged" : `${c.dir === "up" ? "▲" : "▼"}${c.by}`);

type Mark = { classToken?: string; faction?: Faction };

/** What colours a row: its class; the faction on the faction board; nothing for a race (the name carries it). */
const markOf = (r: RankRow): Mark => (r.classToken ? { classToken: r.classToken } : r.sub ? {} : { faction: r.faction });

/**
 * The colour mark before a name. Colour follows the entity: the class colour, a solid dot for the Alliance, a
 * dashed ring for the Horde, a muted dot where nothing has a colour. Decorative; the name beside it carries identity.
 */
export function Swatch({ classToken, faction }: Mark) {
  const look = classToken ? CLASS_BG[classToken] : faction === "Horde" ? "border border-dashed border-fg-2" : faction === "Alliance" ? "bg-fg-2" : "bg-muted";
  return <span aria-hidden="true" data-class-mark={classToken ? "" : undefined} className={`h-2.5 w-2.5 shrink-0 rounded-full ${look}`} />;
}

/** A thin bar for a share, in the row's colour. Decorative; the percent is printed beside it. */
export function ShareBar({ share, classToken, className = "" }: { share: number; classToken?: string; className?: string }) {
  return (
    <span aria-hidden="true" className={`block h-1 shrink-0 rounded-full bg-line ${className}`}>
      <span className={`block h-1 rounded-full ${classToken ? CLASS_BG[classToken] : "bg-fg-2"}`} style={{ width: percent(Math.min(1, share)) }} />
    </span>
  );
}

/**
 * The ranked rows: rank, change against last week, the colour mark, name, faction, count, share and the data's
 * date. With `hrefOf`, each name links to the census filtered to that row.
 */
export function RankTable({ rows, caption, showChange, asOf, hrefOf }: { rows: RankRow[]; caption: string; showChange: boolean; asOf: string; hrefOf?: (r: RankRow) => string }) {
  const showSub = rows.some((r) => r.sub);
  const columns: Column<RankRow>[] = [
    {
      key: "name", header: "Name",
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-6 shrink-0 text-right font-mono tabular-nums text-muted">{r.rank ?? "—"}</span>
          <Swatch {...markOf(r)} />
          {hrefOf ? <Link href={hrefOf(r)} className={`${link} font-medium`}>{r.label}</Link> : <span className="font-medium">{r.label}</span>}
        </span>
      ),
    },
    ...(showChange ? [{ key: "change", header: "Change", nowrap: true, cell: (r: RankRow) => <ChangeMark change={r.change} /> }] : []),
    ...(showSub ? [{ key: "faction", header: "Faction", nowrap: true, cell: (r: RankRow) => <span className="text-fg-2">{r.sub}</span> }] : []),
    { key: "count", header: "Characters", numeric: true, cell: (r) => (r.count === null ? <span className="text-muted">{HIDDEN_LABEL}</span> : number(r.count)) },
    {
      key: "share", header: "Share", numeric: true,
      cell: (r) => r.share === null ? "" : (
        <span className="flex items-center justify-end gap-3">
          <span>{percent(r.share)}</span>
          <ShareBar share={r.share} classToken={r.classToken} className="w-16 lg:w-24" />
        </span>
      ),
    },
    { key: "date", header: "Data to", numeric: true, cell: () => asOf.slice(0, 10) },
  ];
  return (
    <DataTable
      dense
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      meta={(r) => [
        showChange ? changeText(r.change) : null,
        r.sub,
        r.count === null ? HIDDEN_LABEL : `${number(r.count)} characters`,
        r.share === null ? null : percent(r.share),
      ].filter(Boolean).join(" · ")}
    />
  );
}

/**
 * One ranking on the hub: its title, a line on what it counts, and the top rows as a list. Each row is the
 * rank, the colour mark, the name, a share bar, the count and the change against last week.
 */
export function RankCard({ view }: { view: RankingView }) {
  const { def } = view;
  const week = view.week!;
  const rows = view.rows.filter((r) => r.rank !== null).slice(0, HUB_ROWS);
  const showChange = view.previous !== null;
  // A row's share over the weeks, drawn small beside it once two weeks have numbers.
  const trend = new Map(view.weeksWithNumbers >= 2 ? view.series.map((s) => [s.key, s]) : []);
  return (
    <Card as="section" padding="none" aria-labelledby={def.slug}>
      <div className="px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={def.slug} className="text-h2-sm text-fg sm:text-h2">{def.title}</h2>
          <Link href={rankingPath(def.slug)} className={`${link} text-control`}>Full ranking<span className="sr-only">: {def.title}</span></Link>
        </div>
        <p className="mt-1 text-meta text-muted">{def.lede} {weekLabel(week)}.</p>
      </div>
      {week.window.collecting ? (
        <EmptyState framed={false} count={week.window.installs} message={COLLECTING_LINE} />
      ) : (
        <ol data-leaderboard aria-label={`${def.title}: top ${HUB_ROWS}`} className="mt-3 border-t border-line">
          {rows.map((r) => (
            <li key={r.key} className="flex min-h-row items-center gap-3 border-b border-line px-4 text-cell last:border-b-0 sm:px-6">
              <span className="w-5 shrink-0 text-right font-mono tabular-nums text-cell-2 text-muted">{r.rank}</span>
              <Swatch {...markOf(r)} />
              <span className="min-w-0 flex-1 truncate font-medium text-fg">
                <Link href={censusHrefOf(def.slug, r, view.query)} className="hover:underline hover:decoration-edge hover:underline-offset-4">
                  {r.label}
                  {r.sub && <span className="ml-1.5 font-normal text-fg-2">{r.sub}</span>}
                  <span className="sr-only"> in the census</span>
                </Link>
              </span>
              {/* Only from xl (1280 px), where each of the two cards still leaves the name about 200 px. Narrower, the
                  sparkline would squeeze the name to nothing (about 800 px), so the share bar shows alone. */}
              {trend.has(r.key) && <Sparkline series={trend.get(r.key)!} className="hidden xl:block" />}
              {r.share !== null && (
                <>
                  <ShareBar share={r.share} classToken={r.classToken} className="hidden w-20 sm:block" />
                  <span className="sr-only">{percent(r.share)}</span>
                </>
              )}
              <span className="w-14 shrink-0 text-right font-mono tabular-nums text-fg">{number(r.count!)}</span>
              {showChange && <span className="w-8 shrink-0 text-right text-cell-2"><ChangeMark change={r.change} /></span>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** What the rankings say before their first week: the start line, then what the page will hold. */
export function StartState() {
  return (
    <div className="space-y-4">
      <EmptyState message={START_LINE} />
      <Card as="section" aria-labelledby="what-will-be-here">
        <h2 id="what-will-be-here" className="text-h2-sm text-fg sm:text-h2">What will be here</h2>
        {/* Plain marks here: a class colour stands for a class, not for a bullet. */}
        <ol className="mt-3 grid gap-3 text-cell text-fg-2 sm:grid-cols-2 lg:grid-cols-4">
          <li className="flex gap-3"><span className="w-5 shrink-0 font-mono text-muted">1</span><span>Three rankings: classes by players, races, and the faction balance.</span></li>
          <li className="flex gap-3"><span className="w-5 shrink-0 font-mono text-muted">2</span><span>A weekly chart of each entry&apos;s share of the characters counted.</span></li>
          <li className="flex gap-3"><span className="w-5 shrink-0 font-mono text-muted">3</span><span>Each rank&apos;s change against last week, and the biggest movers.</span></li>
          <li className="flex gap-3"><span className="w-5 shrink-0 font-mono text-muted">4</span><span>Every row links to the census, filtered to it.</span></li>
        </ol>
      </Card>
    </div>
  );
}

/** A race carries its faction (Skyborne is on both sides). */
const nameOf = (s: ChartSeries) => (s.faction && s.label !== s.faction ? `${s.label} (${s.faction})` : s.label);
const weekTick = (w: RankingWeek) => (w.current ? "so far" : w.start.slice(5));
const stroke = (s: ChartSeries) => (s.classToken && !s.faction ? CLASS_STROKE[s.classToken] : "stroke-fg-2");
const fill = (s: ChartSeries) => (s.classToken && !s.faction ? CLASS_FILL[s.classToken] : "fill-fg-2");
const swatch = (s: ChartSeries) => (s.classToken && !s.faction ? CLASS_BG[s.classToken] : s.faction === "Horde" ? "border border-dashed border-fg-2" : "bg-fg-2");

const W = 720;
const H = 300;
const PAD = { left: 40, right: 140, top: 16, bottom: 28 };

/** A round top for the share axis: the next 5% above the highest point. */
const topOf = (max: number) => Math.max(0.05, Math.ceil(max * 20) / 20);

/**
 * The weekly chart: each of the top rows' share of the week's characters, over the frozen weeks and the current
 * one ("so far"). Inline SVG, drawn on the server, in a card. Lines take their row's colour; markers are ringed by
 * the card so they read over a crossing line. Lines break where a week's count is hidden. Every line is named in
 * the legend (and at its end when there are four or fewer), so identity never rests on colour; the table below holds the numbers.
 */
export function WeeklyChart({ weeks, series, title }: { weeks: RankingWeek[]; series: ChartSeries[]; title: string }) {
  const max = topOf(Math.max(0, ...series.flatMap((s) => s.points.filter((p): p is number => p !== null))));
  const x = (i: number) => PAD.left + (weeks.length === 1 ? 0 : (i / (weeks.length - 1)) * (W - PAD.left - PAD.right));
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const path = (points: (number | null)[]) =>
    points.map((p, i) => (p === null ? "" : `${i > 0 && points[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)}`)).join(" ").trim();
  // With four lines or fewer, each is also labelled at its last point, nudged apart so labels never overlap.
  const ends = (series.length > 4 ? [] : series)
    .map((s) => {
      const i = s.points.reduce<number>((last, p, j) => (p !== null ? j : last), -1);
      return i < 0 ? null : { key: s.key, label: nameOf(s), y: y(s.points[i]!) };
    })
    .filter((e): e is { key: string; label: string; y: number } => e !== null)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 12);
  return (
    <Card>
      <figure data-weekly-chart className="min-w-0">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="h-auto w-full">
          <title>{title}</title>
          {[0, max / 2, max].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="fill-muted font-mono text-[11px]">{percent(v)}</text>
            </g>
          ))}
          {weeks.map((w, i) => (
            <text key={w.start} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted font-mono text-[11px]">{weekTick(w)}</text>
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
            <text key={e.key} x={W - PAD.right + 8} y={e.y + 4} className="fill-fg-2 text-[11px]">{e.label}</text>
          ))}
        </svg>
        <figcaption className="mt-3">
          <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-cell-2 text-fg-2">
            {series.map((s) => (
              <li key={s.key} className="inline-flex items-center gap-1.5">
                <svg aria-hidden="true" width="16" height="4" viewBox="0 0 16 4">
                  <line x1="0" x2="16" y1="2" y2="2" strokeWidth={2} strokeDasharray={s.faction === "Horde" ? "4 2" : undefined} className={stroke(s)} />
                </svg>
                {nameOf(s)}
              </li>
            ))}
          </ul>
          <SharesTable weeks={weeks} series={series} caption={title} />
        </figcaption>
      </figure>
    </Card>
  );
}

const SW = 720;
const SH = 300;
const SPAD = { left: 40, right: 16, top: 20, bottom: 28 };
/** The space between two segments of a bar, in chart units. */
const GAP = 2;

/**
 * The hub's hero: one bar per week, each stacked from the series' shares of that week's characters, bottom up in
 * the newest week's rank order. Inline SVG, drawn on the server, in a card. A hidden count has no segment, so a
 * week missing one is marked partial and the legend says why once. Every segment is named in the legend.
 */
export function StackedWeeks({ weeks, series, hidden = false, title }: { weeks: RankingWeek[]; series: ChartSeries[]; hidden?: boolean; title: string }) {
  const plotW = SW - SPAD.left - SPAD.right;
  const plotH = SH - SPAD.top - SPAD.bottom;
  const slot = plotW / weeks.length;
  const barW = Math.min(56, slot * 0.64);
  const x = (i: number) => SPAD.left + slot * i + (slot - barW) / 2;
  const y = (v: number) => SPAD.top + (1 - v) * plotH;
  // A week with no numbers at all is still collecting; one missing a few is partial.
  const partial = weeks.map((_, i) => (series.every((s) => s.points[i] === null) ? "collecting" : series.some((s) => s.points[i] === null) ? "partial" : null));
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
    <Card>
      <figure data-stacked-chart className="min-w-0">
        <svg viewBox={`0 0 ${SW} ${SH}`} role="img" aria-label={title} className="h-auto w-full">
          <title>{title}</title>
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line x1={SPAD.left} x2={SW - SPAD.right} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
              <text x={SPAD.left - 6} y={y(v) + 4} textAnchor="end" className="fill-muted font-mono text-[11px]">{percent(v)}</text>
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
                <text x={x(i) + barW / 2} y={top - 6} textAnchor="middle" className="fill-muted text-[11px]">{partial[i]}</text>
              )}
              <text x={x(i) + barW / 2} y={SH - 8} textAnchor="middle" className="fill-muted font-mono text-[11px]">{weekTick(week)}</text>
            </g>
          ))}
        </svg>
        <figcaption className="mt-3 space-y-2">
          <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-cell-2 text-fg-2">
            {series.map((s) => (
              <li key={s.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${swatch(s)}`} />
                {nameOf(s)}
              </li>
            ))}
          </ul>
          {(hidden || partial.some(Boolean)) && (
            <p className="text-cell-2 text-muted">A count under the thresholds has no segment, so that week&apos;s bar is partial.</p>
          )}
          <SharesTable weeks={weeks} series={series} caption={title} />
        </figcaption>
      </figure>
    </Card>
  );
}

/**
 * A chart's numbers as a table, closed until asked for: the text alternative to the drawing, for screen readers
 * and for anyone who wants the figures. Native <details>, so it opens without JavaScript.
 */
function ChartTable<T>({ caption, columns, rows, rowKey }: { caption: string; columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string }) {
  return (
    <details data-chart-table className="group">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-control text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="font-mono text-muted group-open:hidden">+</span>
        <span aria-hidden="true" className="hidden font-mono text-muted group-open:inline">−</span>
        Show as a table
      </summary>
      <div className="mt-2 overflow-x-auto">
        <DataTable dense caption={caption} columns={columns} rows={rows} rowKey={rowKey} />
      </div>
    </details>
  );
}

const shareCell = (p: number | null) => (p === null ? <span className="text-muted">{HIDDEN_LABEL}</span> : percent(p));

/** Each series' share week by week, a row per series and a column per week. */
function SharesTable({ weeks, series, caption }: { weeks: RankingWeek[]; series: ChartSeries[]; caption: string }) {
  const columns: Column<ChartSeries>[] = [
    { key: "name", header: "Name", nowrap: true, cell: (s) => <span className="font-medium">{nameOf(s)}</span> },
    ...weeks.map((w, i): Column<ChartSeries> => ({ key: w.start, header: w.current ? "So far" : w.start.slice(5), numeric: true, cell: (s) => shareCell(s.points[i]) })),
  ];
  return <ChartTable caption={caption} columns={columns} rows={series} rowKey={(s) => s.key} />;
}

/** A row's share over the weeks, drawn small. Decorative: the full ranking's chart and table hold the numbers. */
export function Sparkline({ series: s, className = "" }: { series: ChartSeries; className?: string }) {
  const w = 64;
  const h = 18;
  const shown = s.points.filter((p): p is number => p !== null);
  if (shown.length < 2) return null;
  const lo = Math.min(...shown);
  const hi = Math.max(...shown);
  const x = (i: number) => 1 + (i / (s.points.length - 1)) * (w - 2);
  const y = (v: number) => (hi === lo ? h / 2 : 2 + (1 - (v - lo) / (hi - lo)) * (h - 4));
  const d = s.points.map((p, i) => (p === null ? "" : `${i > 0 && s.points[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)}`)).join(" ").trim();
  return (
    <svg aria-hidden="true" data-sparkline width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={`shrink-0 ${className}`}>
      <path d={d} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className={stroke(s)} />
    </svg>
  );
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${number(Math.abs(n))}`;
const signedPercent = (share: number) => `${share > 0 ? "+" : share < 0 ? "−" : ""}${Math.abs(Math.round(share * 100))}%`;

/** What a tile shows while it has no number: a dash for the eye, words for a screen reader. */
const NotYet = ({ why }: { why: string }) => <><span aria-hidden="true" className="text-muted">—</span><span className="sr-only">{why}</span></>;

function Tile({ label, value, note }: { label: string; value: ReactNode; note: ReactNode }) {
  return (
    <div className="min-w-0 rounded-card border border-line bg-panel p-4 sm:p-5">
      <dt className="text-meta text-muted">{label}</dt>
      <dd className="mt-1 truncate font-mono text-h2-sm tabular-nums text-fg sm:text-h2">{value}</dd>
      <dd className="mt-1 text-cell-2 text-fg-2">{note}</dd>
    </div>
  );
}

/** "Mage", "Mage and Rogue", "Hunter, Mage and Rogue". */
const listOf = (names: string[]) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** The leading published class tile's note: its share, whether it is a tie, and why it may not be the most played. */
function leaderNote(m: HubMetrics, collecting: boolean): string {
  const [top] = m.leadingClasses;
  if (!top || top.share === null) return collecting ? "Still collecting" : "No class has a number yet";
  const share = m.leadingClasses.length > 1 ? `Tied at ${percent(top.share)} of characters each` : `${percent(top.share)} of characters`;
  return m.classHidden ? `${share}. Hidden classes are not ranked and could be larger.` : share;
}

/** The hub's headline numbers: characters counted, the change against last week, the leading published class, the installs. */
export function MetricTiles({ m }: { m: HubMetrics }) {
  const collecting = m.week.window.collecting;
  const leaders = m.leadingClasses;
  return (
    <dl data-metric-tiles aria-label="This week in numbers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        label="Characters counted"
        value={m.characters === null ? <NotYet why="still collecting" /> : number(m.characters)}
        note={collecting ? "Still collecting" : weekLabel(m.week)}
      />
      <Tile
        label="Against last week"
        value={m.change ? signed(m.change.by) : <NotYet why="not yet" />}
        note={m.change ? (m.change.share === null ? "characters" : `${signedPercent(m.change.share)} characters`) : "Starts once two weeks have numbers"}
      />
      <Tile
        label={leaders.length > 1 ? "Leading published classes" : "Leading published class"}
        value={leaders.length > 0 ? <span className="font-sans">{listOf(leaders.map((r) => r.label))}</span> : <NotYet why="not yet" />}
        note={leaderNote(m, collecting)}
      />
      <Tile label="Reporting installs" value={number(m.installs)} note="Installs that sent census rows that week" />
    </dl>
  );
}

const TW = 720;
const TH = 200;
const TPAD = { left: 48, right: 16, top: 22, bottom: 28 };

/**
 * Characters counted each week, one bar a week, each labelled with its number. Inline SVG drawn on the server;
 * a collecting week has no bar and says so. The table under it holds the same numbers.
 */
export function WeeklyTotals({ points }: { points: { week: RankingWeek; count: CensusCount }[] }) {
  const max = Math.max(1, ...points.map((p) => p.count ?? 0));
  const top = Math.ceil(max / 50) * 50 || 50;
  const plotW = TW - TPAD.left - TPAD.right;
  const plotH = TH - TPAD.top - TPAD.bottom;
  const slot = plotW / points.length;
  const barW = Math.min(48, slot * 0.6);
  const x = (i: number) => TPAD.left + slot * i + (slot - barW) / 2;
  const y = (v: number) => TPAD.top + (1 - v / top) * plotH;
  const title = "Characters counted each week";
  return (
    <figure data-weekly-totals className="min-w-0">
      <svg viewBox={`0 0 ${TW} ${TH}`} role="img" aria-label={`${title}, ${points.length} weeks`} className="h-auto w-full">
        <title>{title}</title>
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1={TPAD.left} x2={TW - TPAD.right} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
            <text x={TPAD.left - 6} y={y(v) + 4} textAnchor="end" className="fill-muted font-mono text-[11px]">{number(v)}</text>
          </g>
        ))}
        {points.map((p, i) => (
          <g key={p.week.start}>
            {p.count === null ? (
              <text x={x(i) + barW / 2} y={y(0) - 6} textAnchor="middle" className="fill-muted text-[11px]">collecting</text>
            ) : (
              <>
                <rect x={x(i)} y={y(p.count)} width={barW} height={Math.max(0, y(0) - y(p.count))} rx={2} className="fill-fg-2">
                  <title>{`${weekLabel(p.week)}: ${number(p.count)} characters`}</title>
                </rect>
                <text x={x(i) + barW / 2} y={y(p.count) - 6} textAnchor="middle" className="fill-fg-2 font-mono text-[11px]">{number(p.count)}</text>
              </>
            )}
            <text x={x(i) + barW / 2} y={TH - 8} textAnchor="middle" className="fill-muted font-mono text-[11px]">{weekTick(p.week)}</text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-3">
        <ChartTable
          caption={title}
          columns={[
            { key: "week", header: "Week", cell: (p) => weekLabel(p.week) },
            { key: "count", header: "Characters", numeric: true, cell: (p) => (p.count === null ? <span className="text-muted">still collecting</span> : number(p.count)) },
          ]}
          rows={points}
          rowKey={(p) => p.week.start}
        />
      </figcaption>
    </figure>
  );
}

/** The rows that moved most against last week, across the rankings, each linking to the census filtered to it. */
export function Movers({ movers }: { movers: Mover[] }) {
  if (movers.length === 0) return <EmptyState framed={false} message="No rank moved against last week." />;
  return (
    <ol data-movers aria-label="Top movers" className="border-t border-line">
      {movers.map(({ def, row: r, href }) => (
        <li key={`${def.slug}/${r.key}`} className="flex min-h-row items-center gap-3 border-b border-line text-cell last:border-b-0">
          <span className="w-10 shrink-0 text-cell-2"><ChangeMark change={r.change} /></span>
          <Swatch {...markOf(r)} />
          <span className="min-w-0 flex-1 truncate">
            <Link href={href} className="font-medium text-fg hover:underline hover:decoration-edge hover:underline-offset-4">
              {r.label}{r.sub && <span className="ml-1.5 font-normal text-fg-2">{r.sub}</span>}
            </Link>
            <span className="ml-1.5 text-cell-2 text-muted">{def.title}</span>
          </span>
          <span className="shrink-0 font-mono tabular-nums text-fg-2">{r.share === null ? "" : percent(r.share)}</span>
        </li>
      ))}
    </ol>
  );
}

/** How the rankings count, under every rankings page. */
export function HowItCounts() {
  return (
    <Explainer summary="How the rankings count">
      <p>
        A week runs from Monday to Sunday, UTC. Each character counts once a week, and a number shows only when it covers at
        least {CENSUS_MIN_CHARACTERS} characters reported by at least {CENSUS_MIN_INSTALLS} installs from at
        least {CENSUS_MIN_REPORTERS} addresses, rounded to the nearest {CENSUS_ROUND_TO}.
      </p>
      <p>
        Ranks follow those rounded numbers, so equal numbers share a rank. Change compares a rank with the week before.
        Share is a row&apos;s part of all characters counted that week. <Link href="/methodology#population" className={link}>How we count</Link>.
      </p>
      <p>Only race, class, level and faction are counted. No name or character id is stored or shown. The full counts are on the <Link href="/census" className={link}>census</Link>.</p>
      <p>
        Each row links to the census filtered to it. The census counts the last 7 days rather than a Monday-to-Sunday
        week, so its number can differ from the row&apos;s.
      </p>
    </Explainer>
  );
}

/** Said in place of the chart and the change column until two weeks have numbers. */
export const ONE_WEEK_LINE = "Change against last week and the weekly chart start once two weeks have numbers.";

export function OneWeek() {
  return <EmptyState message={ONE_WEEK_LINE} />;
}
