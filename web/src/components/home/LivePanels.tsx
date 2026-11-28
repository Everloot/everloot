import Link from "@/components/Link";
import type { ReactNode } from "react";
import { Card, QUALITY_TEXT, SectionHeading } from "@/components/ui";
import GameIcon from "@/components/game/GameIcon";
import { CLASS_BG, classColour } from "@/components/ui/class-colour";
import { Movers, Swatch, percent } from "@/app/rankings/parts";
import { Progress } from "@/app/guilds/parts";
import { guildPath, LADDER_LINE, START_LINE as LADDER_START_LINE } from "@/lib/guilds";
import { COLLECTING_LINE, START_LINE as RANKINGS_START_LINE } from "@/lib/rankings";
import { utcDay } from "@/lib/time";
import type { HomeFact, HomeLadder, HomeWeek } from "@/lib/home-live";

/**
 * The landing page's live row, right under the hero: what reached three installs last, the top of the guild ladder,
 * and who played this week. Each panel takes its own read: null when that read failed (the panel says so, the others
 * still show); the ladder is undefined while the guild pages are off, and then it is left out.
 */

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const KIND: Record<HomeFact["kind"], string> = { item: "Item", npc: "NPC", quest: "Quest", object: "Object", boss: "Boss", entrance: "Entrance" };

function Panel({ id, title, action, note, children }: { id: string; title: string; action: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <Card as="section" aria-labelledby={id} data-live-panel={id} className="flex flex-col">
      <SectionHeading id={id} action={action} note={note}>{title}</SectionHeading>
      {children}
    </Card>
  );
}

const Unread = ({ what }: { what: string }) => <p role="status" className="text-cell text-fg-2">{what} could not be read just now.</p>;

/** Also the /database hub's "Recently confirmed" strip, under its own id and title. */
export function NewestPanel({ facts, id = "live-newest", title = "Newly confirmed" }: { facts: HomeFact[] | null; id?: string; title?: string }) {
  return (
    <Panel id={id} title={title} note="Just confirmed by three installs." action={<Link href="/database/recent" prefetch={false} className={link}>All new facts →</Link>}>
      {facts === null ? <Unread what="The newest facts" /> : facts.length === 0 ? <p className="text-cell text-fg-2">No new public facts in the last 30 days.</p> : (
        <ol className="border-t border-line">
          {facts.map((f) => (
            <li key={`${f.kind}:${f.id}`} className="flex min-h-row items-center gap-2 border-b border-line text-cell last:border-b-0">
              {f.icon && <GameIcon src={f.icon} size={18} quality={f.quality ?? undefined} />}
              <span className="min-w-0 flex-1 truncate">
                <Link href={f.path} prefetch={false} className={f.quality ? `${QUALITY_TEXT[f.quality]} underline decoration-edge underline-offset-4 hover:decoration-fg` : link}>{f.name}</Link>
                <span className="ml-1.5 text-cell-2 text-muted">{KIND[f.kind]}</span>
              </span>
              <time dateTime={f.publicAt} className="shrink-0 font-mono text-cell-2 tabular-nums text-fg-2" title={f.estimated ? "Estimated: the third report's capture day" : undefined}>
                {utcDay(f.publicAt) ?? f.publicAt.slice(0, 10)}{f.estimated && <span className="text-muted"> est.</span>}
              </time>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function LadderPanel({ ladder }: { ladder: HomeLadder | null }) {
  return (
    <Panel
      id="live-ladder"
      title="Guild ladder"
      note={ladder?.instance ? <>{ladder.instance.name}: bosses killed, then who got there first.</> : "Built from boss kills that two members' addons report."}
      action={<Link href="/guilds" prefetch={false} className={link}>Full ladder →</Link>}
    >
      {ladder === null ? <Unread what="The guild ladder" /> : !ladder.instance ? <p className="text-cell text-fg-2">{ladder.raidsOpen ? LADDER_START_LINE : LADDER_LINE}</p> : (
        <>
          <ol className="border-t border-line">
            {ladder.rows.map((r) => (
              <li key={r.key} className="flex min-h-row items-center gap-3 border-b border-line text-cell last:border-b-0">
                <span className="w-5 shrink-0 text-right font-mono tabular-nums text-muted">{r.rank}</span>
                <span className="min-w-0 flex-1 truncate">
                  <Link href={guildPath(r.realm, r.guildName)} prefetch={false} className={`${link} font-medium`}>{r.guildName}</Link>
                  <span className="ml-1.5 text-cell-2 text-muted">{r.realm}</span>
                </span>
                <Progress killed={r.killed} bosses={r.bosses} className="shrink-0" />
              </li>
            ))}
          </ol>
          {ladder.total > ladder.rows.length && <p className="mt-2 text-meta text-muted"><span className="tabular-nums">{ladder.total.toLocaleString("en-US")}</span> guilds on this ladder.</p>}
        </>
      )}
    </Panel>
  );
}

function WeekPanel({ week }: { week: HomeWeek | null }) {
  // The census page opens on a rolling 7 days, this panel on the calendar week: say so, so the shares do not read as a contradiction.
  const label = week?.week ? (week.week.current ? `So far this week, from ${utcDay(week.week.start) ?? week.week.start}.` : `Week of ${utcDay(week.week.start) ?? week.week.start}.`) : undefined;
  const differs = "The census page counts the last 7 days, so its shares can differ.";
  return (
    <Panel id="live-week" title="This week" note={`${label ? `${label} ` : ""}Characters by class, from players who turned the census on. ${differs}`} action={<Link href="/rankings" prefetch={false} className={link}>Rankings →</Link>}>
      {week === null ? <Unread what="The census" /> : !week.week ? <p className="text-cell text-fg-2">{RANKINGS_START_LINE}</p> : week.classes.length === 0 ? <p className="text-cell text-fg-2">{COLLECTING_LINE}</p> : (
        <>
          {/* The bar is decoration; the list under it carries every share. */}
          <div aria-hidden="true" data-class-share className="flex h-3 w-full overflow-hidden rounded-full bg-line">
            {week.classes.map((c) => <span key={c.key} className={`block h-3 ${classColour(CLASS_BG, c.classToken)}`} style={{ width: percent(c.share) }} />)}
          </div>
          <ul aria-label="Share of characters by class" className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-cell-2 sm:grid-cols-3">
            {week.classes.map((c) => (
              <li key={c.key} className="flex items-center gap-1.5">
                <Swatch classToken={c.classToken} />
                <span className="min-w-0 truncate text-fg-2">{c.label}</span>
                <span className="ml-auto font-mono tabular-nums text-fg">{percent(c.share)}</span>
              </li>
            ))}
          </ul>
          {week.classHidden && <p className="mt-2 text-meta text-muted">Classes with too few reports are left out.</p>}
          <h3 className="mb-1 mt-4 text-meta font-medium text-fg">Top movers</h3>
          {week.movers === null ? <p className="text-cell text-fg-2">Movers show once a week before has numbers to compare.</p> : <Movers movers={week.movers} />}
        </>
      )}
    </Panel>
  );
}

export default function LivePanels({ newest, ladder, week }: { newest: HomeFact[] | null; ladder: HomeLadder | null | undefined; week: HomeWeek | null }) {
  return (
    <div data-live-row className={`grid gap-4 ${ladder === undefined ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
      <NewestPanel facts={newest} />
      {ladder !== undefined && <LadderPanel ladder={ladder} />}
      <WeekPanel week={week} />
    </div>
  );
}
