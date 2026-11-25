import Link from "next/link";
import { PROGRESSION_GROUPS } from "@kb/progression";
import { Badge } from "@/components/ui";
import type { DungeonsAndRaidsData, InstanceClear } from "@/lib/dungeon-clears";

export interface DungeonsAndRaidsProps {
  /** `loadCharacterProgression(...).dungeons`: public synced kills only, nothing owner-only. */
  data: DungeonsAndRaidsData;
  /** Where the full checklist of every instance lives (the Progress tab). */
  href?: string;
}

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const Day = ({ value }: { value: string }) => <time dateTime={value} className="font-mono tabular-nums">{value}</time>;
const GROUP_LABEL: Record<InstanceClear["group"], string> = { Dungeons: "Dungeon", Raids: "Raid", "World bosses": "World boss" };

function Instance({ row }: { row: InstanceClear }) {
  return (
    <li data-dungeon-instance={row.id} className="py-2">
      <details>
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-fg">{row.href ? <Link href={row.href} className={link}>{row.name}</Link> : row.name}</span>
          <Badge tone="neutral">{GROUP_LABEL[row.group]}</Badge>
          {row.cleared ? <Badge tone="confirmed">Cleared</Badge>
            : <span className="font-mono text-sm tabular-nums text-fg-2">{row.killed} / {row.total} bosses</span>}
          {row.lastKillDay && <span className="text-meta text-muted">Last kill <Day value={row.lastKillDay} /></span>}
        </summary>
        <div className="space-y-2 pb-2 pt-1 text-sm">
          {row.firstClearDay && <p className="text-fg-2">First cleared <Day value={row.firstClearDay} /> UTC</p>}
          <ul className="space-y-1">
            {row.bosses.map((boss) => (
              <li key={boss.id} className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className={boss.killed ? "text-fg" : "text-muted"}>
                  <span aria-hidden="true" className="mr-2 inline-block w-3 font-mono">{boss.killed ? "●" : "–"}</span>{boss.name}
                </span>
                <span className="font-mono text-meta tabular-nums text-fg-2">{boss.killed ? [
                  boss.kills !== null ? `${boss.kills} ${boss.kills === 1 ? "kill" : "kills"}` : null,
                  boss.firstKillDay ? `first ${boss.firstKillDay}` : null,
                  boss.lastKillDay ? `last ${boss.lastKillDay}` : null,
                ].filter(Boolean).join(" · ") : "Not killed"}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </li>
  );
}

/** A character's dungeon and raid clears by instance and boss, from public synced boss kills. */
export default function DungeonsAndRaids({ data, href }: DungeonsAndRaidsProps) {
  return (
    <section aria-labelledby="dungeons-raids" data-dungeons-raids className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="dungeons-raids" className="scroll-mt-24 text-xl font-semibold tracking-tight text-fg">Dungeons &amp; raids</h2>
        <div className="flex flex-wrap items-baseline gap-x-4 text-sm text-fg-2">
          {data.summary && <span className="font-mono tabular-nums">{data.summary.cleared}/{data.summary.total} tracked dungeons cleared</span>}
          {href && <a href={href} className={link}>Every instance</a>}
        </div>
      </div>
      {!data.synced ? <p className="text-sm text-fg-2">No boss kills are synced for this character. They show here once its owner links it in the Everloot Desktop App.</p>
        : data.instances.length === 0 ? <p className="text-sm text-fg-2">No boss kill is recorded in this character&apos;s synced history yet.</p>
        : <ul className="divide-y divide-line border-y border-line">
          {PROGRESSION_GROUPS.flatMap((group) => data.instances.filter((r) => r.group === group).map((r) => <Instance key={r.id} row={r} />))}
        </ul>}
      <p className="text-meta text-muted">
        Lifetime kills synced by the character&apos;s owner through the Everloot Desktop App, each boss counted once across difficulties; dates are UTC.
        Weekly raid lockouts are not part of this list.
      </p>
    </section>
  );
}
