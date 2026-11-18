import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { cache } from "react";
import { Container, DataTable, Facts, PageHeader, SectionHeading, type Column } from "@/components/ui";
import {
  armoryCharacterPath, armoryGuildPath, armoryOn, classTokenOfId, isArmoryRegion, metricValue, raceOfId, regionLabel,
  slugFromSegment, UNKNOWN, validArmorySlug,
} from "@/lib/armory";
import { armoryStore, type ArmoryGuild, type ArmoryMember } from "@/lib/armory-store";
import { armoryGuildHidden, GUILD_DIRECTORY_PATH, rosterSummary, type RosterSummary } from "@/lib/armory-guilds";
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
    const [guild, roster, hidden] = await Promise.all([store.guild(region, slug), store.roster(region, slug), playerStore().hiddenGuilds()]);
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

export default async function ArmoryGuildPage(props: { params: Promise<Params> }) {
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
  const created = day(g.createdAt);
  const members = [...roster].sort(byRank);

  return (
    <Container width="data">
      <article className="space-y-8">
        <PageHeader
          trail={[...trailFor(GUILD_DIRECTORY_PATH)!, { name: g.name, path }]}
          title={g.name}
          lede={`${g.faction} guild · ${regionLabel(g.region)} ${g.ruleset} · ${g.memberCount.toLocaleString("en-US")} ${g.memberCount === 1 ? "member" : "members"}`}
          meta={created ? <span>Created <span className="font-mono tabular-nums">{created}</span></span> : undefined}
        />

        <Summary guild={g} members={members} summary={rosterSummary(members)} />

        <section aria-labelledby="armory-roster" className="space-y-3">
          <SectionHeading id="armory-roster" note="Item level and Gear Score show once the character itself has been read.">Roster</SectionHeading>
          {members.length === 0
            ? <p className="text-sm text-fg-2">No members listed.</p>
            : <DataTable dense caption={`Members of ${g.name}`} columns={rosterColumns(g.region)} rows={members} rowKey={(m) => m.characterSlug} />}
        </section>

        <ArmoryCredit at={g.fetchedAt} />
      </article>
    </Container>
  );
}

/** Roster size, members read, average item level and last read, then the class mix and the level spread. */
function Summary({ guild: g, members, summary: s }: { guild: ArmoryGuild; members: ArmoryMember[]; summary: RosterSummary }) {
  const read = members.filter((m) => m.stored).length;
  const most = Math.max(1, ...s.levels.map((l) => l.count));
  return (
    <section aria-labelledby="armory-summary" className="space-y-4">
      <SectionHeading id="armory-summary" note="From the roster as Blizzard lists it. Item level comes from the members the armory has read; hidden characters are left out.">
        Summary
      </SectionHeading>
      <Facts items={[
        { label: "Region", value: <span className="inline-flex items-center gap-1.5"><RegionChip region={g.region} />{g.ruleset}</span> },
        { label: "On the roster", value: members.length.toLocaleString("en-US"), numeric: true },
        { label: "Members read", value: read.toLocaleString("en-US"), numeric: true },
        {
          label: "Average item level",
          value: s.averageItemLevel === null ? "Not read" : `${metricValue("item-level", s.averageItemLevel)} (${s.itemLevelsRead} read)`,
          numeric: s.averageItemLevel !== null,
        },
        { label: "Roster read", value: day(g.fetchedAt) ?? "Not known", numeric: true },
      ]} />
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-cell font-medium text-fg">Class mix</h3>
          {s.classes.length === 0 ? <p className="mt-1 text-sm text-fg-2">No class listed.</p> : (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-cell">
              {s.classes.map((c) => (
                <li key={c.token}><span className={classText(c.token)}>{className(c.token)}</span> <span className="font-mono tabular-nums text-fg-2">{c.count}</span></li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-cell font-medium text-fg">Levels</h3>
          <dl className="mt-2 space-y-1 text-cell">
            {s.levels.map((l) => (
              <div key={l.label} className="grid grid-cols-[4rem_minmax(0,1fr)_2.5rem] items-center gap-2">
                <dt className="font-mono tabular-nums text-fg-2">{l.label}</dt>
                <dd aria-hidden="true" className="h-2 rounded-full bg-panel"><span className="block h-2 rounded-full bg-fg-2" style={{ width: `${(l.count / most) * 100}%` }} /></dd>
                <dd className="text-right font-mono tabular-nums text-fg">{l.count}</dd>
              </div>
            ))}
          </dl>
          {s.levelUnknown > 0 && <p className="mt-1 text-meta text-muted">{s.levelUnknown} without a level on the roster.</p>}
        </div>
      </div>
    </section>
  );
}
