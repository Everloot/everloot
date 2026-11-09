import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Container, DataTable, PageHeader, SectionHeading, type Column } from "@/components/ui";
import {
  ARMORY_PATH, armoryCharacterPath, armoryGuildPath, armoryOn, classTokenOfId, isArmoryRegion, metricValue, raceOfId, regionLabel,
  UNKNOWN, validArmorySlug,
} from "@/lib/armory";
import { armoryStore, type ArmoryGuild, type ArmoryMember } from "@/lib/armory-store";
import { className, classText } from "@/app/players/player-view";
import { ArmoryCredit, armoryMetadata, day, link, NOT_FOUND_METADATA, Unreachable } from "../../../parts";

/** Read on every request, so a hidden character leaves the roster at once. */
export const dynamic = "force-dynamic";

type Params = { region: string; slug: string };

const load = cache(async (region: string, slug: string): Promise<{ guild: ArmoryGuild; roster: ArmoryMember[] } | null | "unreachable"> => {
  if (!isArmoryRegion(region) || !validArmorySlug(slug)) return null;
  try {
    const store = armoryStore();
    const [guild, roster] = await Promise.all([store.guild(region, slug), store.roster(region, slug)]);
    return guild ? { guild, roster } : null;
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
      cell: (m) => (m.stored
        ? <Link href={armoryCharacterPath(region, m.characterSlug)} className={`${link} font-medium`}>{m.name} {m.surname}</Link>
        : <span className="font-medium">{m.name} {m.surname}</span>),
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
        <PageHeader trail={[{ name: "Home", path: "/" }, { name: "Armory", path: ARMORY_PATH }]} title="Guild" />
        <Unreachable />
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
          trail={[{ name: "Home", path: "/" }, { name: "Armory", path: ARMORY_PATH }, { name: g.name, path }]}
          title={g.name}
          lede={`${g.faction} guild · ${regionLabel(g.region)} ${g.ruleset} · ${g.memberCount.toLocaleString("en-US")} ${g.memberCount === 1 ? "member" : "members"}`}
          meta={created ? <span>Created <span className="font-mono tabular-nums">{created}</span></span> : undefined}
        />

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
