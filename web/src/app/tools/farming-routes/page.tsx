import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import EmailCapture from "@/components/EmailCapture";
import { Card, Container, Contribute, DataTable, DataTitle, Disclosure, EmptyState, FilterBar, LinkTabs, SectionHeading, type Column, type FilterControl } from "@/components/ui";
import { FARM_CATEGORIES, farmingAreas, inLevels, type FarmArea, type FarmCategory } from "@/lib/farming";
import { computeRollups, loadWorldFacts } from "@/lib/rollup-compute";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { npcRows } from "@/lib/world-lists";
import { publicZones, zoneContents, zoneHref, zoneMapHref } from "@/lib/zones";
import { LINK } from "../../database/entity";
import { LEVEL_BRACKETS, listHref, listMetadata, range, rangeParam, type Search } from "../../database/list-parts";

const META = {
  title: "WoW Forever Farming Routes",
  description: "WoW: Forever farming areas by what you farm: gold, herbs, ore, leather, cloth, reputation and dungeons, filled in from what players upload.",
  path: "/tools/farming-routes",
};
export const dynamic = "force-dynamic";

const SLUGS = new Set<string>(FARM_CATEGORIES.map((c) => c.slug));

interface FarmQuery { category?: FarmCategory; level?: { min: number; max: number } }

/** The page's filters from the URL: `category=cloth`, `level=10-20`. Null when a value is malformed (404). */
function farmQuery(search: Search): FarmQuery | null {
  const level = range(search, "level");
  const category = search.category;
  if (level === null || (category !== undefined && (typeof category !== "string" || !SLUGS.has(category)))) return null;
  return { ...(category ? { category: category as FarmCategory } : {}), ...(level ? { level } : {}) };
}

const href = (q: FarmQuery) => listHref(META.path, [["category", q.category], ["level", rangeParam(q.level)]]);
const filters = (q: FarmQuery) => Number(Boolean(q.category)) + Number(Boolean(q.level));

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = farmQuery((await props.searchParams) ?? {});
  return { ...listMetadata(META, Boolean(q) && filters(q!) === 0), keywords: ["wow forever farming", "wow forever gold farm", "wow forever routes"] };
}

const levelsText = (a: FarmArea) => (a.levels ? (a.levels.min === a.levels.max ? String(a.levels.min) : `${a.levels.min}–${a.levels.max}`) : null);

/** "gold, herbs and ore": the nouns of the empty categories, as one phrase. */
const listed = (parts: string[]) =>
  parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

/**
 * The farming areas, shaped like the Auction House: the categories are tabs with their counts, the level menu
 * filters, and what is not yet backed by uploads is one empty state with the agreement meter rather than a row
 * of empty headings. Nothing is invented: a zone is listed only when players' uploads put looted mobs there.
 */
export default async function FarmingRoutesPage(props: { searchParams?: Promise<Search> }) {
  const q = farmQuery((await props.searchParams) ?? {});
  if (!q) notFound();
  const [facts, { rates }] = await Promise.all([loadWorldFacts(), computeRollups()]);
  const down = facts.unreachable;
  const zones = publicZones();
  // Dungeon entrances come from the game files, so they show even when storage is down.
  const areas = farmingAreas(down ? [] : npcRows(facts, rates), down ? [] : rates, zones, zoneContents({ npcs: [], quests: [], vendors: [] }));
  const here = (over: FarmQuery) => href({ ...q, ...over });

  const dash = <span className="text-muted">—</span>;
  const zoneLink = (a: FarmArea) => <Link href={zoneHref(a.zone.mapId, a.zone.name)} className={LINK}>{a.zone.name}</Link>;
  const mapLink: Column<FarmArea> = { key: "map", header: "Map", cell: (a) => <Link href={zoneMapHref(a.zone.mapId)} className={LINK}>Map</Link> };
  const levels: Column<FarmArea> = { key: "levels", header: "Levels", numeric: true, cell: (a) => levelsText(a) ?? dash };
  const zoneColumns: Column<FarmArea>[] = [
    { key: "zone", header: "Zone", cell: zoneLink },
    { key: "continent", header: "Continent", cell: (a) => a.zone.continentName },
    levels,
    { key: "mobs", header: "Looted mobs", numeric: true, cell: (a) => a.mobs },
    mapLink,
  ];
  const dungeonColumns: Column<FarmArea>[] = [
    { key: "dungeon", header: "Dungeon", cell: (a) => a.dungeon },
    { key: "zone", header: "Entered from", cell: zoneLink },
    levels,
    mapLink,
  ];

  const total = FARM_CATEGORIES.reduce((n, c) => n + areas[c.slug].length, 0);
  const tabs = [
    { href: here({ category: undefined }), label: "Everything", current: !q.category, count: total },
    ...FARM_CATEGORIES.map((c) => ({ href: here({ category: c.slug }), label: c.label, current: q.category === c.slug, count: areas[c.slug].length })),
  ];
  const controls: FilterControl[] = [
    {
      type: "menu", key: "level", label: "Level",
      options: [{ label: "Any level", href: here({ level: undefined }), on: !q.level, reset: true }, ...LEVEL_BRACKETS.map((b) => ({
        label: `${b.min}–${b.max}`, href: here({ level: b }), on: q.level?.min === b.min && q.level?.max === b.max,
      }))],
    },
  ];

  const shown = FARM_CATEGORIES.filter((c) => !q.category || q.category === c.slug);
  // The mob-backed categories with nothing behind them. With every category shown they share one empty state;
  // a category shown alone gets its own. Storage down: those lists are unread, not empty.
  const unbacked = shown.filter((c) => c.slug !== "dungeons" && areas[c.slug].length === 0);
  const together = !q.category;
  const quiet = (text: string) => <p data-empty-state className="py-3 text-cell text-fg-2">{text}</p>;
  const emptyFor = (nouns: string[]) =>
    <EmptyState message={`No ${listed(nouns)} areas yet: a zone shows once 3 players upload loot from the same mobs there.`} />;

  return (
    <Container width="data">
      <article>
        <DataTitle title="Farming areas" meta={total === 1 ? "1 area" : `${total} areas`} />
        <LinkTabs label="What to farm" tabs={tabs} />
        <div className="mt-3">
          <FilterBar label="Farming filters" controls={controls} active={Number(Boolean(q.level))} clearHref={here({ level: undefined })} />
        </div>
        <div className="mt-4 space-y-6">
          {shown.map((c) => {
            const all = areas[c.slug];
            if (together && all.length === 0 && c.slug !== "dungeons") return null;
            const rows = q.level ? all.filter((a) => inLevels(a, q.level!)) : all;
            const body = rows.length > 0 ? (
              <DataTable
                dense
                caption={`${c.label} areas: ${rows.length}`}
                columns={c.slug === "dungeons" ? dungeonColumns : zoneColumns}
                rows={rows}
                rowKey={(a) => a.key}
                meta={(a) => [a.dungeon ? `${a.dungeon}, ${a.zone.name}` : a.zone.name, levelsText(a) && `Levels ${levelsText(a)}`].filter(Boolean).join(" · ")}
              />
            ) : down && c.slug !== "dungeons" ? quiet(STORAGE_UNREACHABLE)
              : all.length === 0 ? emptyFor([c.noun])
              : quiet(`Nothing here for levels ${rangeParam(q.level)}.`);
            return (
              <section key={c.slug} aria-labelledby={`farm-${c.slug}`} data-farm={c.slug}>
                <SectionHeading id={`farm-${c.slug}`} as="h2">{c.label}</SectionHeading>
                {body}
              </section>
            );
          })}
          {together && unbacked.length > 0 && (
            <section aria-label="Areas not yet backed by uploads" data-farm-empty={unbacked.map((c) => c.slug).join(" ")}>
              {down ? <Card><p className="text-fg-2" role="status">{STORAGE_UNREACHABLE}</p></Card> : emptyFor(unbacked.map((c) => c.noun))}
            </section>
          )}
        </div>
        <div className="mt-8 space-y-4">
          <Contribute
            id="farm-contribute"
            title="Add your farming areas"
            note="Loot mobs with the addon on. The Desktop App uploads what dropped and where when you log out; a zone is listed once 3 players agree on its mobs."
          />
          <div>
            <Disclosure summary="Where do these areas come from?">
              <p>A zone is a gold area when players' uploads place looted mobs in it, and a cloth or leather area when those mobs dropped Trade Goods of that kind. The level range is the one players agree on for the mobs there. Dungeon entrances come from the game files.</p>
            </Disclosure>
            <Disclosure summary="Why are herbs, ore and reputation empty?">
              <p>Herbs and ore come from gathering nodes, and reputation from kills and quests. The addon does not yet place those in a zone, so these three stay empty until it does. Nothing here is estimated.</p>
            </Disclosure>
          </div>
          <Card className="max-w-xl">
            <EmailCapture toolSlug="farming-routes" />
          </Card>
        </div>
      </article>
    </Container>
  );
}
