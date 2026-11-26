import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import EdgeDegraded from "@/components/EdgeDegraded";
import { Badge, Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column } from "@/components/ui";
import { bossEntries, bossHref, BOSSES_PATH, type BossEntry } from "@/lib/bosses";
import { compareInstances, instanceHref, instanceRows, instanceTitle, loadSightings } from "@/lib/instances";
import { PLACEHOLDER } from "@/lib/item-names";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";
import { LINK } from "../entity";
import { byRank, listHref, listMetadata, listQuery, nameMatches, nextSort, NoMatches, PER_PAGE, Respelled, sortParam, sortRows, type ListQuery, type Search } from "../list-parts";

export const dynamic = "force-dynamic";

const META = {
  title: "WoW Forever Boss List",
  description: "Every dungeon and raid boss of WoW: Forever, by instance and in order: the game files' encounter list, with the kills players report. Found in game files, unconfirmed until 3 installs report a boss.",
  path: BOSSES_PATH,
};

const SORTS = ["name", "instance", "kills", "id"] as const;
type Sort = (typeof SORTS)[number];

const href = (q: Partial<ListQuery<Sort>>) => listHref(BOSSES_PATH, [["q", q.q], ["sort", sortParam(q.sort)], ["page", q.page && q.page > 1 ? String(q.page) : undefined]]);

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  return listMetadata(META, Boolean(q) && !q!.q && !q!.sort, q?.page);
}

/**
 * Every boss of the dungeons and raids the site lists (lib/bosses.ts), instance by instance as the instance list
 * orders them (lowest level first), each in the files' order. With storage down the files' list stands alone.
 */
export default async function BossListPage(props: { searchParams?: Promise<Search> }) {
  const q = listQuery((await props.searchParams) ?? {}, SORTS);
  if (!q) notFound();
  const seen = await loadSightings();
  const rows = instanceRows(seen.unreachable ? {} : seen);
  const ordered = new Map([...rows].sort(([, a], [, b]) => compareInstances(a, b)));
  const all = bossEntries(ordered);
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const { ranked, respelled } = nameMatches(all, text, id, (b) => b.name);
  const matched = all.filter((b) => !text || (id !== null ? b.id === id : ranked!.has(b)));
  const sort = q.sort;
  const key = (b: BossEntry): string | number | null => sort?.key === "name" ? b.name.toLowerCase()
    : sort?.key === "instance" ? instanceTitle(b.instance).toLowerCase() : sort?.key === "kills" ? b.row.boss?.kills ?? null : b.id;
  const list = byRank(sort ? sortRows(matched, key, sort.desc, (b) => b.id) : matched, ranked, Boolean(sort));
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  if (q.page > pages) notFound();
  const shown = list.slice((q.page - 1) * PER_PAGE, q.page * PER_PAGE);
  const here = (over: Partial<ListQuery<Sort>>) => href({ ...q, page: 1, ...over });
  const anyKills = all.some((b) => b.row.boss);

  const columns: Column<BossEntry>[] = [
    { key: "name", header: "Boss", sortable: true, cell: (b) => (
      <span className="inline-flex items-baseline gap-1.5">{b.filesName && <Badge tone="files" />}<Link prefetch={false} href={bossHref(b.id, b.row.name)} className={LINK}>{b.name}</Link></span>
    ) },
    { key: "instance", header: "Instance", sortable: true, cell: (b) => <Link prefetch={false} href={instanceHref(b.instance.instanceMapId, b.instance.name)} className={LINK}>{instanceTitle(b.instance)}</Link> },
    { key: "order", header: "Order", numeric: true, cell: (b) => (b.order === null ? PLACEHOLDER : `${b.order} of ${b.total}`) },
    ...(anyKills ? [{ key: "kills", header: "Kills", numeric: true, sortable: true, cell: (b: BossEntry) => (b.row.boss ? b.row.boss.kills.toLocaleString("en-US") : PLACEHOLDER) }] : []),
    { key: "id", header: "ID", numeric: true, sortable: true, cell: (b) => b.id },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={list.length} noun={list.length === 1 ? "boss" : "bosses"} page={q.page} perPage={PER_PAGE} href={(page) => href({ ...q, page })} label="Boss pages" />;
  const chips = q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : [];

  return (
    <Container width="data">
      <EdgeDegraded when={seen.unreachable} />
      <article>
        <DataTitle title="Bosses" aside={strip} />
        <p className="mb-4 max-w-[70ch] text-meta text-fg-2">
          The bosses of every dungeon and raid the site lists, from the game files&apos; encounter list: found in game files,
          unconfirmed until 3 installs report a boss. A boss&apos;s page has the creature players fought, its loot and its kills.
          {seen.unreachable && ` ${STORAGE_UNREACHABLE} Players' kills cannot be shown until it is back.`}
        </p>
        <FilterBar
          label="Boss filters"
          search={{ action: BOSSES_PATH, value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={[]}
          active={q.q ? 1 : 0}
          clearHref={BOSSES_PATH}
        />
        {respelled && list.length > 0 && <Respelled q={respelled} />}
        <div className="mt-2">
          <DataTable
            dense
            caption={`Bosses, ${list.length} found in game files or reported by players`}
            columns={columns}
            rows={shown}
            rowKey={(b) => String(b.id)}
            sort={sort ? { key: sort.key, direction: sort.desc ? "desc" : "asc" } : undefined}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, { key: "id", desc: false }) })}
            meta={(b) => `${instanceTitle(b.instance)}${b.order === null ? "" : ` · ${b.order} of ${b.total}`}`}
            empty={<NoMatches noun="bosses" chips={chips} clearHref={BOSSES_PATH} />}
          />
        </div>
        {pages > 1 && <div className="mt-2">{strip}</div>}
      </article>
    </Container>
  );
}
