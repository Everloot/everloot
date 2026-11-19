import type { GuildProgress } from "@kb/guild-progression";
import Link from "next/link";
import { PROGRESSION_BUILD, PROGRESSION_GROUPS, type CharacterProgress } from "@kb/progression";
import { Badge } from "@/components/ui";
import { SPACE } from "@/design/tokens";

export interface ProgressionMatrixProps {
  instances: readonly (CharacterProgress | GuildProgress)[];
  guild?: boolean;
  /** Only pages the site's instance route actually serves. */
  links?: Readonly<Record<number, string>>;
}

export default function ProgressionMatrix({ instances, links = {}, guild = false }: ProgressionMatrixProps) {
  return <div className="space-y-6">
    <div className="space-y-2 text-sm text-fg-2">
      {guild ? <p>Counts members who linked their character and allowed their kills to be shown; others count as not having the kill.</p> : <>
      <p>Kills come from the Everloot addon&apos;s own uploads, linked and consented. Only the signed-in owner can see this private history. Blizzard&apos;s API gives no encounter data for this game.</p>
      <p>Lifetime progress counts each boss once across difficulties. No data from this character means no permitted history is available, rather than no kills.</p>
      </>}
      <p>Not seen open yet means no upload has seen an entrance or a boss kill here; it is not a Blizzard release announcement. The files can include test and unused content.</p>
      <p>Found in game files, build {PROGRESSION_BUILD}; game data copyright Blizzard Entertainment, Inc. Unconfirmed means players have not agreed on the entry.</p>
      <p>Separately, Blizzard&apos;s <a href="https://news.blizzard.com/en-us/article/24303009/world-of-warcraft-forever-raid-overviewlocations-raid-sizes-and-attunement" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">raid overview</a> announces Barrow Deeps, Hyjal Summit and Onyxia&apos;s Lair for December 9. This is not a complete release schedule or evidence of an observed opening.</p>
    </div>
    {PROGRESSION_GROUPS.map((group) => <section key={group} aria-label={group} className="space-y-3">
      <h3 className="text-lg font-semibold text-fg">{group}</h3>
      <ul className="divide-y divide-line border-y border-line">
        {instances.filter((r) => r.group === group).map((r) => <li key={r.id} data-progression-instance={r.id} className="grid grid-cols-1 gap-3 py-4 md:grid-cols-3 md:items-center">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {links[r.id] ? <Link href={links[r.id]} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{r.name}</Link> : <span className="text-fg">{r.name}</span>}
              {r.unconfirmed && <Badge tone="files" />}
              {!r.typeKnown && <span className="text-xs text-muted">type unconfirmed</span>}
            </div>
            <Badge tone="neutral">{r.availability === "unknown" ? "availability unavailable" : r.availability}</Badge>
          </div>
          <div className="space-y-2">
            <p className="font-mono text-sm tabular-nums text-fg-2">{r.killed === null ? `${r.total} bosses` : `${r.killed} / ${r.total} bosses`}</p>
            {r.killed !== null && <div role="progressbar" aria-label={`${r.name}: bosses ${guild ? "counted" : "killed"}`} aria-valuemin={0} aria-valuemax={r.total} aria-valuenow={r.killed} className="h-1 overflow-hidden bg-line" style={{ borderRadius: SPACE[0] }}>
              <div className="h-1 bg-fg-2" style={{ borderRadius: SPACE[0], width: `${r.total ? r.killed / r.total * 100 : 0}%` }} />
            </div>}
          </div>
          <div className="space-y-2 text-sm">
            <span className="text-fg">{r.state}</span>
            {"threshold" in r && <p className="text-muted">{r.threshold === null ? "size unknown" : `${r.threshold} of the roster`}</p>}
            {r.state === "no data" && <p className="text-muted">no data from this character</p>}
            {r.newestKillDay && <p className="text-muted">Newest kill <time dateTime={r.newestKillDay} className="font-mono tabular-nums">{r.newestKillDay}</time> UTC</p>}
          </div>
        </li>)}
      </ul>
    </section>)}
  </div>;
}
