import { CLASS_FILL, classColour } from "@/components/ui/class-colour";
import type { ChartSeries, RankingWeek } from "@/lib/rankings";

// Words and marks the server-drawn rankings parts and the measured client charts share.

export const number = (n: number) => n.toLocaleString("en-US");
/** A share of the shown total, both rounded already; a whole percent claims no more than the counts do. */
export const percent = (share: number) => `${Math.round(share * 100)}%`;
export const weekLabel = (w: RankingWeek) => (w.current ? `This week so far (from ${w.start})` : `Week of ${w.start}`);
/** A race carries its faction (Skyborne is on both sides). */
export const nameOf = (s: ChartSeries) => (s.faction && s.label !== s.faction ? `${s.label} (${s.faction})` : s.label);
export const weekTick = (w: RankingWeek) => (w.current ? "so far" : w.start.slice(5));
export const fill = (s: ChartSeries) => (s.classToken && !s.faction ? classColour(CLASS_FILL, s.classToken) : "fill-fg-2");
