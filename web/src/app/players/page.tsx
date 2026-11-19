import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import { CENSUS_CLASSES, CENSUS_RACES } from "@kb/census";
import { ARMORY_HIDE_PATH, ARMORY_SUBMIT_PATH, ARMORY_RULESETS, armoryNameQuery, armoryOn, metricValue } from "@/lib/armory";
import { armoryStore, type ArmoryDirectoryRow } from "@/lib/armory-store";
import { PLAYER_SORTS, playerDirectoryQuery, playerDirectoryHref, type PlayerSearchParams } from "@/lib/armory-directory";
import { mergeLookup, SOURCE_LABEL, type LookupRow } from "@/lib/character-lookup";
import { absoluteUrl, pageMetadata } from "@/lib/seo";
import { trailFor } from "@/lib/breadcrumbs";
import { playerPagesOn, searchPrefix, type Player } from "@/lib/player-pages";
import { searchPlayers } from "@/lib/people-search";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { Container, DataTable, Input, PageHeader, SectionHeading, type Column } from "@/components/ui";
import { className, classText, playerRobots, raceName } from "./player-view";
import { ArmoryCredit, newest } from "../armory/parts";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { searchParams: Promise<PlayerSearchParams> }): Promise<Metadata> {
  const params = await props.searchParams;
  return {
    ...pageMetadata({ title: "Find a player", description: "Find WoW: Forever characters by name, class, race, level and guild. Filter Blizzard profiles by region and ruleset, sort their gear, and see addon name matches.", path: "/players" }),
    robots: playerRobots(Object.keys(params).length > 0),
  };
}

const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
/** The most rows each lookup returns: the players store's own cap, and the armory search's. */
const LIMIT = 25;

type DirectoryRow = LookupRow & { gearScore?: number | null; itemLevel?: number | null; fetchedAt?: string };

function Sources({ row }: { row: LookupRow }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {row.sources.map((s) => <span key={s} className="whitespace-nowrap rounded-control border border-edge px-1.5 text-meta text-fg-2">{SOURCE_LABEL[s]}</span>)}
    </span>
  );
}

// The hide link sits with the name, the one column a phone shows.
const columns: Column<DirectoryRow>[] = [
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
  { key: "gear", header: "Gear score", numeric: true, cell: (r) => r.gearScore == null ? "Not read" : metricValue("gear-score", r.gearScore) },
  { key: "item", header: "Item level", numeric: true, cell: (r) => r.itemLevel == null ? "Not read" : metricValue("item-level", r.itemLevel) },
  { key: "guild", header: "Guild", cell: (r) => r.guild ?? <span className="text-muted">None seen</span> },
  { key: "realm", header: "Realm", cell: (r) => r.where },
  { key: "seen", header: "Last read", nowrap: true, cell: (r) => <span className="font-mono tabular-nums">{r.fetchedAt?.slice(0, 10) ?? r.lastSeen}</span> },
];

/** A lookup's rows, or null when its storage could not be read. */
async function read<T>(run: () => Promise<T>): Promise<T | null> {
  try { return await run(); } catch { return null; }
}

export default async function PlayersPage(props: { searchParams: Promise<PlayerSearchParams> }) {
  const seen = playerPagesOn();
  const armory = armoryOn();
  if (!seen && !armory) notFound();
  const params = await props.searchParams;
  // Room for a full name: a 12-letter first name, a space and a 24-letter surname.
  const d = playerDirectoryQuery(params);
  const q = d.q;
  const prefix = seen && q ? searchPrefix(q) : null;
  const fullName = armory && q ? armoryNameQuery(q) : null;
  const [players, loaded] = await Promise.all([
    prefix ? read(() => searchPlayers(prefix.toLowerCase())) : [] as Player[],
    armory ? read(async () => ({ page: await armoryStore().directory(d) })) : undefined,
  ]);
  const directory = loaded?.page;
  // Keep the old name lookup usable while the new database function awaits the owner's approval.
  const fallback = directory === null && fullName ? await read(() => armoryStore().search(fullName, LIMIT)) : [];
  const hits = directory?.rows ?? fallback ?? [];
  const searched = Boolean(prefix || fullName || (armory && /^\p{L}$/u.test(q)));
  const merged = mergeLookup(players ?? [], hits);
  const byKey = new Map(merged.map((r) => [r.key, r]));
  // mergeLookup sorts names; the directory keeps the database's gear/name/read order.
  const rows: DirectoryRow[] = armory ? hits.map((h) => ({ ...byKey.get(`armory/${h.region}/${h.slug}`)!,
    gearScore: "gearScore" in h ? (h as ArmoryDirectoryRow).gearScore : null,
    itemLevel: "itemLevel" in h ? (h as ArmoryDirectoryRow).itemLevel : null,
    fetchedAt: "fetchedAt" in h ? (h as ArmoryDirectoryRow).fetchedAt : undefined })) : merged;
  const sightings = armory ? merged.filter((r) => !r.sources.includes("armory")) : [];
  const unreachable = players === null || loaded === null || fallback === null;
  const count = rows.length + sightings.length;
  const capped = (players?.length ?? 0) >= LIMIT;
  // A full name the armory has not read yet: /search can ask Blizzard for it now (its lookup on a miss).
  const askBlizzard = fullName?.includes(" ") && directory?.total === 0;

  return (
    <Container width="data">
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

        <form action="/players" method="get" role="search" aria-label="Player filters" className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-meta text-fg-2" htmlFor="player-q">Character name
            <Input id="player-q" name="q" type="search" defaultValue={q} maxLength={40} autoComplete="off" placeholder={armory ? "Name, surname or full name" : "Start of a name, 2 letters or more"} />
          </label>
          {armory && <>
            <SelectFilter name="class" label="Class" value={d.class ?? ""} options={CENSUS_CLASSES.map((c) => [c.name, c.name])} />
            <SelectFilter name="race" label="Race" value={d.race ?? ""} options={[...new Set(CENSUS_RACES.map((r) => r.name))].map((name) => [name, name])} />
            <SelectFilter name="faction" label="Faction" value={d.faction ?? ""} options={[["Alliance", "Alliance"], ["Horde", "Horde"]]} />
            <SelectFilter name="region" label="Region" value={d.region ?? ""} options={[["us", "US"], ["eu", "EU"]]} />
            <SelectFilter name="ruleset" label="Ruleset / realm" value={String(d.rulesetId ?? "")} options={ARMORY_RULESETS.map((r) => [String(r.id), r.label])} />
            <label htmlFor="player-min" className="grid gap-1 text-meta text-fg-2">Min level<Input id="player-min" name="min" type="number" min={1} max={60} defaultValue={d.minLevel ?? ""} className="w-24" /></label>
            <label htmlFor="player-max" className="grid gap-1 text-meta text-fg-2">Max level<Input id="player-max" name="max" type="number" min={1} max={60} defaultValue={d.maxLevel ?? ""} className="w-24" /></label>
            <label htmlFor="player-guild" className="grid gap-1 text-meta text-fg-2">Guild name<Input id="player-guild" name="guild" defaultValue={d.guildPrefix ?? ""} maxLength={80} placeholder="Start of a guild name" /></label>
            <SelectFilter name="sort" label="Sort" value={PLAYER_SORTS.find((s) => s.value === d.sort)!.slug} options={PLAYER_SORTS.map((s) => [s.slug, s.label])} all={false} />
          </>}
          <button type="submit" className="btn btn-primary min-h-11">Apply filters</button>
          <Link href="/players" className={link}>Clear</Link>
        </form>

        {q && !searched && <p className="text-sm text-fg-2">{armory ? "Type 1 to 24 letters of a name or surname, or a full name, with no digits or hyphens." : "Type 2 to 12 letters. Names have no digits or spaces."}</p>}
        {unreachable && <p role="status" className="text-sm text-fg-2">{STORAGE_UNREACHABLE}</p>}
        {armory && directory === null && <p role="status" className="text-sm text-fg-2">Directory filters and gear sorting start once the database update is applied. Name search is still available.</p>}
        {count === 0 && !unreachable && (armory ? directory : searched) && (
          <p className="text-sm text-fg-2">{d.page > 1 ? "No profiles on this page." : q ? <>No character matches &ldquo;{q}&rdquo; with these filters.</> : "No character matches these filters yet."}</p>
        )}
        {askBlizzard && (
          <p className="text-sm text-fg-2">
            Not read from Blizzard yet? <Link href={`/search?q=${encodeURIComponent(q)}`} className={link}>Search the whole site for &ldquo;{q}&rdquo;</Link>, which
            asks Blizzard&apos;s API for a full name it has not read, or <Link href={ARMORY_SUBMIT_PATH} className={link}>add the character</Link>.
          </p>
        )}
        {(armory || count > 0) && (
          <section aria-labelledby="player-results" className="space-y-3">
            <SectionHeading id="player-results">
              {q ? <>{count} {count === 1 ? "character" : "characters"} matching &ldquo;{q}&rdquo; on this page</> : "Players"}
            </SectionHeading>
            {directory && <div className="flex flex-wrap items-center justify-between gap-3 text-meta text-fg-2">
              <span>{directory.total} Blizzard {directory.total === 1 ? "profile" : "profiles"} · Page {d.page}</span>
              <nav aria-label="Player pages" className="flex gap-4">
                {d.page > 1 && <Link href={playerDirectoryHref(d, d.page - 1)} className={link}>Previous</Link>}
                {d.offset + d.limit < directory.total && <Link href={playerDirectoryHref(d, d.page + 1)} className={link}>Next</Link>}
              </nav>
            </div>}
            <DataTable
              dense
              caption={q ? `Characters matching ${q}` : "Blizzard profiles"}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.key}
              meta={rowMeta}
            />
            {directory && <ArmoryCredit at={newest(directory.rows.map((r) => r.fetchedAt))} />}
            {sightings.length > 0 && <>
              <h3 className="text-h2-sm text-fg">Seen by the addon</h3>
              <p className="text-meta text-fg-2">Name matches from addon sightings. Directory filters apply to Blizzard profiles above; these sightings have no gear read. Dates here are the day last seen.</p>
              <DataTable dense caption="Addon name matches" columns={columns} rows={sightings} rowKey={(r) => r.key} meta={rowMeta} />
            </>}
            {capped && <p className="text-sm text-muted">Type more of the name to narrow it down.</p>}
          </section>
        )}
      </article>
    </Container>
  );
}

function rowMeta(r: DirectoryRow) {
  return `Level ${r.level} ${raceName(r.race)} ${className(r.classToken)} · ${r.where} · ${r.sources.map((s) => SOURCE_LABEL[s]).join(", ")}${r.gearScore == null ? "" : ` · GS ${metricValue("gear-score", r.gearScore)}`}${r.itemLevel == null ? "" : ` · ilvl ${metricValue("item-level", r.itemLevel)}`}${r.lastSeen ? ` · Seen ${r.lastSeen}` : ""}`;
}

function SelectFilter({ name, label, value, options, all = true }: { name: string; label: string; value: string; options: readonly (readonly [string, string])[]; all?: boolean }) {
  return <label htmlFor={`player-${name}`} className="grid gap-1 text-meta text-fg-2">{label}
    <select id={`player-${name}`} name={name} defaultValue={value} className="min-h-11 rounded-control border border-line bg-panel px-3 text-base text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
      {all && <option value="">All</option>}
      {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select>
  </label>;
}
