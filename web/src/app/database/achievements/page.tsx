import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { AchievementEntry } from "@kb/completion";
import { Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column, type FilterControl, stripBelow } from "@/components/ui";
import { achievementHref, loadCatalog, type Listed } from "@/lib/completion-lists";
import { byRank, nameMatches, Respelled,
  ConfirmedCell, ConfirmationsUnread, listCaption, listHref, listMetadata, listQuery, NameCell, nextSort, NoMatches, noneListed, NoObservations, paged,
  pageParams, sortRows, Unreadable, type ListQuery, type Search,
} from "../list-parts";

const META = { title: "WoW Forever Achievement List", description: "Achievements in WoW: Forever by category, points and criteria. From the game files; confirmed once three installs report each the same way.", path: "/database/achievements" };
export const dynamic = "force-dynamic";

const SORTS = ["name", "category", "points", "criteria", "id"] as const;
type Sort = (typeof SORTS)[number];
const DEFAULT_SORT = { key: "id" as Sort, desc: false };

interface AchievementQuery extends ListQuery<Sort> { category?: string }

/** The list's filters from the URL: `q`, `category=Quests`. */
function achievementQuery(search: Search): AchievementQuery | null {
  const base = listQuery(search, SORTS);
  if (!base) return null;
  const category = typeof search.category === "string" ? search.category.trim().slice(0, 60) : "";
  return { ...base, ...(category ? { category } : {}) };
}

const href = (q: Partial<AchievementQuery>) => listHref("/database/achievements", [
  ["q", q.q], ["category", q.category], ...pageParams(q),
]);
const filters = (q: AchievementQuery) => Number(Boolean(q.q)) + Number(Boolean(q.category));

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = achievementQuery((await props.searchParams) ?? {});
  return listMetadata(META, Boolean(q) && filters(q!) === 0 && !q!.sort && !q!.per, q?.page);
}

export default async function AchievementListPage(props: { searchParams?: Promise<Search> }) {
  const q = achievementQuery((await props.searchParams) ?? {});
  if (!q) notFound();
  const catalog = await loadCatalog();
  const confirmations = catalog?.confirmations ?? false;
  const all = catalog?.achievements ?? [];
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const { ranked, respelled } = nameMatches(all, text, id, (x) => x.name);
  const matched = all.filter((x) =>
    (!text || (id !== null ? x.achievementId === id : ranked!.has(x))) && (!q.category || x.category === q.category));
  const sort = q.sort ?? DEFAULT_SORT;
  const key = (x: Listed<AchievementEntry>): string | number | null => sort.key === "name" ? x.name.toLowerCase() : sort.key === "category" ? x.category.toLowerCase()
    : sort.key === "points" ? x.points : sort.key === "criteria" ? x.criteriaCount : x.achievementId;
  const rows = byRank(sortRows(matched, key, sort.desc, (x) => x.achievementId), ranked, Boolean(q.sort));
  const { shown, pages, per } = paged(rows, q);
  const here = (over: Partial<AchievementQuery>) => href({ ...q, page: 1, ...over });

  const columns: Column<Listed<AchievementEntry>>[] = [
    { key: "name", header: "Name", sortable: true, cell: (x) => <NameCell href={achievementHref(x.achievementId, x.name)}>{x.name}</NameCell> },
    { key: "category", header: "Category", sortable: true, cell: (x) => x.category },
    { key: "points", header: "Points", numeric: true, sortable: true, cell: (x) => x.points },
    { key: "criteria", header: "Criteria", numeric: true, sortable: true, cell: (x) => x.criteriaCount },
    { key: "confirmed", header: "Confirmed", cell: (x) => <ConfirmedCell entry={x} confirmations={confirmations} /> },
    { key: "id", header: "ID", numeric: true, sortable: true, cell: (x) => x.achievementId },
  ];

  const categories = [...new Set(all.flatMap((x) => (x.category ? [x.category] : [])))].sort((a, b) => a.localeCompare(b));
  const controls: FilterControl[] = [
    {
      type: "menu", key: "category", label: "Category",
      options: [{ label: "Any category", href: here({ category: undefined }), on: !q.category, reset: true }, ...categories.map((c) => ({
        label: c, href: here({ category: c }), on: q.category === c, count: all.filter((x) => x.category === c).length,
      }))],
    },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "achievement" : "achievements"} page={q.page} perPage={per} href={(page) => href({ ...q, page })} sizeHref={(n) => href({ ...q, per: n, page: 1 })} label="Achievement pages" />;
  const chips = [
    ...(q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : []),
    ...(q.category ? [{ label: `Category: ${q.category}`, href: here({ category: undefined }) }] : []),
  ];
  const empty = !catalog ? <Unreadable />
    : filters(q) > 0 ? <NoMatches noun="achievements" chips={chips} clearHref="/database/achievements" />
    : <NoObservations>{noneListed("achievement")}</NoObservations>;

  return (
    <Container width="data">
      <article>
        <DataTitle title="Achievements" aside={strip} />
        {catalog && !confirmations && <ConfirmationsUnread />}
        <FilterBar
          label="Achievement filters"
          search={{ action: "/database/achievements", value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={controls}
          active={filters(q)}
          clearHref="/database/achievements"
        />
        {respelled && rows.length > 0 && <Respelled q={respelled} />}
        <div className="mt-2">
          <DataTable
            dense
            caption={listCaption("achievements", rows, confirmations)}
            columns={columns}
            rows={shown}
            rowKey={(x) => String(x.achievementId)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(x) => [x.category, `${x.points} points`, `${x.criteriaCount} criteria`, `ID ${x.achievementId}`].join(" · ")}
            empty={empty}
          />
        </div>
        {pages > 1 && <div className="mt-2">{stripBelow(strip)}</div>}
      </article>
    </Container>
  );
}
