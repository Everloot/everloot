import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { trailFor } from "@/lib/breadcrumbs";
import { Container, DataTable, FilterBar, LinkTabs, PageHeader, Pager, ResultStrip, stripBelow, type Column, type FilterControl } from "@/components/ui";
import { PER_PAGE, parsePer, perParam } from "@/lib/page-size";
import {
  ARMORY_CLASSES, ARMORY_FACTIONS, ARMORY_BOARDS, ARMORY_METRICS, PLAY_HISTORY_METRICS, ARMORY_REGIONS, ARMORY_RULESETS, armoryBoardHref, armoryBoardPath, armoryBoardQuery,
  armoryOn, isArmoryMetric, regionLabel, type ArmoryBoardQuery, type ArmoryMetric, type ArmoryRegion,
} from "@/lib/armory";
import { armoryStore, type ArmoryBoardRow } from "@/lib/armory-store";
import { classText } from "@/app/players/player-view";
import { BoardClass, BoardGuild, BoardMetric, BoardName, BoardValue, RankMark, RegionBoard, sharedRanks } from "../../board-parts";
import { ArmoryCredit, armoryMetadata, link, newest, NOT_FOUND_METADATA, RegionRuleset, Unreachable } from "../../parts";

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
        { label: "US and EU", href: href({ region: null }), on: q.region === null, reset: true },
        ...ARMORY_REGIONS.map((r) => ({ label: regionLabel(r), href: href({ region: r }), on: q.region === r })),
      ],
    },
    ...([{ key: "class", label: "Class", values: ARMORY_CLASSES }, { key: "faction", label: "Faction", values: ARMORY_FACTIONS }] as const).map(({ key, label, values }) => ({
      type: "menu" as const, key, label,
      options: [
        { label: key === "class" ? "All classes" : "Both factions", href: href({ [key]: null }), on: !q[key], reset: true },
        ...values.map((value) => ({ label: value, className: key === "class" ? classText(value.toUpperCase()) : undefined, href: href({ [key]: value }), on: q[key] === value })),
      ],
    })),
  ];
}

function columns(metric: ArmoryMetric, top: number, ranks: ReturnType<typeof sharedRanks>): Column<ArmoryBoardRow>[] {
  return [
    { key: "name", header: "Rank / character", cell: (r) => <span className="flex items-center gap-2"><RankMark rank={ranks.get(r) ?? { rank: r.rank, tied: false }} /><BoardName row={r} /></span> },
    { key: "level", header: "Level", numeric: true, cell: (r) => r.level },
    { key: "class", header: "Class", nowrap: true, cell: (r) => <BoardClass row={r} /> },
    { key: "race", header: "Race", nowrap: true, cell: (r) => r.race },
    { key: "guild", header: "Guild", cell: (r) => <BoardGuild row={r} /> },
    { key: "where", header: "Realm", nowrap: true, cell: (r) => <RegionRuleset region={r.region} ruleset={r.ruleset} /> },
    { key: "value", header: <BoardMetric metric={metric} />, numeric: true, cell: (r) => <BoardValue row={r} metric={metric} top={top} /> },
  ];
}

/** `?page=2`: a whole number from 1; anything else, or a page past the end, is the first page. */
function pageOf(raw: string | string[] | undefined, pages: number): number {
  const n = typeof raw === "string" && /^\d{1,3}$/.test(raw) ? Number(raw) : 1;
  return n >= 1 && n <= pages ? n : 1;
}

export default async function ArmoryBoardPage(props: { params: Promise<{ metric: string }>; searchParams?: Promise<Search> }) {
  if (!armoryOn()) notFound();
  const { metric } = await props.params;
  if (!isArmoryMetric(metric)) notFound();
  const search = (await props.searchParams) ?? {};
  const q = armoryBoardQuery(search);
  if (!q) notFound();
  const def = ARMORY_BOARDS[metric];
  const path = armoryBoardPath(metric);
  const read = (region: ArmoryRegion | null) =>
    armoryStore().boardFiltered(def.key, region, q.ruleset, q.class ?? null, q.faction ?? null, BOARD_ROWS).catch(() => null);
  // No region chosen: each region ranked on its own, side by side, so the one with more characters read never hides
  // the other. One region chosen: its one table, with level, race and realm.
  const split = q.region === null ? await Promise.all(ARMORY_REGIONS.map(async (region) => ({ region, rows: await read(region) }))) : null;
  const rows = split ? null : await read(q.region);
  const fetched = split ? split.flatMap((s) => s.rows ?? []) : rows ?? [];
  const active = [q.ruleset, q.region, q.class ?? null, q.faction ?? null].filter((v) => v !== null).length;
  // The top 100 in pages, as the database lists page: 50 a page unless ?per= names another size.
  const per = parsePer(typeof search.per === "string" ? search.per : undefined) ?? PER_PAGE;
  const longest = Math.max(0, ...(split ? split.map((s) => s.rows?.length ?? 0) : [rows?.length ?? 0]));
  const pages = Math.max(1, Math.ceil(longest / per));
  const page = pageOf(search.page, pages);
  const shown = [(page - 1) * per, page * per] as const;
  const at = (over: { page?: number; per?: number }) => {
    const base = armoryBoardHref(metric, q);
    const params = new URLSearchParams();
    if ((over.page ?? 1) > 1) params.set("page", String(over.page));
    const size = perParam(over.per ?? per);
    if (size) params.set("per", size);
    const extra = params.toString();
    return extra ? `${base}${base.includes("?") ? "&" : "?"}${extra}` : base;
  };
  const strip = (total: number) =>
    <ResultStrip total={total} noun={total === 1 ? "character" : "characters"} page={page} perPage={per} href={(n) => at({ page: n })} sizeHref={(n) => at({ per: n })} />;

  return (
    <Container width="data">
      <article className="space-y-4">
        <PageHeader
          trail={[...trailFor("/armory")!, { name: def.title, path }]}
          title={`${def.title} rankings`}
          lede={def.lede}
          meta={<>
            <ArmoryCredit at={fetched.length ? newest(fetched.map((r) => r.fetchedAt)) : null} />
            <p data-board-counts>
              Each region is ranked on its own, top {BOARD_ROWS}; equal numbers share a rank, the character who logged in
              last listed first. A character&apos;s own page shows its rank within its region and ruleset.
            </p>
          </>}
        />
        {PLAY_HISTORY_METRICS.includes(metric) && <p className="text-sm text-fg-2">
          Characters are ranked once their play history has been read; the armory reads each character at least every 20 days.
        </p>}
        <LinkTabs label="Armory rankings" tabs={ARMORY_METRICS.map((m) => ({ href: armoryBoardHref(m, q), label: ARMORY_BOARDS[m].title, current: m === metric }))} />
        {split ? (
          <>
            <FilterBar label="Ranking filters" controls={controls(metric, q)} active={active} clearHref={path} />
            <div className="grid gap-4 lg:grid-cols-2">
              {split.map(({ region, rows: regionRows }) => (
                <RegionBoard key={region} metric={metric} region={region} rows={regionRows} shown={shown}
                  footer={<Link href={armoryBoardHref(metric, { ...q, region })} className={link}>{regionLabel(region)} only, with level, race and realm</Link>} />
              ))}
            </div>
            <Pager label="Pages" page={page} pages={pages} href={(n) => at({ page: n })} />
          </>
        ) : rows === null ? <Unreachable /> : (
          <>
            <FilterBar label="Ranking filters" controls={controls(metric, q)} active={active} clearHref={path} />
            {rows.length === 0
              ? <p className="text-sm text-fg-2">No character with this number here yet.</p>
              : <>
                {strip(rows.length)}
                <DataTable dense caption={`${def.title}, top ${rows.length}`} columns={columns(metric, rows[0]?.value ?? 0, sharedRanks(rows))} rows={rows.slice(...shown)} rowKey={(r) => `${r.region}/${r.slug}`}
                  meta={(r) => <span className="flex flex-wrap items-center gap-2"><BoardClass row={r} /><BoardGuild row={r} /><BoardValue row={r} metric={metric} top={rows[0]?.value ?? 0} /></span>} />
                {stripBelow(strip(rows.length))}
              </>}
          </>
        )}
      </article>
    </Container>
  );
}
