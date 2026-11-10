import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { Card, Container, DataTable, PageHeader, SectionHeading, type Column } from "@/components/ui";
import { dataAgeLabel } from "@/lib/data-age";
import { factionLabel, guildPath, guildsOn, hideGuildPath, loadGuildPage, realmPath, type GuildMember } from "@/lib/guilds";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import type { AgreedKill } from "../../../../../../kb/src/guilds";
import { className, classText } from "../../../players/player-view";
import { day, decodeSlug, guildRobots, InstanceCard, link, memberCountLine, number, Progress, sourceLabel } from "../../parts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; guild: string }> };

export async function generateMetadata(props: Params): Promise<Metadata> {
  if (!guildsOn()) return {};
  const { slug, guild } = await props.params;
  const [realm, name] = [decodeSlug(slug), decodeSlug(guild)];
  const loaded = realm === null || name === null ? null : await loadGuildPage(realm, name);
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

const none = <span className="text-muted">–</span>;

function memberColumns(withAlts: boolean): Column<GuildMember>[] {
  return [
    { key: "name", header: "Name", cell: (m) => (m.path ? <Link href={m.path} className={`${link} font-medium`}>{m.name}</Link> : <span className="font-medium">{m.name}</span>) },
    { key: "class", header: "Class", nowrap: true, cell: (m) => <span className={classText(m.class)}>{className(m.class)}</span> },
    { key: "level", header: "Level", numeric: true, cell: (m) => m.level },
    { key: "rank", header: "Rank", cell: (m) => m.rank ?? none },
    { key: "seen", header: "Last seen", numeric: true, cell: (m) => (m.lastSeen ? <span className="font-mono tabular-nums">{m.lastSeen}</span> : none) },
    ...(withAlts ? [{
      key: "alts", header: "Alts",
      cell: (m: GuildMember) => (m.alts.length
        ? <span className="flex flex-wrap gap-x-2">{m.alts.map((a) => <Link key={a.path} href={a.path} className={`${link} ${classText(a.class)}`}>{a.name} ({a.level})</Link>)}</span>
        : none),
    }] : []),
  ];
}

const memberMeta = (m: GuildMember) => [`${m.level} ${className(m.class)}`, m.rank, m.lastSeen ? `seen ${m.lastSeen}` : null].filter(Boolean).join(" · ");

export default async function GuildPage(props: Params) {
  if (!guildsOn()) notFound();
  const { slug, guild } = await props.params;
  const [realm, name] = [decodeSlug(slug), decodeSlug(guild)];
  if (realm === null || name === null) notFound();
  const loaded = await loadGuildPage(realm, name);
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
  const { page, board, members } = loaded;
  const { summary, ranks } = page;
  const faction = factionLabel(summary.faction);
  const lastActivity = [summary.latestKillAt?.slice(0, 10), summary.lastSeen].filter((d): d is string => Boolean(d)).sort().at(-1);
  const officerRoster = board?.roster ?? [];
  const memberCount = memberCountLine(board, members.length);
  const withAlts = members.some((m) => m.alts.length > 0);

  return (
    <Container width="data">
      <article>
        <PageHeader
          trail={[
            ...trailFor("/guilds")!, { name: summary.realm, path: realmPath(summary.realm) },
            { name: summary.guildName, path: guildPath(summary.realm, summary.guildName) },
          ]}
          title={summary.guildName}
          lede={`${faction ? `${faction} guild` : "Guild"} on ${summary.realm}`}
          meta={
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              {memberCount && <span>{memberCount}</span>}
              {ranks && <span>Rank {ranks.realm} on the realm and {ranks.overall} overall in {ranks.instanceName}</span>}
              {lastActivity && <span>Last activity {lastActivity}</span>}
              <span>{dataAgeLabel(loaded.dataAsOf)}</span>
            </span>
          }
        />
        <div className="space-y-10">
          {page.progression.length > 0 && (
            <ul aria-label="Progression summary" className="flex flex-wrap gap-x-8 gap-y-2 text-cell">
              {page.progression.map((p) => (
                <li key={p.instanceMapId} className="flex items-center gap-3"><span className="text-fg-2">{p.instanceName}</span><Progress killed={p.killed} bosses={p.bosses} /></li>
              ))}
            </ul>
          )}
          <section aria-labelledby="progression" className="space-y-3">
            <SectionHeading id="progression" note="A kill counts once two members' uploads report it, or when the guild's officers publish it.">Progression</SectionHeading>
            {page.progression.length === 0
              ? <p className="text-sm text-fg-2">No agreed kill yet.</p>
              : <div className="grid gap-4 md:grid-cols-2 lg:gap-6">{page.progression.map((p) => <InstanceCard key={p.instanceMapId} progress={p} />)}</div>}
          </section>

          <section aria-labelledby="roster" className="space-y-3">
            <SectionHeading id="roster" note={members.length > 0 ? `${number(members.length)} listed` : undefined}>Members</SectionHeading>
            {board && loaded.namesWithheld && (
              <p className="text-sm text-fg-2">The officers&apos; roster is not shown right now: it could not be checked against the characters who asked to be hidden.</p>
            )}
            {members.length > 0 && (
              <>
                <p className="text-sm text-fg-2">
                  {officerRoster.length > 0 ? "Ranks come from the roster the officers published. " : ""}
                  {page.seenRoster.length > 0 ? `Last seen is the day the addon saw the character in this guild (${number(page.seenRoster.length)} seen). ` : ""}
                  {officerRoster.length === 0 ? "Not a member list from the game." : ""}
                </p>
                <DataTable dense caption="Members of this guild" columns={memberColumns(withAlts)} rows={members} rowKey={(m) => `${m.realm}/${m.name}`} meta={memberMeta} />
              </>
            )}
            {members.length === 0 && (
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

