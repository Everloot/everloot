import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { QuestSide, QuestTag } from "@kb/world-pages";
import { GAME_NAME_TITLE } from "@/components/EntityRelations";
import GameIcon from "@/components/game/GameIcon";
import { Container, DataTable, DataTitle, filledColumns, FilterBar, ResultStrip, type FilterControl, type SparseColumn } from "@/components/ui";
import { loadItemTips, loadQuestNames, loadSiteAssets } from "@/lib/game-assets";
import { CLIENT_LAYER, shownItemName } from "@/lib/items";
import { npcNames } from "@/lib/names";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { loadShownNames } from "@/lib/shown-item-names";
import { bareQuestRow, publicQuests, type QuestRow } from "@/lib/world-lists";
import { LINK } from "../entity";
import {
  flag, LEVEL_BRACKETS, listHref, listMetadata, listQuery, nextSort, NoMatches, NoObservations, PER_PAGE, range, rangeParam, sortParam, sortRows, Unreadable,
  type ListQuery, type Search,
} from "../list-parts";

const META = { title: "WoW Forever Quest Lookup", description: "Look up a WoW: Forever quest by id. Title, level, giver, turn-in and rewards become public after three installs agree on them.", path: "/database/quests" };
export const dynamic = "force-dynamic";

const SORTS = ["name", "level", "category", "side", "group", "giver", "turnin", "rewards", "id"] as const;
type Sort = (typeof SORTS)[number];
const DEFAULT_SORT = { key: "id" as Sort, desc: false };

const SIDES: Record<string, QuestSide> = { alliance: "alliance", horde: "horde", both: "both" };
const SIDE_LABEL: Record<QuestSide, string> = { alliance: "Alliance", horde: "Horde", both: "Both" };
const TAG_LABEL: Record<QuestTag, string> = { group: "Group", dungeon: "Dungeon", raid: "Raid", pvp: "PvP" };
const groupLabel = (x: QuestRow) => [x.tag && TAG_LABEL[x.tag], x.suggestedGroup !== null && `${x.suggestedGroup} players`].filter(Boolean).join(", ");

interface QuestQuery extends ListQuery<Sort> { level?: { min: number; max: number }; rewards?: boolean; category?: string; side?: string }

/** The quest list's filters from the URL: `q`, `level=10-20`, `rewards=1`, `category=Elwynn Forest`, `side=alliance|horde|both`. */
function questQuery(search: Search): QuestQuery | null {
  const base = listQuery(search, SORTS);
  const level = range(search, "level"), rewards = flag(search, "rewards");
  const category = typeof search.category === "string" && search.category.trim() ? search.category.trim().slice(0, 60) : undefined;
  const side = typeof search.side === "string" ? search.side : undefined;
  if (!base || level === null || rewards === null) return null;
  if (side !== undefined && !SIDES[side]) return null;
  return { ...base, ...(level ? { level } : {}), ...(rewards ? { rewards } : {}), ...(category ? { category } : {}), ...(side ? { side } : {}) };
}

const href = (q: Partial<QuestQuery>) => listHref("/database/quests", [
  ["q", q.q], ["level", rangeParam(q.level)], ["rewards", q.rewards ? "1" : undefined], ["category", q.category], ["side", q.side], ["sort", sortParam(q.sort)], ["page", q.page && q.page > 1 ? String(q.page) : undefined],
]);
const filters = (q: QuestQuery) => Number(Boolean(q.q)) + Number(Boolean(q.level)) + Number(Boolean(q.rewards)) + Number(Boolean(q.category)) + Number(Boolean(q.side));

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const q = questQuery((await props.searchParams) ?? {});
  return listMetadata(META, Boolean(q) && filters(q!) === 0 && !q!.sort, q?.page);
}

export default async function QuestListPage(props: { searchParams?: Promise<Search> }) {
  const q = questQuery((await props.searchParams) ?? {});
  if (!q) notFound();
  const facts = await loadWorldFacts();
  const reported = facts.unreachable ? [] : publicQuests(facts);
  const npcs = facts.unreachable ? new Map<number, string>() : npcNames(facts);
  // A title players agree on; else the Warcraft Wiki's, for a quest the game files list (docs/DATA_POLICY.md).
  const wikiTitles = await loadQuestNames(CLIENT_LAYER.build.version);
  // Every quest a page can title is listed, as the item lists do: the ones players have not reported read "—".
  const known = new Set(reported.map((x) => x.questId));
  const all = [...reported, ...[...(wikiTitles?.names.keys() ?? [])].filter((n) => !known.has(n)).map(bareQuestRow)];
  const titleOf = (x: QuestRow) => x.title ?? wikiTitles?.names.get(x.questId)?.name ?? null;
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const matched = all.filter((x) =>
    (!text || (id !== null ? x.questId === id : Boolean(titleOf(x)?.toLowerCase().includes(text))))
    && (!q.level || (x.level !== null && x.level >= q.level.min && x.level <= q.level.max)) && (!q.rewards || x.rewards.length > 0)
    && (!q.category || x.category === q.category) && (!q.side || x.side === SIDES[q.side]));
  const sort = q.sort ?? DEFAULT_SORT;
  const npcKey = (n: number | null) => (n === null ? null : npcs.get(n)?.toLowerCase() ?? `~${String(n).padStart(9, "0")}`);
  const key = (x: QuestRow): string | number | null => sort.key === "name" ? titleOf(x)?.toLowerCase() ?? null : sort.key === "level" ? x.level
    : sort.key === "category" ? x.category?.toLowerCase() ?? null : sort.key === "side" ? x.side : sort.key === "group" ? x.suggestedGroup
    : sort.key === "giver" ? npcKey(x.giverNpcId) : sort.key === "turnin" ? npcKey(x.turnInNpcId) : sort.key === "rewards" ? x.rewards.length : x.questId;
  const rows = sortRows(matched, key, sort.desc, (x) => x.questId);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (q.page > pages) notFound();
  const shown = rows.slice((q.page - 1) * PER_PAGE, q.page * PER_PAGE);
  const here = (over: Partial<QuestQuery>) => href({ ...q, page: 1, ...over });

  // Reward icons and names under the item lists' rule: art only for items players reported or the wiki names.
  const rewardIds = [...new Set(shown.flatMap((x) => x.rewards))];
  const shownNames = rewardIds.length ? await loadShownNames() : null;
  const withArt = shownNames ? rewardIds.filter(shownNames.showsTip) : [];
  const tips = await loadItemTips(withArt.length ? await loadSiteAssets() : null, withArt);
  const itemName = (rid: number) => (shownNames ? shownItemName(rid, shownNames.agreed, shownNames.matched?.names, tips.get(rid))?.name : undefined) ?? `Item ${rid}`;

  const dash = <span className="text-muted">—</span>;
  const npc = (n: number | null) => (n === null ? dash : <Link prefetch={false} href={`/database/npcs/${n}`} className={LINK}>{npcs.get(n) ?? `NPC ${n}`}</Link>);
  const columns: SparseColumn<QuestRow>[] = [
    { key: "name", header: "Name", sortable: true, cell: (x) => {
      const wiki = !x.title && titleOf(x);
      // Where a title comes from is in the link's hover card (and words for a screen reader), never a printed label.
      // The screen reader words follow the link, so its text is the title alone.
      return <>
        <Link prefetch={false} href={`/database/quests/${x.questId}`} className={LINK}>{titleOf(x) ?? `Quest ${x.questId}`}</Link>
        {wiki && <span className="sr-only"> ({GAME_NAME_TITLE.wiki.toLowerCase()})</span>}
      </>;
    } },
    { key: "level", header: "Level", numeric: true, sortable: true, cell: (x) => x.level ?? dash, blank: (x) => x.level === null },
    { key: "category", header: "Category", sortable: true, cell: (x) => x.category ?? dash, blank: (x) => x.category === null },
    { key: "side", header: "Side", sortable: true, cell: (x) => (x.side ? SIDE_LABEL[x.side] : dash), blank: (x) => !x.side },
    { key: "group", header: "Group", sortable: true, cell: (x) => groupLabel(x) || dash, blank: (x) => !groupLabel(x) },
    { key: "giver", header: "Giver", sortable: true, cell: (x) => npc(x.giverNpcId), blank: (x) => x.giverNpcId === null },
    { key: "turnin", header: "Turn-in", sortable: true, cell: (x) => npc(x.turnInNpcId), blank: (x) => x.turnInNpcId === null },
    {
      key: "rewards", header: "Rewards", sortable: true, blank: (x) => x.rewards.length === 0, cell: (x) => x.rewards.length === 0 ? dash : (
        <span className="flex flex-wrap items-center gap-1">
          {x.rewards.map((rid) => {
            const icon = tips.get(rid)?.icon;
            return icon
              ? <Link prefetch={false} key={rid} href={`/database/items/${rid}`} aria-label={itemName(rid)}><GameIcon src={icon} size={24} /></Link>
              : <Link prefetch={false} key={rid} href={`/database/items/${rid}`} className={`${LINK} mr-2`}>{itemName(rid)}</Link>;
          })}
        </span>
      ),
    },
    { key: "id", header: "ID", numeric: true, sortable: true, cell: (x) => x.questId },
  ];

  const categories = [...new Set(all.map((x) => x.category).filter((c): c is string => c !== null))].sort((a, b) => a.localeCompare(b));
  const controls: FilterControl[] = [
    {
      type: "menu", key: "level", label: "Level",
      options: [{ label: "Any level", href: here({ level: undefined }), on: !q.level, reset: true }, ...LEVEL_BRACKETS.map((b) => ({
        label: `${b.min}–${b.max}`, href: here({ level: b }), on: q.level?.min === b.min && q.level?.max === b.max,
      }))],
    },
    {
      type: "menu", key: "category", label: "Category",
      options: [{ label: "Any category", href: here({ category: undefined }), on: !q.category, reset: true }, ...categories.map((c) => ({
        label: c, href: here({ category: c }), on: q.category === c, count: all.filter((x) => x.category === c).length,
      }))],
    },
    {
      type: "menu", key: "side", label: "Side",
      options: [{ label: "Any side", href: here({ side: undefined }), on: !q.side, reset: true }, ...Object.entries(SIDES).map(([k, s]) => ({
        label: SIDE_LABEL[s], href: here({ side: k }), on: q.side === k, count: all.filter((x) => x.side === s).length,
      }))],
    },
    { type: "toggle", key: "rewards", label: "Has rewards", href: here({ rewards: q.rewards ? undefined : true }), on: Boolean(q.rewards) },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }).split("?")[1] ?? ""));
  const strip = <ResultStrip total={rows.length} noun={rows.length === 1 ? "quest" : "quests"} page={q.page} perPage={PER_PAGE} href={(page) => href({ ...q, page })} label="Quest pages" />;
  const chips = [
    ...(q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : []),
    ...(q.level ? [{ label: `Level ${rangeParam(q.level)}`, href: here({ level: undefined }) }] : []),
    ...(q.category ? [{ label: q.category, href: here({ category: undefined }) }] : []),
    ...(q.side ? [{ label: SIDE_LABEL[SIDES[q.side]!], href: here({ side: undefined }) }] : []),
    ...(q.rewards ? [{ label: "Has rewards", href: here({ rewards: undefined }) }] : []),
  ];
  const empty = facts.unreachable ? <Unreadable />
    : filters(q) > 0 ? <>
        <NoMatches noun="quests" chips={chips} clearHref="/database/quests" />
        {id !== null && <p className="pb-4 text-cell"><Link prefetch={false} href={`/database/quests/${id}`} className={LINK}>Open quest {id}</Link></p>}
      </>
    : <NoObservations>No quest has agreed facts yet; each shows here once 3 installs report it.</NoObservations>;

  return (
    <Container width="data">
      <article>
        <DataTitle title="Quests" aside={strip} />
        <FilterBar
          label="Quest filters"
          search={{ action: "/database/quests", value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={controls}
          active={filters(q)}
          clearHref="/database/quests"
        />
        {/* With nothing to list at all, the one line says so without a row of column headers over it. */}
        <div className="mt-2">{all.length === 0 ? empty : (
          <DataTable
            dense
            caption={`Quests: ${rows.length}`}
            // A column no quest in the result has a value for (before players report any) is left out.
            columns={filledColumns(columns, rows)}
            rows={shown}
            rowKey={(x) => String(x.questId)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(x) => [x.level !== null && `Level ${x.level}`, x.category, x.side && SIDE_LABEL[x.side], x.giverNpcId !== null && `From ${npcs.get(x.giverNpcId) ?? `NPC ${x.giverNpcId}`}`, x.rewards.length > 0 && `${x.rewards.length} reward${x.rewards.length === 1 ? "" : "s"}`, `ID ${x.questId}`].filter(Boolean).join(" · ")}
            empty={empty}
          />
        )}</div>
        {pages > 1 && <div className="mt-2">{strip}</div>}
      </article>
    </Container>
  );
}
