import type { GuildProgress } from "@kb/guild-progression";
import Link from "@/components/Link";
import { PROGRESSION_BUILD, PROGRESSION_GROUPS, trackedDungeons, type CharacterProgress } from "@kb/progression";
import type { ReactNode } from "react";
import { Badge, Disclosure } from "@/components/ui";
import { SPACE } from "@/design/tokens";

/** "1 boss", "8 bosses". */
const bosses = (n: number) => `${n} ${n === 1 ? "boss" : "bosses"}`;

export interface ProgressionMatrixProps {
  instances: readonly (CharacterProgress | GuildProgress)[];
  guild?: boolean;
  /** Only pages the site's instance route actually serves. */
  links?: Readonly<Record<number, string>>;
  /**
   * The notes on how kills are counted; off for a second list on the same page; "folded": the first line, the rest
   * behind a disclosure; "tucked": every line behind it, for a page that says the first in its own words.
   */
  notes?: boolean | "folded" | "tucked";
  /** The instance list closed behind a disclosure with this summary: a list that would be all "no data". */
  collapsed?: string;
}

const tracked = new Set(trackedDungeons().map((dungeon) => dungeon.id));

/**
 * The instances a character's Progress tab and a guild's Progression list. A map the files give no name or place ("Instance 3002") is left
 * out, and so is a small map that shares a raid's name (map 2921, "Naxxramas" with one boss, beside raid 533), so the
 * raid shows once under Raids. A row with a kill recorded always stays.
 */
export function shownProgress<R extends ProgressionMatrixProps["instances"][number]>(rows: readonly R[]): R[] {
  const raids = new Set(rows.filter((r) => r.group === "Raids").map((r) => r.name));
  return rows.filter((r) => ("killed" in r && (r.killed ?? 0) > 0) || (r.typeKnown && !(r.group !== "Raids" && raids.has(r.name))));
}

export default function ProgressionMatrix({ instances, links = {}, guild = false, notes = true, collapsed }: ProgressionMatrixProps) {
  const groups = PROGRESSION_GROUPS.filter((group) => instances.some((r) => r.group === group)).map((group) => <section key={group} aria-label={group} className="space-y-3">
      <h3 className="text-lg font-semibold text-fg">{group}</h3>
      <ul className="divide-y divide-line border-y border-line">
        {instances.filter((r) => r.group === group).map((r) => <li key={r.id} data-progression-instance={r.id} className="grid grid-cols-1 gap-3 py-4 md:grid-cols-3 md:items-center">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {links[r.id] ? <Link href={links[r.id]} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{r.name}</Link> : <span className="text-fg">{r.name}</span>}
              {!r.typeKnown && <span className="text-xs text-muted">type unconfirmed</span>}
            </div>
            <div className="flex flex-wrap gap-1">
              <Badge tone="neutral">{r.availability === "unknown" ? "availability unavailable" : r.availability}{r.unconfirmed && ` · ${r.group === "World bosses" ? "boss" : "instance"} unconfirmed`}</Badge>
              {!guild && tracked.has(r.id) && <Badge tone="neutral">Tracked dungeon</Badge>}
            </div>
          </div>
          <div className="space-y-2">
            <p className="font-mono text-sm tabular-nums text-fg-2">{r.killed === null ? bosses(r.total) : `${r.killed} / ${bosses(r.total)}`}</p>
            {r.killed !== null && <div role="progressbar" aria-label={`${r.name}: bosses ${guild ? "counted" : "killed"}`} aria-valuemin={0} aria-valuemax={r.total} aria-valuenow={r.killed} className="h-1 overflow-hidden bg-line" style={{ borderRadius: SPACE[0] }}>
              <div className="h-1 bg-fg-2" style={{ borderRadius: SPACE[0], width: `${r.total ? r.killed / r.total * 100 : 0}%` }} />
            </div>}
            {"defeated" in r && r.bosses.length > 0 && <details className="text-sm text-fg-2">
              <summary className="cursor-pointer">Boss checklist</summary>
              <ul className="mt-2 space-y-1">
                {r.bosses.map((boss) => <li key={boss.id}>{boss.name}{r.killed !== null && (
                  <span className="text-muted"> · {r.defeated.includes(boss.id) ? "Defeated" : "No kill recorded"}</span>
                )}</li>)}
              </ul>
            </details>}
          </div>
          <div className="space-y-2 text-sm">
            <span className="text-fg">{r.state}</span>
            {"threshold" in r && <p className="text-muted">{r.threshold === null ? "size unknown" : `${r.threshold} of the roster`}</p>}
            {r.state === "no data" && <p className="text-muted">no data from this character</p>}
            {r.newestKillDay && <p className="text-muted">Newest kill <time dateTime={r.newestKillDay} className="font-mono tabular-nums">{r.newestKillDay}</time> UTC</p>}
          </div>
        </li>)}
      </ul>
    </section>);
  return <div className="space-y-6">
    {notes && <Fold folded={notes === "folded"} tucked={notes === "tucked"} first={guild
      ? <p>Counts synced kills from every linked character in the armory roster; members without synced history count as not having the kill.</p>
      : <p>Kills come from linked characters through the Everloot Desktop App. Synced boss history is public; hidden characters are excluded. Blizzard&apos;s API gives no encounter data for this game.</p>}>
      {!guild && <>
      <p>Lifetime progress counts each boss once across difficulties. No data from this character means no synced history is available, rather than no kills.</p>
        <p>A tracked dungeon counts as cleared when every boss on its supported checklist is recorded.</p>
      </>}
      <p>Not seen open yet means no upload has seen an entrance or a boss kill here; it is not a Blizzard release announcement. The files can include test and unused content.</p>
      <p>Found in game files, build {PROGRESSION_BUILD}; game data copyright Blizzard Entertainment, Inc. Unconfirmed means players have not agreed on the entry.</p>
      <p>Separately, Blizzard&apos;s <a href="https://news.blizzard.com/en-us/article/24303009/world-of-warcraft-forever-raid-overviewlocations-raid-sizes-and-attunement" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">raid overview</a> announces Barrow Deeps, Hyjal Summit and Onyxia&apos;s Lair for December 9. This is not a complete release schedule or evidence of an observed opening.</p>
    </Fold>}
    {collapsed ? <Disclosure as="h3" summary={collapsed} wide><div className="space-y-6">{groups}</div></Disclosure> : groups}
  </div>;
}

/** The notes: every line shown, or the first with the rest behind "How this is counted". */
function Fold({ folded, tucked, first, children }: { folded: boolean; tucked: boolean; first: ReactNode; children: ReactNode }) {
  if (tucked) return <Disclosure summary="How this is counted"><div className="space-y-2 text-sm text-fg-2">{first}{children}</div></Disclosure>;
  return <div className="space-y-2 text-sm text-fg-2">
    {first}
    {folded ? <Disclosure summary="How this is counted"><div className="space-y-2 text-sm text-fg-2">{children}</div></Disclosure> : children}
  </div>;
}
