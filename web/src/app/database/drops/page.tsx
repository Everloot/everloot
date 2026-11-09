import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { computeRollups } from "@/lib/rollup-compute";
import { dataAgeLabel } from "@/lib/data-age";
import { loadItemTips, loadSiteAssets } from "@/lib/game-assets";
import { loadNames } from "@/lib/names";
import EntityLink from "@/components/EntityLink";
import ItemTip from "@/components/game/ItemTip";
import { Container, DataTable, DataTitle, ResultStrip, type Column } from "@/components/ui";
import { percent } from "../entity";
import { listHref, listMetadata, listQuery, NoObservations, PER_PAGE, sortParam, sortRows, Unreadable, type ListQuery, type Search } from "../list-parts";

const META = { title: "WoW Forever Loot Observations", description: "Observed item frequency per recorded WoW: Forever loot window, with observation and install counts. These are not kill-based drop probabilities.", path: "/database/drops" };
export const dynamic = "force-dynamic";

const SORTS = ["item", "source", "windows", "drops", "rate", "installs"] as const;
type Sort = (typeof SORTS)[number];

const href = (q: Partial<ListQuery<Sort>>) => listHref("/database/drops", [["sort", sortParam(q.sort)], ["page", q.page && q.page > 1 ? String(q.page) : undefined]]);

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  return listMetadata(META, Boolean(q) && !q!.sort, q?.page);
}

/** One public row: an item's frequency from a source, or a source whose windows held nothing (itemId null). */
interface Row { key: string; itemId: number | null; sourceNpcId?: number; sourceObjectId?: number; kills: number; drops: number; rate: number | null; reporters: number }

export default async function DropsPage(props: { searchParams?: Promise<Search> }) {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  if (!q) notFound();
  const { rates, measuredZeros, stats } = await computeRollups();
  const live = rates.filter((r) => r.public);
  const zeros = measuredZeros.filter((z) => z.public);
  const names = await loadNames();
  const all: Row[] = [
    ...live.map((r) => ({ key: `${r.sourceNpcId ?? r.sourceObjectId}-${r.itemId}`, itemId: r.itemId, sourceNpcId: r.sourceNpcId, sourceObjectId: r.sourceObjectId, kills: r.kills, drops: r.drops, rate: r.rate, reporters: r.reporters })),
    ...zeros.map((z) => ({ key: `zero-${z.sourceNpcId ?? "o"}-${z.sourceObjectId ?? "n"}`, itemId: null, sourceNpcId: z.sourceNpcId, sourceObjectId: z.sourceObjectId, kills: z.kills, drops: 0, rate: null, reporters: z.reporters })),
  ];
  const sourceName = (r: Row) => (r.sourceNpcId !== undefined ? names.npcs.get(r.sourceNpcId)?.toLowerCase() ?? `~npc ${String(r.sourceNpcId).padStart(9, "0")}` : names.objects.get(r.sourceObjectId!)?.toLowerCase() ?? `~object ${String(r.sourceObjectId).padStart(9, "0")}`);
  const sort = q.sort;
  const rows = !sort ? all : sortRows(all, (r) => sort.key === "item" ? (r.itemId === null ? null : names.items.get(r.itemId)?.toLowerCase() ?? `~${String(r.itemId).padStart(9, "0")}`)
    : sort.key === "source" ? sourceName(r) : sort.key === "windows" ? r.kills : sort.key === "drops" ? r.drops : sort.key === "rate" ? r.rate : r.reporters, sort.desc, (r) => r.itemId ?? 0);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (q.page > pages) notFound();
  const shown = rows.slice((q.page - 1) * PER_PAGE, q.page * PER_PAGE);
  // Game icons and tooltips, only when the asset URL is set and the upload has the items.
  const assets = await loadSiteAssets();
  const tips = await loadItemTips(assets, shown.flatMap((r) => (r.itemId === null ? [] : [r.itemId])));

  const columns: Column<Row>[] = [
    {
      key: "item", header: "Item", sortable: true, cell: (r) => (r.itemId === null ? <span className="text-muted">No items observed</span> : (
        <ItemTip tip={tips.get(r.itemId)}>
          <EntityLink kind="item" id={r.itemId} name={names.items.get(r.itemId) ?? tips.get(r.itemId)?.name} />
        </ItemTip>
      )),
    },
    {
      key: "source", header: "Source", sortable: true, cell: (r) => (r.sourceNpcId !== undefined
        ? <EntityLink kind="npc" id={r.sourceNpcId} name={names.npcs.get(r.sourceNpcId)} />
        : <EntityLink kind="object" id={r.sourceObjectId!} name={names.objects.get(r.sourceObjectId!)} />),
    },
    { key: "windows", header: "Loot windows", numeric: true, sortable: true, cell: (r) => r.kills },
    { key: "drops", header: "Item observations", numeric: true, sortable: true, cell: (r) => r.drops },
    { key: "rate", header: "Observed frequency", numeric: true, sortable: true, cell: (r) => (r.rate === null ? "0 observed" : percent(r.rate)) },
    { key: "installs", header: "Installs", numeric: true, sortable: true, cell: (r) => r.reporters },
  ];

  const strip = stats.unreachable ? null
    : <ResultStrip total={rows.length} noun={rows.length === 1 ? "public frequency" : "public frequencies"} page={q.page} perPage={PER_PAGE} href={(page) => href({ ...q, page })} label="Observation pages" />;
  return (
    <Container width="data">
      <article>
        <DataTitle
          title="Loot observations"
          meta={!stats.unreachable && stats.lootWindows > 0 ? <span className="tabular-nums">{stats.lootWindows.toLocaleString("en-US")} loot windows · {dataAgeLabel(stats.dataAsOf)}</span> : undefined}
          aside={strip}
        />
        {stats.unreachable ? <Unreadable /> : <>
        <div className="mt-2">
          <DataTable
            dense
            caption={`Public loot observations: ${rows.length}`}
            columns={columns}
            rows={shown}
            rowKey={(r) => r.key}
            sort={sort ? { key: sort.key, direction: sort.desc ? "desc" : "asc" } : undefined}
            sortHref={(k, dir) => href({ sort: { key: k as Sort, desc: dir === "desc" } })}
            meta={(r) => [r.sourceNpcId !== undefined ? names.npcs.get(r.sourceNpcId) ?? `NPC ${r.sourceNpcId}` : names.objects.get(r.sourceObjectId!) ?? `Object ${r.sourceObjectId}`, `${r.rate === null ? "0 observed" : percent(r.rate)} of ${r.kills} loot windows`].join(" · ")}
            empty={<NoObservations>No public frequencies yet; one shows here once 3 installs record loot windows from the same creature or object.</NoObservations>}
          />
        </div>
        </>}
        {pages > 1 && <div className="mt-2">{strip}</div>}
      </article>
    </Container>
  );
}
