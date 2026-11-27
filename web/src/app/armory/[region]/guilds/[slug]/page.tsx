import GuildProgression from "@/components/progression/GuildProgression";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import GuildProfile from "@/components/guild-profile";
import GuildCrest from "@/components/guild-crest";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { cache } from "react";
import { LEVEL_BANDS as CENSUS_LEVEL_BANDS } from "@kb/census";
import { Container, DataTable, Facts, FilterBar, PageHeader, Pager, SectionHeading, type Column, type FilterControl, type SortDirection } from "@/components/ui";
import { CLASS_BG, classColour } from "@/components/ui/class-colour";
import {
  armoryCharacterPath, armoryGuildPath, armoryOn, classTokenOfId, isArmoryRegion, metricValue, raceOfId, regionLabel,
  slugFromSegment, UNKNOWN, validArmorySlug, ARMORY_RECHECK_DAYS,
} from "@/lib/armory";
import { armoryStore, type ArmoryGuild, type ArmoryMember } from "@/lib/armory-store";
import { armoryGuildHidden, GUILD_DIRECTORY_PATH, guildReadDue, guildSubmitHref, rosterSummary, type RosterSummary } from "@/lib/armory-guilds";
import { addonGuildOf } from "@/lib/guild-merge";
import { guildProfileStore } from "@/lib/guild-profile-store";
import { loadGuildProgression } from "@/lib/progression";
import type { GuildMember, GuildPageData } from "@/lib/guilds";
import { playerStore } from "@/lib/player-store";
import { className, classText } from "@/app/players/player-view";
import { InstanceCard } from "@/app/guilds/parts";
import { CENSUS_MEDIA, censusIcons, type CensusIcons } from "@/lib/census-media";
import { ArmoryCredit, armoryMetadata, day, link, NOT_FOUND_METADATA, RegionChip, Unreachable } from "../../../parts";

/** Read on every request, so a hidden character leaves the roster, and a hidden guild the site, at once. */
export const dynamic = "force-dynamic";

type Params = { region: string; slug: string };
type Search = Record<string, string | string[] | undefined>;

const load = cache(async (region: string, segment: string): Promise<{ guild: ArmoryGuild; roster: ArmoryMember[] } | null | "unreachable"> => {
  const slug = slugFromSegment(segment);
  if (!isArmoryRegion(region) || slug === null || !validArmorySlug(slug)) return null;
  try {
    const store = armoryStore();
    // The guild hide list (/guilds/hide) is read too; without it the page is withheld, never shown unchecked.
    // playerStore() can throw before returning a promise, so it runs inside an async function.
    const reads = [store.guild(region, slug), store.roster(region, slug), (async () => playerStore().hiddenGuilds())()] as const;
    // Let every read settle first: Promise.all alone would leave the later failures unhandled.
    await Promise.allSettled(reads);
    const [guild, roster, hidden] = await Promise.all(reads);
    return guild && !armoryGuildHidden(hidden, guild.region, guild.name) ? { guild, roster } : null;
  } catch {
    return "unreachable";
  }
});

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  if (!armoryOn()) return NOT_FOUND_METADATA;
  const { region, slug } = await props.params;
  const read = await load(region, slug);
  if (read === null) return NOT_FOUND_METADATA;
  if (read === "unreachable") return { title: "Guild", robots: NOT_FOUND_METADATA.robots };
  const g = read.guild;
  return armoryMetadata({
    title: `${g.name}, ${g.faction} guild`,
    description: `${g.name}, a ${g.faction} guild on WoW: Forever ${regionLabel(g.region)} ${g.ruleset}, and its roster from Blizzard's API.`,
    path: armoryGuildPath(g.region, g.slug),
  });
}

const muted = (text: string) => <span className="text-muted">{text}</span>;

/** The roster's view, all of it in the address: sort and direction, class and level filters, page. */
const SORTS = ["rank", "name", "level", "class", "item-level", "last-login"] as const;
type SortKey = (typeof SORTS)[number];
/** The direction a column sorts in first: names and ranks from the top, numbers and days highest first. */
const FIRST_DIRECTION: Record<SortKey, SortDirection> = { rank: "asc", name: "asc", class: "asc", level: "desc", "item-level": "desc", "last-login": "desc" };
const LEVEL_BANDS = [...CENSUS_LEVEL_BANDS].reverse();
/** The roster's level menu: at 60, below 60, then each band under 60. */
const ROSTER_BANDS = [LEVEL_BANDS[0], { id: "below-60", min: 1, max: 59, label: "Below 60" }, ...LEVEL_BANDS.slice(1)] as const;
const ROSTER_PAGE = 50;

/** Last-login buckets: within 7 days, 8 to 30 days, longer ago; members with no login read are "unknown". */
const ACTIVITY = ["7d", "30d", "older"] as const;
type Activity = (typeof ACTIVITY)[number];
const DAY_MS = 86_400_000;

interface RosterView { sort: SortKey; dir: SortDirection; cls: string | null; level: string | null; active: Activity | null; page: number }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function rosterView(search: Search): RosterView {
  const sort = SORTS.find((s) => s === one(search.sort)) ?? "rank";
  const rawDir = one(search.dir);
  const dir: SortDirection = rawDir === "asc" || rawDir === "desc" ? rawDir : FIRST_DIRECTION[sort];
  const cls = one(search.class)?.toLowerCase() ?? null;
  const level = ROSTER_BANDS.find((b) => b.id === one(search.level))?.id ?? null;
  const active = ACTIVITY.find((a) => a === one(search.active)) ?? null;
  const page = Number(one(search.p));
  return { sort, dir, cls: cls && /^[a-z]{3,12}$/.test(cls) ? cls : null, level, active, page: Number.isInteger(page) && page > 1 && page <= 1000 ? page : 1 };
}

/** The address of a roster view; the default (every class and level, by rank, page 1) is the bare guild address. */
function rosterHref(path: string, v: RosterView): string {
  const params = new URLSearchParams();
  if (v.cls) params.set("class", v.cls);
  if (v.level) params.set("level", v.level);
  if (v.active) params.set("active", v.active);
  if (v.sort !== "rank" || v.dir !== "asc") { params.set("sort", v.sort); params.set("dir", v.dir); }
  if (v.page > 1) params.set("p", String(v.page));
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}

/** One roster row: the Blizzard member, and the day the addon last saw them when the armory has no login for them. */
interface Row { m: ArmoryMember; token: string | null; seen: string | null }

const lastDay = (r: Row) => day(r.m.lastLogin ?? null) ?? r.seen;
const fullName = (m: ArmoryMember) => [m.name, m.surname].filter(Boolean).join(" ");
const byName = (a: Row, b: Row) => a.m.name.localeCompare(b.m.name) || a.m.surname.localeCompare(b.m.surname);
/**
 * The member's last-login bucket counted back from `asOf` (the roster read, so a roster read weeks ago does not read as
 * a guild nobody logs into), or null when no login has been read.
 */
function activityOf(m: ArmoryMember, asOf: number): Activity | null {
  const at = m.lastLogin ? Date.parse(m.lastLogin) : NaN;
  if (!Number.isFinite(at)) return null;
  const days = (asOf - at) / DAY_MS;
  return days <= 7 ? "7d" : days <= 30 ? "30d" : "older";
}

/** Guild rank first (0 is the leader), then name. */
const byRank = (a: Row, b: Row) => (a.m.rank ?? 99) - (b.m.rank ?? 99) || byName(a, b);

/** Sorted by the view's column; a row without the value goes last either way, then rank order. */
function sortRows(rows: Row[], sort: SortKey, dir: SortDirection): Row[] {
  const sign = dir === "asc" ? 1 : -1;
  const by = <T,>(value: (r: Row) => T | null, compare: (a: T, b: T) => number) => (a: Row, b: Row) => {
    const va = value(a), vb = value(b);
    if (va === null || vb === null) return va === vb ? byRank(a, b) : va === null ? 1 : -1;
    return sign * compare(va, vb) || byRank(a, b);
  };
  const num = (a: number, b: number) => a - b;
  const text = (a: string, b: string) => a.localeCompare(b);
  const compare = {
    rank: (a: Row, b: Row) => sign * ((a.m.rank ?? 99) - (b.m.rank ?? 99)) || byName(a, b),
    name: (a: Row, b: Row) => sign * byName(a, b),
    level: by((r) => r.m.level, num),
    class: by((r) => (r.token ? className(r.token) : null), text),
    "item-level": by((r) => r.m.itemLevel, num),
    "last-login": by(lastDay, text),
  }[sort];
  return [...rows].sort(compare);
}

/** The census's icon key for a Blizzard race id ("NightElf" for 4), when it has one. */
const RACE_MEDIA = new Map<number, string>(Object.entries(CENSUS_MEDIA).flatMap(([token, [kind, id]]) => (kind === "race" ? [[id, token] as [number, string]] : [])));

/** A small race or class icon beside the names, which carry the meaning; nothing when the media was not read. */
const smallIcon = (url: string | undefined) =>
  // The media endpoint owns these URLs (lib/census-media.ts keeps only render.worldofwarcraft.com over https).
  // eslint-disable-next-line @next/next/no-img-element
  url ? <img src={url} alt="" width={18} height={18} loading="lazy" className="size-[18px] shrink-0 rounded-control" /> : null;

function rosterColumns(region: string, ranks: RankNames, icons: CensusIcons): Column<Row>[] {
  return [
    {
      key: "name", header: "Character", sortable: true,
      cell: ({ m, token }) => {
        const colour = `${token ? classText(token) : "text-fg"} font-medium`;
        return m.stored
          ? <Link href={armoryCharacterPath(region, m.characterSlug)} className={`${colour} underline decoration-edge underline-offset-4 hover:decoration-fg`}>{fullName(m)}</Link>
          : <span className={colour}>{fullName(m)}</span>;
      },
    },
    { key: "level", header: "Level", numeric: true, sortable: true, cell: ({ m }) => m.level ?? muted(UNKNOWN) },
    {
      key: "class", header: "Race and class", nowrap: true, sortable: true,
      cell: ({ m, token }) => (
        <span className="inline-flex items-center gap-1.5">
          {smallIcon(m.raceId === null ? undefined : icons[RACE_MEDIA.get(m.raceId) ?? ""])}
          {smallIcon(token ? icons[token] : undefined)}
          <span className="text-fg-2">{raceOfId(m.raceId)} {token ? className(token) : muted(UNKNOWN)}</span>
        </span>
      ),
    },
    { key: "rank", header: "Rank", nowrap: true, sortable: true, cell: ({ m }) => (m.rank === null ? muted(UNKNOWN) : rankName(m.rank, ranks)) },
    { key: "item-level", header: "Item level", numeric: true, sortable: true, cell: ({ m }) => (m.itemLevel === null ? muted("Not read") : metricValue("item-level", m.itemLevel)) },
    {
      key: "last-login", header: "Last login", numeric: true, sortable: true,
      cell: (r) => {
        const login = day(r.m.lastLogin ?? null);
        if (login) return login;
        return r.seen ? <>{r.seen} <span className="text-cell-2 text-muted">seen</span></> : muted("Not known");
      },
    },
  ];
}

/** Rank names by Blizzard rank number, as the guild's officers published them. */
type RankNames = ReadonlyMap<number, string>;

/** A rank's name from the officers' roster when it has one; otherwise 0 is the guild master and the rest go by number. */
const rankName = (rank: number, ranks: RankNames) => ranks.get(rank) ?? (rank === 0 ? "Guild Master" : `Rank ${rank}`);

/** The phone line under a name: level, race and class, rank and item level; the columns show on wider screens. */
const rowMeta = (ranks: RankNames) => ({ m, token }: Row): string => [
  m.level === null ? null : `Level ${m.level}`,
  `${raceOfId(m.raceId)} ${token ? className(token) : UNKNOWN}`,
  m.rank === null ? null : rankName(m.rank, ranks),
  m.itemLevel === null ? null : `ilvl ${metricValue("item-level", m.itemLevel)}`,
].filter(Boolean).join(" · ");

/** First names that are one character on each list, so a match by name is one person. */
function uniqueNames(roster: readonly ArmoryMember[], addon: readonly GuildMember[]): Set<string> {
  const count = (names: string[]) => names.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map<string, number>());
  const onRoster = count(roster.map((m) => m.name.toLowerCase()));
  const seen = count(addon.map((m) => m.name.toLowerCase()));
  return new Set([...onRoster].filter(([n, c]) => c === 1 && seen.get(n) === 1).map(([n]) => n));
}

/**
 * Rank names from the roster the guild's officers published through the addon: each Blizzard rank number takes the
 * name its members carry there, joined by first name as the sightings are. A number whose members carry two names
 * keeps going by number.
 */
function rankNamesOf(roster: readonly ArmoryMember[], addon: readonly GuildMember[]): RankNames {
  const unique = uniqueNames(roster, addon);
  const named = new Map(addon.filter((m) => m.rank?.trim() && unique.has(m.name.toLowerCase())).map((m) => [m.name.toLowerCase(), m.rank!.trim()]));
  const out = new Map<number, string>();
  const clash = new Set<number>();
  for (const m of roster) {
    const name = named.get(m.name.toLowerCase());
    if (m.rank === null || !name) continue;
    if (out.has(m.rank) && out.get(m.rank) !== name) clash.add(m.rank);
    else out.set(m.rank, name);
  }
  for (const rank of clash) out.delete(rank);
  return out;
}

/**
 * The addon's last sighting by first name, for roster members the armory has no login for. Only names that are one
 * character in both lists are joined: a first name twice on either side could be two people.
 */
function sightings(roster: readonly ArmoryMember[], addon: readonly GuildMember[]): Map<string, string> {
  const unique = uniqueNames(roster, addon);
  const out = new Map<string, string>();
  for (const m of addon) {
    const name = m.name.toLowerCase();
    if (m.lastSeen && unique.has(name)) out.set(name, m.lastSeen);
  }
  return out;
}

export default async function ArmoryGuildPage(props: { params: Promise<Params>; searchParams?: Promise<Search> }) {
  if (!armoryOn()) notFound();
  const { region, slug } = await props.params;
  // The guild profile is keyed by the address alone, so its read starts with the guild's (one round trip less); for a
  // missing or hidden guild its answer is never used. The section still awaits it, so a failure shows as it did.
  const key = slugFromSegment(slug);
  const profileRead = key !== null && isArmoryRegion(region) && validArmorySlug(key) ? (async () => guildProfileStore().profile(region, key))() : undefined;
  profileRead?.catch(() => {});
  const read = await load(region, slug);
  if (read === null) notFound();
  if (read === "unreachable") {
    return (
      <Container width="data">
        <PageHeader trail={trailFor("/armory")!} title="Guild" />
        <div className="space-y-3">
          <Unreachable />
          <ArmoryCredit at={null} />
        </div>
      </Container>
    );
  }
  const { guild: g, roster } = read;
  const path = armoryGuildPath(g.region, g.slug);
  const view = rosterView((await props.searchParams) ?? {});
  // The progression section reads only the roster: it starts now, beside the addon guild search, instead of after it.
  const progressionRead = loadGuildProgression(roster.map((m) => ({ ...m, region: g.region })));
  progressionRead.catch(() => {});
  const [addon, crest, icons] = await Promise.all([
    addonGuildOf(g), GuildCrest({ crest: g.crest, region: g.region, faction: g.faction }), roster.length ? censusIcons() : Promise.resolve({}),
  ]);
  const seen = sightings(roster, addon?.members ?? []);
  const ranks = rankNamesOf(roster, addon?.members ?? []);
  const rows: Row[] = roster.map((m) => ({ m, token: classTokenOfId(m.classId), seen: seen.get(m.name.toLowerCase()) ?? null }));

  const band = ROSTER_BANDS.find((b) => b.id === view.level);
  // Last logins count back from the day the roster was read; without that day, from now.
  const asOf = Number.isFinite(Date.parse(g.fetchedAt)) ? Date.parse(g.fetchedAt) : Date.now();
  const filtered = rows.filter((r) => (!view.cls || r.token?.toLowerCase() === view.cls) && (!band || (r.m.level !== null && r.m.level >= band.min && r.m.level <= band.max))
    && (!view.active || activityOf(r.m, asOf) === view.active));
  const sorted = sortRows(filtered, view.sort, view.dir);
  const pages = Math.max(1, Math.ceil(sorted.length / ROSTER_PAGE));
  const page = Math.min(view.page, pages);
  const shown = sorted.slice((page - 1) * ROSTER_PAGE, page * ROSTER_PAGE);
  const href = (over: Partial<RosterView>) => rosterHref(path, { ...view, page: 1, ...over });
  const filters = rosterFilters(rows, view, href);
  const summary = rosterSummary(roster);

  return (
    <Container width="data">
      <article className="space-y-8">
        <GuildHeader guild={g} crest={crest} path={path} rosterSize={roster.length} />
        <SummaryStrip guild={g} members={roster} summary={summary} activity={<>
          <LevelStrip members={roster} summary={summary} href={(level) => href({ level })} />
          <ActivityStrip members={roster} asOf={asOf} readDay={day(g.fetchedAt)} href={(active) => href({ active })} />
        </>} />
        <GuildProfile guild={g} profile={profileRead} />
        <TopItemLevels region={g.region} rows={rows} />

        <section aria-labelledby="armory-roster" className="space-y-3">
          <SectionHeading id="armory-roster" note="Item level and last login show once the character itself has been read.">Roster</SectionHeading>
          {roster.length === 0 ? <p className="text-sm text-fg-2">No members listed.</p> : (
            <>
              <FilterBar
                label="Roster filters" controls={filters} active={[view.cls, view.level, view.active].filter(Boolean).length}
                clearHref={href({ cls: null, level: null, active: null })} nofollow
                aside={<span className="text-meta text-muted">{sorted.length.toLocaleString("en-US")} of {roster.length.toLocaleString("en-US")} {roster.length === 1 ? "member" : "members"}</span>}
              />
              <DataTable
                dense nofollow caption={`Members of ${g.name}`} columns={rosterColumns(g.region, ranks, icons)} rows={shown} rowKey={(r) => r.m.characterSlug} meta={rowMeta(ranks)}
                sort={{ key: view.sort, direction: view.dir }}
                sortHref={(key, next) => {
                  const sort = key as SortKey;
                  return href({ sort, dir: sort === view.sort ? next : FIRST_DIRECTION[sort] });
                }}
                empty={<p className="px-3 py-4 text-sm text-fg-2">No member matches these filters.</p>}
              />
              <Pager label="Roster pages" page={page} pages={pages} href={(p) => rosterHref(path, { ...view, page: p })} nofollow />
            </>
          )}
        </section>

        <GuildProgression members={roster} region={g.region} progress={progressionRead} />
        {addon && <AddonSection addon={addon} />}
        <Summary members={roster} summary={summary} />

        <footer className="space-y-3 text-sm">
          {guildReadDue(g.checkedAt)
            ? <Link href={guildSubmitHref(g)} className={link}>Refresh this guild</Link>
            : <p className="text-muted">Last read {day(g.checkedAt) ?? "date unrecorded"}. A new read can be requested after {ARMORY_RECHECK_DAYS} days.</p>}
          <p><Link href={guildSubmitHref(g)} className={link}>Your guild is missing or out of date? Ask for a read</Link> · <Link href={GUILD_DIRECTORY_PATH} className={link}>Find another guild</Link></p>
          <ArmoryCredit at={g.fetchedAt} />
        </footer>
      </article>
    </Container>
  );
}

/** The guild's name with its crest (or faction emblem), faction, region and ruleset, roster size and the day it was made. */
function GuildHeader({ guild: g, crest, path, rosterSize }: { guild: ArmoryGuild; crest: ReactNode; path: string; rosterSize: number }) {
  const created = day(g.createdAt);
  const tone = g.faction === "Alliance" ? "text-faction-alliance" : g.faction === "Horde" ? "text-faction-horde" : "text-fg-2";
  return (
    <div data-guild-header className="flex items-center gap-4 sm:gap-6 [&_[data-page-header]]:mb-0">
      {crest}
      <div className="min-w-0 flex-1">
        <PageHeader
          trail={[...trailFor(GUILD_DIRECTORY_PATH)!, { name: g.name, path }]}
          title={g.name}
          lede={<><span className={`font-medium ${tone}`}>{g.faction}</span> guild on WoW: Forever</>}
          meta={
            <>
              <span className="inline-flex items-center gap-1.5"><RegionChip region={g.region} />{g.ruleset}</span>
              <span>{g.memberCount.toLocaleString("en-US")} {g.memberCount === 1 ? "member" : "members"}{rosterSize !== g.memberCount ? ` (${rosterSize.toLocaleString("en-US")} shown)` : ""}</span>
              {created && <span>Created <span className="font-mono tabular-nums">{created}</span></span>}
            </>
          }
        />
      </div>
    </div>
  );
}

/** A class menu (the roster's classes, with counts) and a level menu, each choice a link that keeps the rest of the view. */
function rosterFilters(rows: readonly Row[], view: RosterView, href: (over: Partial<RosterView>) => string): FilterControl[] {
  const classes = new Map<string, number>();
  for (const r of rows) if (r.token) classes.set(r.token.toLowerCase(), (classes.get(r.token.toLowerCase()) ?? 0) + 1);
  return [
    {
      type: "menu", key: "class", label: "Class",
      options: [
        { label: "All classes", href: href({ cls: null }), on: !view.cls, reset: true },
        ...[...classes].sort(([a], [b]) => a.localeCompare(b)).map(([cls, count]) => ({
          label: className(cls.toUpperCase()), href: href({ cls }), on: view.cls === cls, count, className: classText(cls.toUpperCase()),
        })),
      ],
    },
    {
      type: "menu", key: "level", label: "Level",
      options: [
        { label: "All levels", href: href({ level: null }), on: !view.level, reset: true },
        ...ROSTER_BANDS.map((b) => ({
          label: b.label, href: href({ level: b.id }), on: view.level === b.id,
          count: rows.filter((r) => r.m.level !== null && r.m.level >= b.min && r.m.level <= b.max).length,
        })),
      ],
    },
    {
      // The column headers sort too; on a phone only the name column shows, so this is how a phone sorts.
      type: "menu", key: "sort", label: "Sort",
      options: SORT_MENU.map(([sort, label]) => ({ label, href: href({ sort, dir: FIRST_DIRECTION[sort] }), on: view.sort === sort })),
    },
  ];
}

const SORT_MENU: [SortKey, string][] = [["rank", "Rank"], ["level", "Level"], ["item-level", "Item level"], ["last-login", "Last login"], ["name", "Name"], ["class", "Class"]];

const seenColumns: Column<GuildMember>[] = [
  { key: "name", header: "Name", cell: (m) => (m.path ? <Link href={m.path} className={`${link} font-medium ${classText(m.class)}`}>{m.name}</Link> : <span className={`font-medium ${classText(m.class)}`}>{m.name}</span>) },
  { key: "class", header: "Class", nowrap: true, cell: (m) => <span className={classText(m.class)}>{className(m.class)}</span> },
  { key: "level", header: "Level", numeric: true, cell: (m) => m.level },
  { key: "rank", header: "Rank", cell: (m) => m.rank ?? muted("–") },
  { key: "seen", header: "Last seen", numeric: true, cell: (m) => m.lastSeen ?? muted("–") },
];

/** What Everloot's addon saw of the guild: kills two members' uploads agree on, and the characters seen in it. */
function AddonSection({ addon }: { addon: GuildPageData }) {
  const { page, members } = addon;
  if (page.progression.length === 0 && members.length === 0) return null;
  return (
    <>
      {page.progression.length > 0 && (
        <section aria-labelledby="addon-progression" className="space-y-3">
          <SectionHeading id="addon-progression" note="A kill counts once two members' uploads report it, or when the guild's officers publish it.">Kills reported by members</SectionHeading>
          <div className="grid gap-4 md:grid-cols-2 lg:gap-6">{page.progression.map((p) => <InstanceCard key={p.instanceMapId} progress={p} />)}</div>
        </section>
      )}
      {members.length > 0 && (
        <section aria-labelledby="addon-members" className="space-y-3">
          <SectionHeading id="addon-members" note={`Characters Everloot's addon saw in this guild on ${page.summary.realm}: ${members.length.toLocaleString("en-US")} seen. Not Blizzard's roster.`}>Seen by the addon</SectionHeading>
          <DataTable
            dense caption="Characters the addon saw in this guild" columns={seenColumns} rows={members} rowKey={(m) => `${m.realm}/${m.name}`}
            meta={(m) => [`${m.level} ${className(m.class)}`, m.rank, m.lastSeen ? `seen ${m.lastSeen}` : null].filter(Boolean).join(" · ")}
          />
        </section>
      )}
    </>
  );
}

/** The guild at a glance, under its header: roster size, members read, level 60s, average item level, roster read, and the class mix as one bar. */
function SummaryStrip({ guild: g, members, summary: s, activity }: { guild: ArmoryGuild; members: ArmoryMember[]; summary: RosterSummary; activity: ReactNode }) {
  const read = members.filter((m) => m.stored).length;
  // The all-levels average mixes in low characters; at 60 it says what a raid-ready member wears.
  const at60 = members.filter((m) => m.level === 60 && m.itemLevel !== null).map((m) => m.itemLevel!);
  const average60 = at60.length ? Math.round((at60.reduce((a, b) => a + b, 0) / at60.length) * 10) / 10 : null;
  return (
    <section data-guild-summary aria-label="Guild summary" className="space-y-3">
      <Facts items={[
        { label: "On the roster", value: members.length.toLocaleString("en-US"), numeric: true },
        // Members of this roster whose character has been read; /guilds counts characters read whose guild this is.
        { label: "Roster members read", value: read.toLocaleString("en-US"), numeric: true },
        // Blizzard's roster, as of its read below; /guilds counts the characters read at 60 instead.
        { label: "Level 60 on the roster", value: members.filter((m) => m.level === 60).length.toLocaleString("en-US"), numeric: true },
        {
          label: "Average item level",
          value: s.averageItemLevel === null ? "Not read" : `${metricValue("item-level", s.averageItemLevel)} (${s.itemLevelsRead} read)`,
          numeric: s.averageItemLevel !== null,
        },
        ...(average60 === null ? [] : [{ label: "Average item level at 60", value: `${metricValue("item-level", average60)} (${at60.length} read)`, numeric: true }]),
        { label: "Roster read", value: day(g.fetchedAt) ?? "Not known", numeric: true },
      ]} />
      {s.classes.length > 0 && <ClassBar total={members.length} classes={s.classes} />}
      {activity}
    </section>
  );
}

const ACTIVITY_ROWS: { key: Activity | null; label: string; colour: string }[] = [
  { key: "7d", label: "Last 7 days", colour: "bg-accent" },
  { key: "30d", label: "8 to 30 days", colour: "bg-fg-2" },
  { key: "older", label: "Longer", colour: "bg-muted" },
  { key: null, label: "Not known", colour: "bg-line" },
];

/** Members by last login as one bar, then each bucket's count, linking the roster filtered to it (unknown has no filter). */
function ActivityStrip({ members, asOf, readDay, href }: { members: readonly ArmoryMember[]; asOf: number; readDay: string | null; href: (active: Activity) => string }) {
  if (members.length === 0) return null;
  const counts = new Map<Activity | null, number>();
  for (const m of members) { const a = activityOf(m, asOf); counts.set(a, (counts.get(a) ?? 0) + 1); }
  const rows = ACTIVITY_ROWS.map((r) => ({ label: r.label, colour: r.colour, count: counts.get(r.key) ?? 0, href: r.key ? href(r.key) : null }));
  return <CountStrip kind="activity" title={readDay ? `Last login, as of the ${readDay} roster read` : "Last login"} total={members.length} rows={rows} />;
}

/** Members by level band as one bar, highest band first; each band with members links the roster filtered to it. */
function LevelStrip({ members, summary, href }: { members: readonly ArmoryMember[]; summary: RosterSummary; href: (level: string) => string }) {
  // rosterSummary counts the same bands, in the same order.
  const rows = LEVEL_BANDS
    .map((b, i) => ({ label: b.label, colour: b.id === "60" ? "bg-accent" : i % 2 ? "bg-fg-2" : "bg-muted", count: summary.levels[i]?.count ?? 0, href: href(b.id) }))
    .filter((r) => r.count > 0);
  if (rows.length === 0) return null;
  return <CountStrip kind="levels" title="Level spread" total={members.length} rows={rows} />;
}

/** One stacked bar of counts, then each count named beside its colour, linking the roster filtered to it when it can. */
function CountStrip({ kind, title, total, rows }: { kind: "activity" | "levels"; title: string; total: number; rows: { label: string; colour: string; count: number; href: string | null }[] }) {
  return (
    <div data-guild-activity={kind === "activity" ? "" : undefined} data-guild-levels={kind === "levels" ? "" : undefined} className="space-y-2">
      <div role="img" aria-label={`${title}: ${rows.map((r) => `${r.label.toLowerCase()} ${r.count}`).join(", ")}`} className="flex h-2 gap-px overflow-hidden rounded-full bg-panel">
        {rows.map((r) => (r.count ? <span key={r.label} className={`block h-2 ${r.colour}`} style={{ width: `${share(r.count, total)}%` }} /> : null))}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
        <span className="text-muted">{title}</span>
        {rows.map((r) => {
          const body = <><span aria-hidden="true" className={`mr-1.5 inline-block size-2 rounded-full ${r.colour}`} /><span className="font-mono tabular-nums text-fg">{r.count}</span> <span className="text-fg-2">{r.label}</span></>;
          return r.href
            ? <Link key={r.label} href={r.href} rel="nofollow" className="underline decoration-edge underline-offset-4 hover:decoration-fg">{body}</Link>
            : <span key={r.label}>{body}</span>;
        })}
      </p>
    </div>
  );
}

const share = (count: number, total: number) => (total ? Math.round(count / total * 1000) / 10 : 0);

/** The class mix in one row: a stacked bar, then each class named in its colour with its count. */
function ClassBar({ total, classes }: { total: number; classes: RosterSummary["classes"] }) {
  const label = `Class mix: ${classes.map((c) => `${className(c.token)} ${c.count}`).join(", ")}`;
  return (
    <div className="space-y-2">
      <div data-class-bar role="img" aria-label={label} className="flex h-2 overflow-hidden rounded-full bg-panel">
        {classes.map((c) => <span key={c.token} className={`block h-2 ${classColour(CLASS_BG, c.token)}`} style={{ width: `${share(c.count, total)}%` }} />)}
      </div>
      <p aria-hidden="true" className="flex flex-wrap gap-x-3 gap-y-1 text-meta">
        {classes.map((c) => <span key={c.token}><span className={classText(c.token)}>{className(c.token)}</span> <span className="font-mono tabular-nums text-fg-2">{c.count}</span></span>)}
      </p>
    </div>
  );
}

/** The five members with the highest item level read, each linking to their character. */
function TopItemLevels({ region, rows }: { region: string; rows: readonly Row[] }) {
  const top = rows
    .filter((r) => r.m.stored && r.m.itemLevel !== null)
    .sort((a, b) => b.m.itemLevel! - a.m.itemLevel! || byName(a, b))
    .slice(0, 5);
  if (top.length === 0) return null;
  return (
    <section aria-labelledby="guild-top" className="space-y-3">
      <SectionHeading id="guild-top" note="Among the members the armory has read.">Top item levels</SectionHeading>
      <ol className="grid gap-x-6 gap-y-1 text-cell sm:grid-cols-2 lg:grid-cols-5">
        {top.map(({ m, token }) => (
          <li key={m.characterSlug} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line py-2">
            <Link href={armoryCharacterPath(region, m.characterSlug)} className={`${token ? classText(token) : "text-fg"} truncate font-medium underline decoration-edge underline-offset-4 hover:decoration-fg`}>{fullName(m)}</Link>
            <span className="font-mono tabular-nums text-fg">{metricValue("item-level", m.itemLevel!)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The class mix, level spread and item-level spread in full, below the roster. */
function Summary({ members, summary: s }: { members: ArmoryMember[]; summary: RosterSummary }) {
  return (
    <section aria-labelledby="armory-summary" className="space-y-4">
      <SectionHeading id="armory-summary" note="From the roster as Blizzard lists it. Item level comes from the members the armory has read; hidden characters are left out.">
        Class and level spread
      </SectionHeading>
      <div className="grid gap-6 lg:grid-cols-3">
        <PopulationBars kind="classes" title="Class mix" total={members.length} rows={s.classes.map((c) => ({ label: className(c.token), count: c.count, colour: classColour(CLASS_BG, c.token) }))} />
        <div className="space-y-2">
          <PopulationBars kind="levels" title="Level spread" total={members.length} rows={s.levels} />
          {s.levelUnknown > 0 && <p className="text-meta text-muted">{s.levelUnknown} without a level on the roster.</p>}
        </div>
        <div className="space-y-2">
          <PopulationBars kind="item-levels" title="Item level spread" total={s.itemLevelsRead} rows={s.itemLevels} />
          <p className="text-meta text-muted">From {s.itemLevelsRead} members with an item level read.</p>
        </div>
      </div>
    </section>
  );
}

/** Colour supplements the labels: every bar names its count and share outside the fill. */
function PopulationBars({ kind, title, total, rows }: { kind: string; title: string; total: number; rows: { label: string; count: number; colour?: string }[] }) {
  return (
    <div data-population={kind}>
      <h3 className="text-cell font-medium text-fg">{title}</h3>
      {rows.length === 0 ? <p className="mt-2 text-sm text-muted">{kind === "classes" ? "No class listed." : "No item levels read."}</p> : (
        <dl className="mt-3 space-y-3 text-cell">
          {rows.map((row) => {
            const pct = share(row.count, total);
            return (
              <div key={row.label} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                <dt className="text-fg">{row.label}</dt>
                <dd className="font-mono tabular-nums text-fg">{row.count} ({pct}%)</dd>
                <dd aria-hidden="true" className="col-span-2 h-2 rounded-full bg-panel">
                  <span className={`block h-2 rounded-full ${row.colour ?? "bg-fg-2"}`} style={{ width: `${pct}%` }} />
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
