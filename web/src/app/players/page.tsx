import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import { ARMORY_HIDE_PATH, ARMORY_SUBMIT_PATH, armoryNameQuery, armoryOn } from "@/lib/armory";
import { armoryStore, type ArmoryHit } from "@/lib/armory-store";
import { mergeLookup, SOURCE_LABEL, type LookupRow } from "@/lib/character-lookup";
import { absoluteUrl, pageMetadata } from "@/lib/seo";
import { trailFor } from "@/lib/breadcrumbs";
import { playerPagesOn, searchPrefix, type Player } from "@/lib/player-pages";
import { searchPlayers } from "@/lib/people-search";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { Container, DataTable, Input, PageHeader, SectionHeading, type Column } from "@/components/ui";
import { className, classText, playerRobots, raceName } from "./player-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { searchParams: Promise<{ q?: string | string[] }> }): Promise<Metadata> {
  const params = await props.searchParams;
  return {
    ...pageMetadata({ title: "Find a player", description: "Look up a WoW: Forever character by name: the characters the Everloot addon has seen and the profiles read from Blizzard's API, in one list.", path: "/players" }),
    robots: playerRobots(Boolean(params.q)),
  };
}

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** The most rows each lookup returns: the players store's own cap, and the armory search's. */
const LIMIT = 25;

function Sources({ row }: { row: LookupRow }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {row.sources.map((s) => <span key={s} className="whitespace-nowrap rounded-control border border-edge px-1.5 text-meta text-fg-2">{SOURCE_LABEL[s]}</span>)}
    </span>
  );
}

// The hide link sits with the name, the one column a phone shows.
const columns: Column<LookupRow>[] = [
  {
    key: "name",
    header: "Name",
    cell: (r) => (
      <span className="inline-flex min-w-0 items-baseline gap-3">
        <Link href={r.href} className={`${link} font-medium`}>{r.name}</Link>
        <Link href={r.hideHref} className="text-xs text-muted hover:underline underline-offset-4">Hide</Link>
      </span>
    ),
  },
  { key: "source", header: "Source", cell: (r) => <Sources row={r} /> },
  { key: "class", header: "Class", nowrap: true, cell: (r) => <span className={classText(r.classToken)}>{className(r.classToken)}</span> },
  { key: "race", header: "Race", nowrap: true, cell: (r) => raceName(r.race) },
  { key: "level", header: "Level", numeric: true, cell: (r) => r.level },
  { key: "guild", header: "Guild", cell: (r) => r.guild ?? <span className="text-muted">None seen</span> },
  { key: "realm", header: "Realm", cell: (r) => r.where },
  { key: "seen", header: "Last seen", nowrap: true, cell: (r) => (r.lastSeen ? <span className="font-mono tabular-nums">{r.lastSeen}</span> : null) },
];

/** A lookup's rows, or null when its storage could not be read. */
async function read<T>(run: () => Promise<T[]>): Promise<T[] | null> {
  try { return await run(); } catch { return null; }
}

export default async function PlayersPage(props: { searchParams: Promise<{ q?: string | string[] }> }) {
  const seen = playerPagesOn();
  const armory = armoryOn();
  if (!seen && !armory) notFound();
  const params = await props.searchParams;
  // Room for a full name: a 12-letter first name, a space and a 24-letter surname.
  const q = (first(params.q) ?? "").trim().slice(0, 40);
  const prefix = seen && q ? searchPrefix(q) : null;
  const fullName = armory && q ? armoryNameQuery(q) : null;
  const [players, hits] = await Promise.all([
    prefix ? read<Player>(() => searchPlayers(prefix.toLowerCase())) : [],
    fullName ? read<ArmoryHit>(() => armoryStore().search(fullName, LIMIT)) : [],
  ]);
  const searched = Boolean(prefix || fullName);
  const rows = searched ? mergeLookup(players ?? [], hits ?? []) : null;
  const unreachable = players === null || hits === null;
  const capped = (players?.length ?? 0) >= LIMIT || (hits?.length ?? 0) >= LIMIT;
  // A full name the armory has not read yet: /search can ask Blizzard for it now (its lookup on a miss).
  const askBlizzard = fullName?.includes(" ") && hits !== null && hits.length === 0;

  return (
    <Container width="reading">
      <article className="space-y-6">
        <JsonLd data={{ "@context": "https://schema.org", "@type": "WebPage", name: "Find a player", url: absoluteUrl("/players") }} />
        <PageHeader
          trail={trailFor("/players") ?? undefined}
          title="Find a player"
          lede={[
            seen && "Characters the Everloot addon has seen: race, class, level, guild and the day it saw them. Not where they were, what they wear or what they did.",
            armory && "Characters read from Blizzard's API, with their gear, on the Blizzard profile pages.",
          ].filter(Boolean).join(" ")}
          meta={<span>To have a character removed, use the hide link next to it{seen && <>, the <Link href="/players/opt-out" className={link}>hide form</Link></>}{armory && <>{seen ? " or" : ", or"} the <Link href={ARMORY_HIDE_PATH} className={link}>Blizzard profile hide form</Link></>}.</span>}
        />

        <form action="/players" method="get" role="search" className="flex max-w-xl flex-col gap-2 sm:flex-row">
          <label htmlFor="player-q" className="sr-only">Character name</label>
          <Input id="player-q" name="q" type="search" defaultValue={q} maxLength={40} autoComplete="off" placeholder={armory ? "Name, surname or full name, 2 letters or more" : "Start of a name, 2 letters or more"} className="flex-1" />
          <button type="submit" className="btn btn-primary min-h-11">Search</button>
        </form>

        {q && !searched && <p className="text-sm text-fg-2">{armory ? "Type 2 to 24 letters of a name or surname, or a full name, with no digits or hyphens." : "Type 2 to 12 letters. Names have no digits or spaces."}</p>}
        {unreachable && <p role="status" className="text-sm text-fg-2">{STORAGE_UNREACHABLE}</p>}
        {rows && rows.length === 0 && !unreachable && (
          <p className="text-sm text-fg-2">No character matches &ldquo;{q}&rdquo;. The addon has not seen one and the armory has not read one, or it was hidden.</p>
        )}
        {askBlizzard && (
          <p className="text-sm text-fg-2">
            Not read from Blizzard yet? <Link href={`/search?q=${encodeURIComponent(q)}`} className={link}>Search the whole site for &ldquo;{q}&rdquo;</Link>, which
            asks Blizzard&apos;s API for a full name it has not read, or <Link href={ARMORY_SUBMIT_PATH} className={link}>add the character</Link>.
          </p>
        )}
        {rows && rows.length > 0 && (
          <section aria-labelledby="player-results" className="space-y-3">
            <SectionHeading id="player-results">
              {rows.length} {rows.length === 1 ? "character" : "characters"} matching &ldquo;{q}&rdquo;
            </SectionHeading>
            <DataTable
              dense
              caption={`Characters matching ${q}`}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.key}
              meta={(r) => `Level ${r.level} ${raceName(r.race)} ${className(r.classToken)} · ${r.where} · ${r.sources.map((s) => SOURCE_LABEL[s]).join(", ")}`}
            />
            {capped && <p className="text-sm text-muted">Type more of the name to narrow it down.</p>}
          </section>
        )}
      </article>
    </Container>
  );
}
