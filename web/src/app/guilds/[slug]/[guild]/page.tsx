import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Container, DataTable, PageHeader, SectionHeading, type Column } from "@/components/ui";
import { dataAgeLabel } from "@/lib/data-age";
import { factionLabel, guildPath, guildsOn, hideGuildPath, loadGuildPage } from "@/lib/guilds";
import { playerPath, rulesetOf } from "@/lib/player-pages";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import type { AgreedKill, GuildProgress, SeenMember } from "../../../../../../kb/src/guilds";
import { className, classText } from "../../../players/player-view";
import { day, guildRobots, link, number, Progress, sourceLabel } from "../../parts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; guild: string }> };

export async function generateMetadata(props: Params): Promise<Metadata> {
  if (!guildsOn()) return {};
  const { slug, guild } = await props.params;
  const loaded = await loadGuildPage(decodeURIComponent(slug), decodeURIComponent(guild));
  if (!loaded || loaded === "unreachable") return { robots: { index: false, follow: false } };
  const { summary } = loaded.page;
  return {
    ...pageMetadata({
      title: `${summary.guildName} – WoW Forever Guild on ${summary.realm}`,
      description: `${summary.guildName} on ${summary.realm}: bosses killed per raid with the day each fell, characters seen in the guild and its recent kills, from Everloot addon uploads.`,
      path: guildPath(summary.realm, summary.guildName),
    }),
    robots: guildRobots(),
  };
}

const killColumns: Column<AgreedKill>[] = [
  { key: "day", header: "Day", nowrap: true, cell: (k) => <span className="font-mono tabular-nums">{day(k.killedAt)}</span> },
  { key: "boss", header: "Boss", cell: (k) => <span className="font-medium">{k.name}</span> },
  { key: "source", header: "Reported by", nowrap: true, cell: (k) => sourceLabel(k.source) },
];

const seenColumns: Column<SeenMember>[] = [
  { key: "name", header: "Name", cell: (p) => <Link href={playerPath({ ruleset: rulesetOf(p.realm), realm: p.realm, name: p.name })} className={`${link} font-medium`}>{p.name}</Link> },
  { key: "class", header: "Class", nowrap: true, cell: (p) => <span className={classText(p.class)}>{className(p.class)}</span> },
  { key: "level", header: "Level", numeric: true, cell: (p) => p.level },
  { key: "seen", header: "Last seen", numeric: true, cell: (p) => <span className="font-mono tabular-nums">{p.lastSeen}</span> },
];

type OfficerMember = { name: string; rank: string; level: number; className: string };
const officerColumns: Column<OfficerMember>[] = [
  { key: "name", header: "Name", cell: (m) => <span className="font-medium">{m.name}</span> },
  { key: "rank", header: "Rank", cell: (m) => m.rank },
  { key: "level", header: "Level", numeric: true, cell: (m) => m.level },
  { key: "class", header: "Class", nowrap: true, cell: (m) => m.className },
];

export default async function GuildPage(props: Params) {
  if (!guildsOn()) notFound();
  const { slug, guild } = await props.params;
  const loaded = await loadGuildPage(decodeURIComponent(slug), decodeURIComponent(guild));
  if (loaded === null) notFound();
  if (loaded === "unreachable") {
    return (
      <Container width="data">
        <article className="space-y-6">
          <PageHeader title="Guild" />
          <Card><p className="text-fg-2">{STORAGE_UNREACHABLE}</p></Card>
        </article>
      </Container>
    );
  }
  const { page, board } = loaded;
  const { summary, ranks } = page;
  const faction = factionLabel(summary.faction);
  const lastActivity = [summary.latestKillAt?.slice(0, 10), summary.lastSeen].filter((d): d is string => Boolean(d)).sort().at(-1);
  const officerRoster = board?.roster ?? [];

  return (
    <Container width="data">
      <article>
        <PageHeader
          trail={[{ name: "Home", path: "/" }, { name: "Guilds", path: "/guilds" }, { name: summary.guildName, path: guildPath(summary.realm, summary.guildName) }]}
          title={summary.guildName}
          lede={`${faction ? `${faction} guild` : "Guild"} on ${summary.realm}`}
          meta={
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              {ranks && <span>Rank {ranks.realm} on the realm and {ranks.overall} overall in {ranks.instanceName}</span>}
              {lastActivity && <span>Last activity {lastActivity}</span>}
              <span>{dataAgeLabel(loaded.dataAsOf)}</span>
            </span>
          }
        />
        <div className="space-y-10">
          <section aria-labelledby="progression" className="space-y-3">
            <SectionHeading id="progression" note="A kill counts once two members' uploads report it, or when the guild's officers publish it.">Progression</SectionHeading>
            {page.progression.length === 0
              ? <p className="text-sm text-fg-2">No agreed kill yet.</p>
              : <div className="grid gap-4 md:grid-cols-2 lg:gap-6">{page.progression.map((p) => <InstanceCard key={p.instanceMapId} progress={p} />)}</div>}
          </section>

          <section aria-labelledby="roster" className="space-y-6">
            <SectionHeading id="roster">Roster</SectionHeading>
            {officerRoster.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-cell font-medium text-fg">Published by the officers{board?.memberCount ? ` (${number(board.memberCount)} members)` : ""}</h3>
                <DataTable dense caption="The officers' published roster" columns={officerColumns} rows={officerRoster} rowKey={(m) => m.name} meta={(m) => `${m.rank} · ${m.level} ${m.className}`} />
              </div>
            )}
            {page.seenRoster.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-cell font-medium text-fg">Seen in this guild ({number(page.seenRoster.length)})</h3>
                <p className="text-sm text-fg-2">Characters the addon saw in this guild. Not a member list from the game.</p>
                <DataTable dense caption="Characters seen in this guild" columns={seenColumns} rows={page.seenRoster} rowKey={(p) => `${p.realm}/${p.name}`} meta={(p) => `${p.level} ${className(p.class)} · ${p.lastSeen}`} />
              </div>
            )}
            {officerRoster.length === 0 && page.seenRoster.length === 0 && (
              <p className="text-sm text-fg-2">
                {summary.membersSeen === null ? "Characters seen in guilds are not shown on this site yet." : "No character has been seen in this guild yet."}
              </p>
            )}
          </section>

          {page.activity.length > 0 && (
            <section aria-labelledby="activity" className="space-y-3">
              <SectionHeading id="activity" note="Newest first. Officers' kills carry no date and are listed under Progression only.">Activity</SectionHeading>
              <DataTable dense caption="Agreed kills, newest first" columns={killColumns} rows={page.activity} rowKey={(k) => `${k.instanceMapId}/${k.encounterId}`} meta={(k) => `${day(k.killedAt)} · ${sourceLabel(k.source)}`} />
            </section>
          )}

          {board && (board.loot.length > 0 || board.present.length > 0) && (
            <section aria-labelledby="loot" className="space-y-3">
              <SectionHeading id="loot" note="Published by the guild's officers.">Loot and attendance</SectionHeading>
              {board.loot.length > 0 && (
                <ul className="space-y-1 text-cell text-fg-2">
                  {board.loot.map((l) => <li key={`${l.itemId}/${l.recipient}/${l.sourceBoss}`}><Link href={`/database/items/${l.itemId}`} className={link}>Item {l.itemId}</Link> to {l.recipient}, from {l.sourceBoss}</li>)}
                </ul>
              )}
              {board.present.length > 0 && <p className="text-cell text-fg-2">Present at the last raid: {board.present.join(", ")}.</p>}
            </section>
          )}

          <p className="text-sm text-muted">
            <Link href={hideGuildPath(summary.realm, summary.guildName)} className={link}>Hide this guild</Link> · <Link href="/methodology#guilds" className={link}>How guilds are counted</Link> · <Link href="/guilds" className={link}>All guilds</Link>
          </p>
        </div>
      </article>
    </Container>
  );
}

/** One instance: bosses killed out of its bosses, then each boss with the day it fell and who reported it; unkilled bosses muted. */
function InstanceCard({ progress }: { progress: GuildProgress }) {
  const id = `instance-${progress.instanceMapId}`;
  return (
    <Card as="section" padding="none" aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4 sm:px-6 sm:pt-5">
        <h3 id={id} className="text-h2-sm text-fg">{progress.instanceName}</h3>
        <Progress killed={progress.killed} bosses={progress.bosses} />
      </div>
      <ol className="mt-3 border-t border-line">
        {progress.list.map((b) => (
          <li key={b.encounterId} className={`flex min-h-row items-center gap-3 border-b border-line px-4 text-cell last:border-b-0 sm:px-6 ${b.killed ? "text-fg" : "text-muted"}`}>
            <span className="min-w-0 flex-1 truncate">{b.name}</span>
            {b.killed && <span className="shrink-0 text-cell-2 text-fg-2">{b.killedAt ? day(b.killedAt) : ""}{b.killedAt && b.source ? " · " : ""}{sourceLabel(b.source)}</span>}
            {!b.killed && <span className="shrink-0 text-cell-2">Not yet</span>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
