import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Container, DataTable, PageHeader, ResultStrip, SectionHeading, type Column } from "@/components/ui";
import { dataAgeLabel } from "@/lib/data-age";
import { guildPath, loadRealmPage, REALM_PAGE, realmPath } from "@/lib/guilds";
import { REALM_GUILD_LIMIT } from "@/lib/player-store";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import type { GuildSummary } from "../../../../../kb/src/guilds";
import { day, FactionMark, guildRobots, link, number } from "../parts";

/** A realm's guild list (/guilds/<realm>): every guild seen on it, behind EVERLOOT_GUILDS like the other guild pages. */

const pageOf = (raw: string | string[] | undefined): number => {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 1 ? n : 1;
};

export async function realmMetadata(slug: string, search: Record<string, string | string[] | undefined>): Promise<Metadata> {
  const loaded = await loadRealmPage(slug);
  if (!loaded || loaded === "unreachable") return { robots: { index: false, follow: false } };
  return {
    ...pageMetadata({
      title: `WoW Forever Guilds on ${loaded.realm}`,
      description: `${number(loaded.guilds.length)} guilds on ${loaded.realm}, by members seen: each guild's faction, how many characters the Everloot addon saw in it and when.`,
      path: realmPath(loaded.realm),
    }),
    robots: guildRobots(Object.keys(search).length > 0),
  };
}

/** The newest day the guild was seen: a member's sighting or its latest agreed kill. */
const lastSeen = (g: GuildSummary) => [g.lastSeen, day(g.latestKillAt)].filter(Boolean).sort().at(-1) ?? null;

const columns: Column<GuildSummary>[] = [
  { key: "guild", header: "Guild", cell: (g) => <Link href={guildPath(g.realm, g.guildName)} className={`${link} font-medium`}>{g.guildName}</Link> },
  { key: "faction", header: "Faction", nowrap: true, cell: (g) => <FactionMark faction={g.faction} /> },
  { key: "seen", header: "Members seen", numeric: true, cell: (g) => (g.membersSeen === null ? <span className="text-muted">Not counted</span> : number(g.membersSeen)) },
  { key: "last", header: "Last seen", numeric: true, cell: (g) => <span className="font-mono tabular-nums">{lastSeen(g) ?? ""}</span> },
];

const meta = (g: GuildSummary) => [g.membersSeen === null ? null : `${number(g.membersSeen)} seen`, lastSeen(g)].filter(Boolean).join(" · ");

export async function RealmGuilds({ slug, search }: { slug: string; search: Record<string, string | string[] | undefined> }) {
  const loaded = await loadRealmPage(slug);
  if (loaded === null) notFound();
  if (loaded === "unreachable") {
    return (
      <Container width="data">
        <article className="space-y-6">
          <PageHeader trail={[{ name: "Home", path: "/" }, { name: "Guilds", path: "/guilds" }]} title="Realm" />
          <Card><p className="text-fg-2">{STORAGE_UNREACHABLE}</p></Card>
        </article>
      </Container>
    );
  }
  const { realm, guilds } = loaded;
  const pages = Math.max(1, Math.ceil(guilds.length / REALM_PAGE));
  const page = Math.min(pageOf(search.page), pages);
  const rows = guilds.slice((page - 1) * REALM_PAGE, page * REALM_PAGE);
  const href = (p: number) => (p > 1 ? `${realmPath(realm)}?page=${p}` : realmPath(realm));

  return (
    <Container width="data">
      <article>
        <PageHeader
          trail={[{ name: "Home", path: "/" }, { name: "Guilds", path: "/guilds" }, { name: realm, path: realmPath(realm) }]}
          title={`Guilds on ${realm}`}
          lede="Every guild the Everloot addon has seen on this realm, from members' uploads and officer boards."
          meta={<span>{dataAgeLabel(loaded.dataAsOf)}</span>}
        />
        <section aria-labelledby="realm-guilds" className="space-y-3">
          <SectionHeading id="realm-guilds" note="Most members seen first. Members seen are characters the addon saw in the guild, not the game's member list.">
            Guilds
          </SectionHeading>
          <ResultStrip total={guilds.length} noun={guilds.length === 1 ? "guild" : "guilds"} page={page} perPage={REALM_PAGE} href={href} />
          {loaded.capped && (
            <p className="text-sm text-fg-2">Showing the {number(REALM_GUILD_LIMIT)} guilds with the most members seen, plus any known from kills or officer boards.</p>
          )}
          <DataTable dense caption={`Guilds on ${realm}`} columns={columns} rows={rows} rowKey={(g) => g.key} meta={meta} />
          {pages > 1 && <ResultStrip total={guilds.length} noun={guilds.length === 1 ? "guild" : "guilds"} page={page} perPage={REALM_PAGE} href={href} />}
        </section>
        <p className="mt-6 text-sm text-muted">
          <Link href="/methodology#guilds" className={link}>How guilds are counted</Link> · <Link href="/guilds/hide" className={link}>Hide a guild</Link> · <Link href="/guilds" className={link}>All guilds</Link>
        </p>
      </article>
    </Container>
  );
}
