import GuildProgression from "@/components/progression/GuildProgression";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import GuildProfile from "@/components/guild-profile";
import GuildCrest from "@/components/guild-crest";
import Link from "next/link";
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
import type { GuildMember, GuildPageData } from "@/lib/guilds";
import { playerStore } from "@/lib/player-store";
import { className, classText } from "@/app/players/player-view";
import { InstanceCard } from "@/app/guilds/parts";
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
const ROSTER_PAGE = 50;

interface RosterView { sort: SortKey; dir: SortDirection; cls: string | null; level: string | null; page: number }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function rosterView(search: Search): RosterView {
  const sort = SORTS.find((s) => s === one(search.sort)) ?? "rank";
  const rawDir = one(search.dir);
  const dir: SortDirection = rawDir === "asc" || rawDir === "desc" ? rawDir : FIRST_DIRECTION[sort];
  const cls = one(search.class)?.toLowerCase() ?? null;
  const level = LEVEL_BANDS.find((b) => b.id === one(search.level))?.id ?? null;
  const page = Number(one(search.p));
  return { sort, dir, cls: cls && /^[a-z]{3,12}$/.test(cls) ? cls : null, level, page: Number.isInteger(page) && page > 1 && page <= 1000 ? page : 1 };
}

/** The address of a roster view; the default (every class and level, by rank, page 1) is the bare guild address. */
function rosterHref(path: string, v: RosterView): string {
  const params = new URLSearchParams();
  if (v.cls) params.set("class", v.cls);
  if (v.level) params.set("level", v.level);
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

function rosterColumns(region: string): Column<Row>[] {
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
      cell: ({ m, token }) => <span className="text-fg-2">{raceOfId(m.raceId)} {token ? className(token) : muted(UNKNOWN)}</span>,
    },
    { key: "item-level", header: "Item level", numeric: true, sortable: true, cell: ({ m }) => (m.itemLevel === null ? muted("Not read") : metricValue("item-level", m.itemLevel)) },
    {
      key: "last-login", header: "Last login", numeric: true, sortable: true,
      cell: (r) => {
        const login = day(r.m.lastLogin ?? null);
        if (login) return login;
        return r.seen ? <>{r.seen} <span className="text-cell-2 text-muted">seen</span></> : muted("Not known");
      },
    },
    { key: "rank", header: "Rank", numeric: true, sortable: true, cell: ({ m }) => m.rank ?? muted(UNKNOWN) },
  ];
}

/** The phone line under a name: everything the hidden columns say. */
function rowMeta({ m, token }: Row): string {
  const login = day(m.lastLogin ?? null);
  return [
    `${m.level ?? "?"} ${raceOfId(m.raceId)} ${token ? className(token) : ""}`.trim(),
    m.itemLevel === null ? null : `item level ${metricValue("item-level", m.itemLevel)}`,
    login ? `last login ${login}` : null,
  ].filter(Boolean).join(" · ");
}

/**
 * The addon's last sighting by first name, for roster members the armory has no login for. Only names that are one
 * character in both lists are joined: a first name twice on either side could be two people.
 */
function sightings(roster: readonly ArmoryMember[], addon: readonly GuildMember[]): Map<string, string> {
  const count = (names: string[]) => names.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map<string, number>());
  const onRoster = count(roster.map((m) => m.name.toLowerCase()));
  const seen = count(addon.map((m) => m.name.toLowerCase()));
  const out = new Map<string, string>();
  for (const m of addon) {
    const name = m.name.toLowerCase();
    if (m.lastSeen && onRoster.get(name) === 1 && seen.get(name) === 1) out.set(name, m.lastSeen);
  }
  return out;
}

export default async function ArmoryGuildPage(props: { params: Promise<Params>; searchParams?: Promise<Search> }) {
  if (!armoryOn()) notFound();
  const { region, slug } = await props.params;
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
  const [addon, crest] = await Promise.all([addonGuildOf(g), GuildCrest({ crest: g.crest, region: g.region, faction: g.faction })]);
  const seen = sightings(roster, addon?.members ?? []);
  const rows: Row[] = roster.map((m) => ({ m, token: classTokenOfId(m.classId), seen: seen.get(m.name.toLowerCase()) ?? null }));

  const band = LEVEL_BANDS.find((b) => b.id === view.level);
  const filtered = rows.filter((r) => (!view.cls || r.token?.toLowerCase() === view.cls) && (!band || (r.m.level !== null && r.m.level >= band.min && r.m.level <= band.max)));
  const sorted = sortRows(filtered, view.sort, view.dir);
  const pages = Math.max(1, Math.ceil(sorted.length / ROSTER_PAGE));
  const page = Math.min(view.page, pages);
  const shown = sorted.slice((page - 1) * ROSTER_PAGE, page * ROSTER_PAGE);
  const href = (over: Partial<RosterView>) => rosterHref(path, { ...view, page: 1, ...over });
  const filters = rosterFilters(rows, view, href);

  return (
    <Container width="data">
      <article className="space-y-8">
        <GuildHeader guild={g} crest={crest} path={path} rosterSize={roster.length} />
        <GuildProfile guild={g} />

        <section aria-labelledby="armory-roster" className="space-y-3">
          <SectionHeading id="armory-roster" note="Item level and last login show once the character itself has been read.">Roster</SectionHeading>
          {roster.length === 0 ? <p className="text-sm text-fg-2">No members listed.</p> : (
            <>
              <FilterBar
                label="Roster filters" controls={filters} active={[view.cls, view.level].filter(Boolean).length}
                clearHref={href({ cls: null, level: null })} nofollow
                aside={<span className="text-meta text-muted">{sorted.length.toLocaleString("en-US")} of {roster.length.toLocaleString("en-US")} {roster.length === 1 ? "member" : "members"}</span>}
              />
              <DataTable
                dense nofollow caption={`Members of ${g.name}`} columns={rosterColumns(g.region)} rows={shown} rowKey={(r) => r.m.characterSlug} meta={rowMeta}
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

        <GuildProgression members={roster} region={g.region} />
        {addon && <AddonSection addon={addon} />}
        <Summary guild={g} members={roster} summary={rosterSummary(roster)} />

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
        ...LEVEL_BANDS.map((b) => ({
          label: b.label, href: href({ level: b.id }), on: view.level === b.id,
          count: rows.filter((r) => r.m.level !== null && r.m.level >= b.min && r.m.level <= b.max).length,
        })),
      ],
    },
  ];
}

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

/** Roster size, members read, average item level and last read, then the class mix and the level spread. */
function Summary({ guild: g, members, summary: s }: { guild: ArmoryGuild; members: ArmoryMember[]; summary: RosterSummary }) {
  const read = members.filter((m) => m.stored).length;
  return (
    <section aria-labelledby="armory-summary" className="space-y-4">
      <SectionHeading id="armory-summary" note="From the roster as Blizzard lists it. Item level comes from the members the armory has read; hidden characters are left out.">
        Summary
      </SectionHeading>
      <Facts items={[
        { label: "Region", value: <span className="inline-flex items-center gap-1.5"><RegionChip region={g.region} />{g.ruleset}</span> },
        { label: "On the roster", value: members.length.toLocaleString("en-US"), numeric: true },
        { label: "Members read", value: read.toLocaleString("en-US"), numeric: true },
        { label: "Level 60", value: members.filter((m) => m.level === 60).length.toLocaleString("en-US"), numeric: true },
        {
          label: "Average item level",
          value: s.averageItemLevel === null ? "Not read" : `${metricValue("item-level", s.averageItemLevel)} (${s.itemLevelsRead} read)`,
          numeric: s.averageItemLevel !== null,
        },
        { label: "Roster read", value: day(g.fetchedAt) ?? "Not known", numeric: true },
      ]} />
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
            const share = total ? Math.round(row.count / total * 1000) / 10 : 0;
            return (
              <div key={row.label} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                <dt className="text-fg">{row.label}</dt>
                <dd className="font-mono tabular-nums text-fg">{row.count} ({share}%)</dd>
                <dd aria-hidden="true" className="col-span-2 h-2 rounded-full bg-panel">
                  <span className={`block h-2 rounded-full ${row.colour ?? "bg-fg-2"}`} style={{ width: `${share}%` }} />
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
