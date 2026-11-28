import { CLASS_FILL, CLASS_STROKE, classColour } from "@/components/ui/class-colour";
import type { ChartSeries, RankingWeek } from "@/lib/rankings";
import { utcDay } from "@/lib/time";

// Words and marks the server-drawn rankings parts and the measured client charts share.

export const number = (n: number) => n.toLocaleString("en-US");
/** A share of the shown total, both rounded already; a whole percent claims no more than the counts do. */
export const percent = (share: number) => `${Math.round(share * 100)}%`;
export const weekLabel = (w: RankingWeek) => (w.current ? `This week so far (from ${utcDay(w.start) ?? w.start})` : `Week of ${utcDay(w.start) ?? w.start}`);
/** A race carries its faction (Skyborne is on both sides). */
export const nameOf = (s: ChartSeries) => (s.faction && s.label !== s.faction ? `${s.label} (${s.faction})` : s.label);
export const weekTick = (w: RankingWeek) => (w.current ? "so far" : w.start.slice(5));
export const fill = (s: ChartSeries) => (s.classToken && !s.faction ? classColour(CLASS_FILL, s.classToken) : "fill-fg-2");
export const stroke = (s: ChartSeries) => (s.classToken && !s.faction ? classColour(CLASS_STROKE, s.classToken) : "stroke-fg-2");

/**
 * Series that are not classes (races, the two sides) told apart by colour as well as dash: each takes the next of
 * five existing token colours in its faction's order, Alliance solid and Horde dashed, so up to five per side never
 * share a mark (a side has five races). Class series keep their class colour, solid.
 */
const SERIES_STROKE = ["stroke-fg-2", "stroke-q-rare", "stroke-q-epic", "stroke-q-legendary", "stroke-q-uncommon"] as const;
const SERIES_FILL = ["fill-fg-2", "fill-q-rare", "fill-q-epic", "fill-q-legendary", "fill-q-uncommon"] as const;
export interface SeriesMark { stroke: string | undefined; fill: string | undefined; horde: boolean }
export function seriesMarks(series: readonly ChartSeries[]): SeriesMark[] {
  const next = new Map<string, number>();
  return series.map((s) => {
    if (s.classToken && !s.faction) return { stroke: stroke(s), fill: fill(s), horde: false };
    const side = s.faction ?? "";
    const i = next.get(side) ?? 0;
    next.set(side, i + 1);
    return { stroke: SERIES_STROKE[i % SERIES_STROKE.length], fill: SERIES_FILL[i % SERIES_FILL.length], horde: s.faction === "Horde" };
  });
}
