import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { pageMetadata } from "@/lib/seo";
import { trailFor } from "@/lib/breadcrumbs";
import { optOutPath, playerPagesOn, playerPath, searchPrefix, type Player } from "@/lib/player-pages";
import { playerStore } from "@/lib/player-store";
import { Container, DataTable, Input, PageHeader, SectionHeading, type Column } from "@/components/ui";
import { className, classText, describePlayer, PLAYER_SEARCH_TAG, playerRobots, raceName } from "./player-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { searchParams: Promise<{ q?: string | string[] }> }): Promise<Metadata> {
  const params = await props.searchParams;
  return {
    ...pageMetadata({ title: "Find a player", description: "Look up a WoW: Forever character by the start of its name: the race, class, level and guild the Everloot addon last saw, and the day it saw them.", path: "/players" }),
    robots: playerRobots(Boolean(params.q)),
  };
}

/** One search per prefix is kept five minutes, so a repeated search never reaches the database again. */
const search = unstable_cache((prefix: string) => playerStore().search(prefix), ["player-search"], { revalidate: 300, tags: [PLAYER_SEARCH_TAG] });

const link = "text-accent hover:underline underline-offset-4";
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// The hide link sits with the name, the one column a phone shows.
const columns: Column<Player>[] = [
  {
    key: "name",
    header: "Name",
    cell: (p) => (
      <span className="inline-flex min-w-0 items-baseline gap-3">
        <Link href={playerPath(p)} className={`${link} font-medium`}>{p.name}</Link>
        <Link href={optOutPath(p)} className="text-xs text-muted hover:underline underline-offset-4">Hide</Link>
      </span>
    ),
  },
  { key: "class", header: "Class", nowrap: true, cell: (p) => <span className={classText(p.class)}>{className(p.class)}</span> },
  { key: "race", header: "Race", nowrap: true, cell: (p) => raceName(p.race) },
  { key: "level", header: "Level", numeric: true, cell: (p) => p.level },
  { key: "guild", header: "Guild", cell: (p) => p.guild ?? <span className="text-muted">None seen</span> },
  { key: "realm", header: "Realm", cell: (p) => p.realm },
  { key: "seen", header: "Last seen", nowrap: true, cell: (p) => <span className="font-mono tabular-nums">{p.lastSeen}</span> },
];

export default async function PlayersPage(props: { searchParams: Promise<{ q?: string | string[] }> }) {
  if (!playerPagesOn()) notFound();
  const params = await props.searchParams;
  const q = (first(params.q) ?? "").trim().slice(0, 40);
  const prefix = q ? searchPrefix(q) : null;
  const results = prefix ? await search(prefix.toLowerCase()) : null;

  return (
    <Container width="reading">
      <article className="space-y-6">
        <PageHeader
          trail={trailFor("/players") ?? undefined}
          title="Find a player"
          lede="Characters the Everloot addon has seen, by the start of their name. Each page shows what the addon last saw: race, class, level, guild and the day. Not where they were, what they wear or what they did."
          meta={<span>To have a character removed, use the hide link on its page or the <Link href="/players/opt-out" className={link}>hide form</Link>.</span>}
        />

        <form action="/players" method="get" role="search" className="flex max-w-xl flex-col gap-2 sm:flex-row">
          <label htmlFor="player-q" className="sr-only">Character name</label>
          <Input id="player-q" name="q" type="search" defaultValue={q} maxLength={40} autoComplete="off" placeholder="Start of a name, 2 letters or more" className="flex-1" />
          <button type="submit" className="btn btn-primary min-h-11">Search</button>
        </form>

        {q && !prefix && <p className="text-sm text-fg-2">Type 2 to 12 letters. Names have no digits or spaces.</p>}
        {results && results.length === 0 && <p className="text-sm text-fg-2">No character starts with &ldquo;{prefix}&rdquo;. The addon has not seen one, or it was hidden.</p>}
        {results && results.length > 0 && (
          <section aria-labelledby="player-results" className="space-y-3">
            <SectionHeading id="player-results">
              {results.length === 25 ? "The first 25 names" : `${results.length} ${results.length === 1 ? "name" : "names"}`} starting with &ldquo;{prefix}&rdquo;
            </SectionHeading>
            <DataTable
              dense
              caption={`Characters whose name starts with ${prefix}`}
              columns={columns}
              rows={results}
              rowKey={(p) => `${p.realm}/${p.name}`}
              meta={(p) => `${describePlayer(p)} · ${p.realm}`}
            />
            {results.length === 25 && <p className="text-sm text-muted">Type more of the name to narrow it down.</p>}
          </section>
        )}
      </article>
    </Container>
  );
}
