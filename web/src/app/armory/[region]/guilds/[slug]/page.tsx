import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { cache } from "react";
import { Container, DataTable, Facts, PageHeader, SectionHeading, type Column } from "@/components/ui";
import { CLASS_BG, classColour } from "@/components/ui/class-colour";
import {
  armoryCharacterPath, armoryGuildPath, armoryOn, classTokenOfId, isArmoryRegion, metricValue, raceOfId, regionLabel,
  slugFromSegment, UNKNOWN, validArmorySlug, ARMORY_RECHECK_DAYS,
} from "@/lib/armory";
import { armoryStore, type ArmoryGuild, type ArmoryMember } from "@/lib/armory-store";
import { armoryGuildHidden, GUILD_DIRECTORY_PATH, guildReadDue, guildSubmitHref, rosterSummary, type RosterSummary } from "@/lib/armory-guilds";
import GuildSearch from "../../../guilds/guild-search";
import { playerStore } from "@/lib/player-store";
import { className, classText } from "@/app/players/player-view";
import { ArmoryCredit, armoryMetadata, day, link, NOT_FOUND_METADATA, RegionChip, Unreachable } from "../../../parts";

/** Read on every request, so a hidden character leaves the roster, and a hidden guild the site, at once. */
export const dynamic = "force-dynamic";

type Params = { region: string; slug: string };

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

function rosterColumns(region: string): Column<ArmoryMember>[] {
  return [
    { key: "rank", header: "Rank", numeric: true, cell: (m) => m.rank ?? muted(UNKNOWN) },
    {
      key: "name", header: "Character",
      cell: (m) => {
        const full = [m.name, m.surname].filter(Boolean).join(" ");
        return m.stored
          ? <Link href={armoryCharacterPath(region, m.characterSlug)} className={`${link} font-medium`}>{full}</Link>
          : <span className="font-medium">{full}</span>;
      },
    },
    { key: "level", header: "Level", numeric: true, cell: (m) => m.level ?? muted(UNKNOWN) },
    {
      key: "class", header: "Class", nowrap: true,
      cell: (m) => {
        const token = classTokenOfId(m.classId);
        return token ? <span className={classText(token)}>{className(token)}</span> : muted(UNKNOWN);
      },
    },
    { key: "race", header: "Race", nowrap: true, cell: (m) => raceOfId(m.raceId) },
    { key: "il", header: "Item level", numeric: true, cell: (m) => (m.itemLevel === null ? muted("Not read") : metricValue("item-level", m.itemLevel)) },
    { key: "gs", header: "Gear Score", numeric: true, cell: (m) => (m.gearScore === null ? muted("Not read") : metricValue("gear-score", m.gearScore)) },
  ];
}

/** Guild rank first (0 is the leader), then name. */
const byRank = (a: ArmoryMember, b: ArmoryMember) => (a.rank ?? 99) - (b.rank ?? 99) || a.name.localeCompare(b.name) || a.surname.localeCompare(b.surname);

export default async function ArmoryGuildPage(props: { params: Promise<Params>; searchParams?: Promise<{ sort?: string | string[] }> }) {
  if (!armoryOn()) notFound();
  const { region, slug } = await props.params;
  const read = await load(region, slug);
  if (read === null) notFound();
  if (read === "unreachable") {
    return (
      <Container width="data">
        <GuildSearch />
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
  const created = day(g.createdAt);
  const rawSort = (await props.searchParams)?.sort;
  const sort = typeof rawSort === "string" && ["rank", "level", "item-level", "name"].includes(rawSort) ? rawSort : "rank";
  const byName = (a: ArmoryMember, b: ArmoryMember) => a.name.localeCompare(b.name) || a.surname.localeCompare(b.surname);
  const members = [...roster].sort(sort === "name" ? byName : sort === "level"
    ? (a, b) => (b.level ?? -1) - (a.level ?? -1) || byRank(a, b)
    : sort === "item-level" ? (a, b) => (b.itemLevel ?? -1) - (a.itemLevel ?? -1) || byRank(a, b) : byRank);

  return (
    <Container width="data">
      <article className="space-y-8">
        <GuildSearch />
        <PageHeader
          trail={[...trailFor(GUILD_DIRECTORY_PATH)!, { name: g.name, path }]}
          title={g.name}
          lede={`${g.faction} guild · ${regionLabel(g.region)} ${g.ruleset} · ${g.memberCount.toLocaleString("en-US")} ${g.memberCount === 1 ? "member" : "members"}`}
          meta={created ? <span>Created <span className="font-mono tabular-nums">{created}</span></span> : undefined}
        />

        <Summary guild={g} members={members} summary={rosterSummary(members)} />

        <section aria-labelledby="armory-roster" className="space-y-3">
          <SectionHeading id="armory-roster" note="Item level and Gear Score show once the character itself has been read.">Roster</SectionHeading>
          <nav aria-label="Sort roster" className="flex flex-wrap gap-4 text-sm">
            {([ ["rank", "Rank"], ["level", "Level"], ["item-level", "Item level"], ["name", "Name"] ] as const).map(([key, label]) => (
              <Link key={key} href={`${path}?sort=${key}`} aria-current={sort === key ? "page" : undefined} className={link}>{label}</Link>
            ))}
          </nav>
          {members.length === 0
            ? <p className="text-sm text-fg-2">No members listed.</p>
            : <DataTable dense caption={`Members of ${g.name}`} columns={rosterColumns(g.region)} rows={members} rowKey={(m) => m.characterSlug} />}
        </section>

        <footer className="space-y-3 text-sm">
          {guildReadDue(g.checkedAt)
            ? <Link href={guildSubmitHref(g)} className={link}>Refresh this guild</Link>
            : <p className="text-muted">Last read {day(g.checkedAt) ?? "date unrecorded"}. A new read can be requested after {ARMORY_RECHECK_DAYS} days.</p>}
          <p><Link href={guildSubmitHref(g)} className={link}>Your guild is missing or out of date? Ask for a read</Link></p>
          <ArmoryCredit at={g.fetchedAt} />
        </footer>
      </article>
    </Container>
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
