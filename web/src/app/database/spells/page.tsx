import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ClassContextChip from "@/components/classes/ClassContextChip";
import { Container, DataTable, DataTitle, FilterBar, ResultStrip, type Column, type FilterControl, stripBelow } from "@/components/ui";
import Badge from "@/components/ui/Badge";
import { CLASS_TEXT } from "@/components/ui/class-colour";
import { CLIENT_CLASS_SPELLS } from "@/data/game-data/client-class-spells";
import { CLIENT_SPELLS } from "@/data/game-data/client-spells";
import Link from "@/components/Link";
import { isDevelopmentSpellName } from "@kb/dev-item-names";
import { CLASSES } from "@/design/tokens";
import { classLabel, hasClassContext, parseClassContext, switchClassContext, withClassContext, withoutClassContext, type ClassContext, type ClassSlug } from "@/lib/class-context";
import { loadSiteAssets, loadSpellNames } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@kb/client-layer-file";
import { loadCatalog } from "@/lib/talents/catalogs";
import { loadSpellTalents } from "@/lib/talents/spell-talents";
import { classSpellRanks, spellRank } from "@/lib/spell-card";
import { CLIENT_LABEL } from "@kb/edges";
import {
  ListNote, listHref, listMetadata, listQuery, NameCell, nextSort, NoMatches, paged, pageParams, sortRows, Unreadable,
  type ListQuery, type Search,
} from "../list-parts";

/**
 * The spell list. Spells are the game's own data: the list is the spellbook of one build, with the
 * names the site's naming rule allows showing, and every row links to the spell's page.
 */
const META = { title: "WoW Forever Spell List", description: "Spells in WoW: Forever, read from the client files of one build: what each one creates, what it costs and which talent teaches it.", path: "/database/spells" };
export const dynamic = "force-dynamic";

const SORTS = ["name", "id"] as const;
type Sort = (typeof SORTS)[number];
const DEFAULT_SORT = { key: "id" as Sort, desc: false };

type SpellQuery = ListQuery<Sort> & { dev?: boolean };
const href = (q: Partial<SpellQuery>, context: ClassContext | null = null) => withClassContext(listHref("/database/spells", [
  ["q", q.q], ["dev", q.dev ? "1" : undefined], ...pageParams(q),
]), context);
/** The development leftovers view (?dev=1): the files' test and retired spells, which the plain list leaves out. */
const devView = (search: Search) => search.dev === "1";

/** The spells a class's talent catalog names, which may be none; null only when the catalog cannot be read. */
async function talentCatalogSpells(slug: ClassSlug): Promise<Set<number> | null> {
  try {
    return new Set((await loadCatalog(slug)).nodes.flatMap((n) => n.entries.map((e) => e.spellId)).filter((id): id is number => id !== null));
  } catch {
    return null;
  }
}

export async function generateMetadata(props: { searchParams?: Promise<Search> }): Promise<Metadata> {
  const search = (await props.searchParams) ?? {};
  const q = listQuery(search, SORTS);
  return listMetadata(META, Boolean(q) && !q!.q && !q!.sort && !q!.per && !devView(search) && !hasClassContext(search), q?.page);
}

export default async function SpellListPage(props: { searchParams?: Promise<Search> }) {
  const search = (await props.searchParams) ?? {};
  const listed = listQuery(search, SORTS);
  if (!listed) notFound();
  const q: SpellQuery = { ...listed, ...(devView(search) ? { dev: true } : {}) };
  // A class from a class hub narrows the list to the class's spells by the game files: the spells on its own skill lines
  // (data/game-data/client-class-spells.json) and the ones its talent catalog names. A spell no class line or catalog
  // names (an item's, a profession's, a creature's, a mount) is no class's, so a class leaves it out. The level and
  // role narrow nothing; a catalog that cannot be read leaves the skill lines to narrow by.
  const read = parseClassContext(search);
  const context = read.ok ? read.context : null;
  const [names, talents, assets, talentSpells] = await Promise.all([
    loadSpellNames(CLIENT_LAYER.build.version), context ? talentCatalogSpells(context.classSlug) : null, loadSiteAssets(),
    // A talent's level is its row in the tree (the spell page's rule); unread catalogs leave every level shown.
    loadSpellTalents().catch(() => new Map<number, unknown>()),
  ]);
  const all = names?.names ?? new Map<number, string>();
  const lines = context ? CLIENT_CLASS_SPELLS.classes[context.classSlug]?.spells ?? [] : [];
  const mine = context ? new Set([...lines, ...(talents ?? [])]) : null;
  const text = q.q?.toLowerCase();
  const id = text && /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : null;
  const kept = mine ? [...all.keys()].filter((spellId) => mine.has(spellId)).length : 0;
  const matching = [...all.entries()]
    .filter(([spellId, name]) => (!mine || mine.has(spellId)) && (!text || (id !== null ? spellId === id : name.toLowerCase().includes(text))));
  // The files' test and retired spells ("Hot Foot (TEST)", "Word of Recall (OLD)") are left out unless asked for, by the
  // rule the item lists use plus Test as a word (kb/src/dev-item-names.ts); the line above the table counts them, with the toggle.
  const leftovers = matching.filter(([, name]) => isDevelopmentSpellName(name)).length;
  // A class's spells of one name are its ranks: each row says which, and the level the files give it.
  const ranks = classSpellRanks((spellId) => all.get(spellId));
  const rows = matching
    .filter(([, name]) => q.dev || !isDevelopmentSpellName(name))
    .map(([spellId, name]) => ({
      spellId, name, rank: ranks.get(spellId) ?? spellRank(spellId),
      level: talentSpells.has(spellId) ? null : CLIENT_SPELLS.spells[String(spellId)]?.level || null,
    }));
  // A name on more than one row with no rank to tell them apart says its id beside it (Heavy Linen Bandage 3276, 3281).
  const named = new Map<string, number>();
  for (const x of rows) named.set(x.name, (named.get(x.name) ?? 0) + 1);
  const twin = (x: (typeof rows)[number]) => !x.rank && (named.get(x.name) ?? 0) > 1;
  const sort = q.sort ?? DEFAULT_SORT;
  const sorted = sortRows(rows, (x) => (sort.key === "name" ? x.name.toLowerCase() : x.spellId), sort.desc, (x) => x.spellId);
  const { shown, pages, per } = paged(sorted, q);
  const here = (over: Partial<SpellQuery>) => href({ ...q, page: 1, ...over }, context);
  const className = context ? classLabel(context.classSlug) : "";
  const subset = mine ? `${className} spells in the game files` : null;
  const clear = withClassContext("/database/spells", context);

  const columns: Column<(typeof rows)[number]>[] = [
    { key: "name", header: "Spell", sortable: true, cell: (x) => <NameCell href={`/database/spells/${x.spellId}`} icon={assets?.spellIcons.get(x.spellId)} after={twin(x) ? <span className="text-meta text-fg-2">{`ID ${x.spellId}`}</span> : null}>{x.name}</NameCell> },
    { key: "rank", header: "Rank", nowrap: true, cell: (x) => (x.rank ? `Rank ${x.rank}` : null) },
    { key: "level", header: "Level", numeric: true, cell: (x) => x.level ?? "–" },
    { key: "id", header: "ID", numeric: true, sortable: true, cell: (x) => x.spellId },
  ];
  const keep = Object.fromEntries(new URLSearchParams(href({ ...q, q: undefined, page: 1 }, context).split("?")[1] ?? ""));
  const toggle = leftovers > 0 && (
    <p className="mt-2 text-meta text-fg-2">
      {`Test, placeholder and retired spells the game files still list are ${q.dev ? "shown" : "left out"}. `}
      <Link href={here({ dev: q.dev ? undefined : true })} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">
        {`${q.dev ? "Hide" : "Show"} ${leftovers.toLocaleString("en-US")} development ${leftovers === 1 ? "leftover" : "leftovers"}`}
      </Link>
    </p>
  );
  const strip = <ResultStrip total={sorted.length} noun={sorted.length === 1 ? "spell" : "spells"} page={q.page} perPage={per} href={(page) => href({ ...q, page }, context)} sizeHref={(n) => href({ ...q, per: n, page: 1 }, context)} label="Spell pages" />;
  // The class menu puts a class context on the list, or takes it off; a class picks its own colour (the class picker rule).
  const plain = withoutClassContext("/database/spells", search);
  const controls: FilterControl[] = [{
    type: "menu", key: "class", label: "Class",
    options: [
      { label: "All classes", href: withoutClassContext("/database/spells", { ...search, page: undefined }), on: !context, reset: true },
      ...CLASSES.filter((c) => CLIENT_CLASS_SPELLS.classes[c]).map((c) => ({
        label: classLabel(c), className: CLASS_TEXT[c], href: switchClassContext(plain, { classSlug: c }), on: context?.classSlug === c,
      })),
    ],
  }];
  const chips = q.q ? [{ label: `Name: ${q.q}`, href: here({ q: undefined }) }] : [];
  // The names are the game files' own: a list with none was not read, and no addon upload fills it.
  const unread = <Unreadable>{`The spell names for build ${CLIENT_LAYER.build.version} could not be read.`}</Unreadable>;
  const empty = !names || all.size === 0 ? unread
    : q.q ? <NoMatches noun="spells" chips={chips} clearHref={clear} />
    // The class's lines and catalog name no spell this list has.
    : <p className="py-4 text-cell text-fg-2">{`No ${className} spells are listed here.`}</p>;

  return (
    <Container width="data">
      <article>
        <DataTitle title="Spells" aside={strip} />
        <ListNote files>{`Every spell the game files name for build ${CLIENT_LAYER.build.version}. ${CLIENT_LABEL}.`}</ListNote>
        <FilterBar
          label="Spell filters"
          search={{ action: "/database/spells", value: q.q, placeholder: "Name or id", label: "Filter by name or id", keep }}
          controls={controls}
          active={q.q ? 1 : 0}
          clearHref={clear}
        />
        <ClassContextChip read={read} here={withoutClassContext("/database/spells", search)}>
          {/* The skill lines and the catalog are from the game files: the subset carries the quiet unconfirmed marker (DATA_POLICY.md). */}
          {context && (
            <span>
              <Badge tone="files" />{" "}
              {`Only ${className} spells: the ones on the class's own skill lines and in its talent catalog, found in game files, unconfirmed. ${kept.toLocaleString("en-US")} ${kept === 1 ? "spell" : "spells"} kept; spells no class names (items, professions, riding) are left out.`}
              {!talents && ` The ${className} talent catalog could not be read, so only the skill lines count.`}
              {(context.level !== undefined || context.role) && ` The ${context.level !== undefined && context.role ? "level and role do" : context.role ? "role does" : "level does"} not change the list.`}
            </span>
          )}
        </ClassContextChip>
        {toggle}
        <div className="mt-2">
          <DataTable
            dense
            caption={`${subset ?? "Spells in the game files"}: ${sorted.length}`}
            columns={columns}
            rows={shown}
            rowKey={(x) => String(x.spellId)}
            sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}
            sortHref={(k, dir) => here({ sort: nextSort(k, dir, DEFAULT_SORT) })}
            meta={(x) => [x.rank ? `Rank ${x.rank}` : null, x.level ? `Level ${x.level}` : null, `ID ${x.spellId}`].filter(Boolean).join(" · ")}
            empty={empty}
          />
        </div>
        {pages > 1 && <div className="mt-2">{stripBelow(strip)}</div>}
      </article>
    </Container>
  );
}
