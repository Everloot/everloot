import { Card } from "@/components/ui";
import type { TrackDay } from "../../../../kb/src/character-track";

const W = 720;
const H = 220;
const PAD = { left: 40, right: 104, top: 16, bottom: 28 };
const DAY_MS = 86_400_000;

const SERIES = [
  { key: "itemLevel", label: "Item level", stroke: "stroke-fg", fill: "fill-fg", dash: undefined },
  { key: "gearScore", label: "Gear Score", stroke: "stroke-fg-2", fill: "fill-fg-2", dash: "6 3" },
] as const;

/** A round axis around the values: down and up to the next 5, with at least one step between. */
function axis(values: number[]): [number, number] {
  const lo = Math.max(0, Math.floor((Math.min(...values) - 1) / 5) * 5);
  const hi = Math.ceil((Math.max(...values) + 1) / 5) * 5;
  return [lo, Math.max(hi, lo + 5)];
}

/**
 * A ranked character's item level and Gear Score over the days they were tracked (one point per day, profile
 * pipeline). Inline SVG, drawn on the server. The days sit at their real distance apart, so a gap in syncing shows
 * as a gap; a line breaks where a day has no point for it. The two lines differ by dash as well as shade and are
 * named at their ends and in the legend; the table below holds the numbers. The page draws it only with two days or more.
 */
export function TrackChart({ days, name }: { days: TrackDay[]; name: string }) {
  const values = days.flatMap((d) => [d.itemLevel, d.gearScore].filter((v): v is number => v !== null));
  if (days.length < 2 || values.length === 0) return null;
  const [lo, hi] = axis(values);
  const t0 = Date.parse(days[0]!.day), span = Math.max(DAY_MS, Date.parse(days[days.length - 1]!.day) - t0);
  const x = (day: string) => PAD.left + ((Date.parse(day) - t0) / span) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const title = `${name}: item level and Gear Score by day`;
  const ends = SERIES.map((s) => {
    const last = [...days].reverse().find((d) => d[s.key] !== null);
    return last ? { ...s, y: y(last[s.key]!) } : null;
  }).filter((e) => e !== null).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i]!.y = Math.max(ends[i]!.y, ends[i - 1]!.y + 12);
  const ticks = days.length > 2 ? [days[0]!, days[Math.floor(days.length / 2)]!, days[days.length - 1]!] : days;
  return (
    <Card as="section" aria-labelledby="gear-over-time">
      <h2 id="gear-over-time" className="text-h2-sm text-fg">Gear over time</h2>
      <figure data-track-chart className="mt-3 min-w-0">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="h-auto w-full">
          <title>{title}</title>
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="fill-muted font-mono text-[11px]">{Math.round(v)}</text>
            </g>
          ))}
          {ticks.map((d) => (
            <text key={d.day} x={x(d.day)} y={H - 8} textAnchor="middle" className="fill-muted font-mono text-[11px]">{d.day.slice(5)}</text>
          ))}
          {SERIES.map((s) => {
            const path = days.map((d, i) => {
              const v = d[s.key];
              if (v === null) return "";
              return `${i > 0 && days[i - 1]![s.key] !== null ? "L" : "M"}${x(d.day).toFixed(1)},${y(v).toFixed(1)}`;
            }).join(" ").trim();
            return (
              <g key={s.key}>
                <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" strokeDasharray={s.dash} className={s.stroke} />
                {days.map((d) => d[s.key] !== null && (
                  <circle key={d.day} cx={x(d.day)} cy={y(d[s.key]!)} r={4} className={`${s.fill} stroke-panel`} strokeWidth={2}>
                    <title>{`${s.label}, ${d.day}: ${d[s.key]}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
          {ends.map((e) => (
            <text key={e.key} x={W - PAD.right + 8} y={e.y + 4} className="fill-fg-2 text-[11px]">{e.label}</text>
          ))}
        </svg>
        <figcaption className="mt-3">
          <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-cell-2 text-fg-2">
            {SERIES.map((s) => (
              <li key={s.key} className="inline-flex items-center gap-1.5">
                <svg aria-hidden="true" width="16" height="4" viewBox="0 0 16 4">
                  <line x1="0" x2="16" y1="2" y2="2" strokeWidth={2} strokeDasharray={s.dash ? "4 2" : undefined} className={s.stroke} />
                </svg>
                {s.label}
              </li>
            ))}
          </ul>
          <table className="sr-only">
            <caption>{title}</caption>
            <thead><tr><th scope="col">Day</th>{SERIES.map((s) => <th key={s.key} scope="col">{s.label}</th>)}</tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}><th scope="row">{d.day}</th>{SERIES.map((s) => <td key={s.key}>{d[s.key] ?? "none"}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </figcaption>
      </figure>
    </Card>
  );
}
