import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { Container, DataTable, FilterBar, LinkTabs, PageHeader, type Column, type FilterControl } from "@/components/ui";
import {
  ARMORY_BOARDS, ARMORY_METRICS, ARMORY_REGIONS, ARMORY_RULESETS, armoryBoardHref, armoryBoardPath, armoryBoardQuery,
  armoryCharacterPath, armoryOn, classTokenOfName, isArmoryMetric, metricValue, regionLabel, type ArmoryBoardQuery, type ArmoryMetric,
} from "@/lib/armory";
import { armoryStore, type ArmoryBoardRow } from "@/lib/armory-store";
import { classText } from "@/app/players/player-view";
import { ArmoryCredit, armoryMetadata, link, newest, NOT_FOUND_METADATA, Unreachable } from "../../parts";

export const revalidate = 1800;

/** Rows a board prints. */
const BOARD_ROWS = 100;

type Search = Record<string, string | string[] | undefined>;

export async function generateMetadata(props: { params: Promise<{ metric: string }> }): Promise<Metadata> {
  const { metric } = await props.params;
  if (!armoryOn() || !isArmoryMetric(metric)) return NOT_FOUND_METADATA;
  const def = ARMORY_BOARDS[metric];
  return armoryMetadata({
    title: `WoW Forever ${def.title} Rankings`,
    description: `WoW: Forever characters ranked by ${def.title.toLowerCase()}, from Blizzard's API, by region and ruleset.`,
    path: armoryBoardPath(metric),
  });
}

function controls(metric: ArmoryMetric, q: ArmoryBoardQuery): FilterControl[] {
  const href = (over: Partial<ArmoryBoardQuery>) => armoryBoardHref(metric, { ...q, ...over });
  return [
    {
      type: "menu", key: "ruleset", label: "Ruleset",
      options: [
        { label: "All rulesets", href: href({ ruleset: null }), on: q.ruleset === null, reset: true },
        ...ARMORY_RULESETS.map((r) => ({ label: r.label, href: href({ ruleset: r.id }), on: q.ruleset === r.id })),
      ],
    },
    {
      type: "menu", key: "region", label: "Region",
      options: [
        { label: "All regions", href: href({ region: null }), on: q.region === null, reset: true },
        ...ARMORY_REGIONS.map((r) => ({ label: regionLabel(r), href: href({ region: r }), on: q.region === r })),
      ],
    },
  ];
}

function columns(metric: ArmoryMetric): Column<ArmoryBoardRow>[] {
  return [
    { key: "rank", header: "Rank", numeric: true, cell: (r) => <span className="text-muted">{r.rank}</span> },
    { key: "name", header: "Character", cell: (r) => <Link href={armoryCharacterPath(r.region, r.slug)} className={`${link} font-medium`}>{r.name} {r.surname}</Link> },
    { key: "level", header: "Level", numeric: true, cell: (r) => r.level },
    { key: "class", header: "Class", nowrap: true, cell: (r) => <span className={classText(classTokenOfName(r.class))}>{r.class}</span> },
    { key: "race", header: "Race", nowrap: true, cell: (r) => r.race },
    { key: "guild", header: "Guild", cell: (r) => r.guildName ?? <span className="text-muted">None</span> },
    { key: "where", header: "Realm", nowrap: true, cell: (r) => <span className="text-fg-2">{regionLabel(r.region)} {r.ruleset}</span> },
    { key: "value", header: ARMORY_BOARDS[metric].column, numeric: true, cell: (r) => <span className="font-medium text-fg">{metricValue(metric, r.value)}</span> },
  ];
}

export default async function ArmoryBoardPage(props: { params: Promise<{ metric: string }>; searchParams?: Promise<Search> }) {
  if (!armoryOn()) notFound();
  const { metric } = await props.params;
  if (!isArmoryMetric(metric)) notFound();
  const q = armoryBoardQuery((await props.searchParams) ?? {});
  if (!q) notFound();
  const def = ARMORY_BOARDS[metric];
  const path = armoryBoardPath(metric);
  const rows = await armoryStore().board(def.key, q.region, q.ruleset, BOARD_ROWS).catch(() => null);
  const active = [q.ruleset, q.region].filter((v) => v !== null).length;

  return (
    <Container width="data">
      <article className="space-y-4">
        <PageHeader
          trail={[...trailFor("/armory")!, { name: def.title, path }]}
          title={`${def.title} rankings`}
          lede={def.lede}
          meta={<ArmoryCredit at={rows ? newest(rows.map((r) => r.fetchedAt)) : null} />}
        />
        <LinkTabs label="Armory rankings" tabs={ARMORY_METRICS.map((m) => ({ href: armoryBoardHref(m, q), label: ARMORY_BOARDS[m].title, current: m === metric }))} />
        {rows === null ? <Unreachable /> : (
          <>
            <FilterBar label="Ranking filters" controls={controls(metric, q)} active={active} clearHref={path} />
            {rows.length === 0
              ? <p className="text-sm text-fg-2">No character with this number here yet.</p>
              : <DataTable dense caption={`${def.title}, top ${rows.length}`} columns={columns(metric)} rows={rows} rowKey={(r) => `${r.region}/${r.slug}`} />}
          </>
        )}
        <p className="text-sm text-fg-2">
          Top {BOARD_ROWS}. A character&apos;s own page shows its rank within its region and ruleset. Equal numbers keep the
          character who logged in last first.
        </p>
      </article>
    </Container>
  );
}
