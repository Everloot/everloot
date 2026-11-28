import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import GameIcon from "@/components/game/GameIcon";
import { AgreementMeter, type SortDirection } from "@/components/ui";
import Badge from "@/components/ui/Badge";
import type { Quality } from "@/components/ui/quality";
import { pageMetadata } from "@/lib/seo";
import { matchNames } from "@/lib/name-match";
import { PER_PAGE, parsePer, perParam } from "@/lib/page-size";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";

// What the database lists share: their query strings, their indexing rule, their cells and their empty states
// (density spec, 2026-10-20, section 4; docs/design/direction.md). One column order on every list: the entity's
// name (with its icon) and what kind of thing it is, then its key numbers, then where it is or comes from, then
// its status (confirmed by players or found in the game files), and the id last.

export type Search = Record<string, string | string[] | undefined>;

/** "1 item", "3 items": a count with its noun, singular for one. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Rows on one page of a list when the address names no size (?per= picks another, lib/page-size.ts). */
export { PER_PAGE };

const one = (search: Search, k: string) => (typeof search[k] === "string" ? (search[k] as string) : undefined);

/** A list's sort, page size and page, and its name box; null when a value is malformed (the page answers 404). */
export interface ListQuery<K extends string> { q?: string; sort?: { key: K; desc: boolean }; per?: number; page: number }

export function listQuery<K extends string>(search: Search, sorts: readonly K[]): ListQuery<K> | null {
  const sort = one(search, "sort"), page = one(search, "page"), per = parsePer(one(search, "per"));
  const sorted = sort === undefined ? undefined : /^(-?)([a-z]+)$/.exec(sort);
  if (sort !== undefined && (!sorted || !(sorts as readonly string[]).includes(sorted[2]))) return null;
  if (page !== undefined && !/^[1-9]\d{0,4}$/.test(page)) return null;
  if (per === null) return null;
  const q = one(search, "q")?.trim().slice(0, 60);
  return { ...(q ? { q } : {}), ...(sorted ? { sort: { key: sorted[2] as K, desc: sorted[1] === "-" } } : {}), ...(per ? { per } : {}), page: page === undefined ? 1 : Number(page) };
}

/** The last parameters of every list URL, in one order: the sort, the page size, the page. */
export const pageParams = <K extends string>(q: Partial<ListQuery<K>>): [string, string | undefined][] => [
  ["sort", sortParam(q.sort)], ["per", perParam(q.per)], ["page", q.page && q.page > 1 ? String(q.page) : undefined],
];

/** One page of a list's rows at its size; a page past the end is a 404. */
export function paged<T>(rows: readonly T[], q: { page: number; per?: number }): { shown: T[]; pages: number; per: number } {
  const per = q.per ?? PER_PAGE;
  const pages = Math.max(1, Math.ceil(rows.length / per));
  if (q.page > pages) notFound();
  return { shown: rows.slice((q.page - 1) * per, q.page * per), pages, per };
}

/**
 * A list's first cell: the entity's icon when the art exists, its name as a link in its colour (an item's quality,
 * a class's class colour, a faction's side), and the hollow diamond when only the game files give it.
 * `icon` is a URL (a 24 px game icon, its border in `quality`) or a node of its own (a map or loading-screen thumb).
 */
export function NameCell({ href, children, icon, quality, tone = "text-fg", style, files, after }: {
  href: string; children: ReactNode; icon?: string | ReactNode | null; quality?: Quality; tone?: string; style?: CSSProperties;
  files?: boolean;
  /** After the name, before the mark: words for a screen reader, or a muted note on why the row is listed by id. */
  after?: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {icon && (typeof icon === "string" ? <GameIcon src={icon} size={24} quality={quality} /> : icon)}
      <Link prefetch={false} href={href} className={`min-w-0 ${tone} hover:underline underline-offset-4`} style={style}>{children}</Link>
      {after}
      {files && <Badge tone="files" />}
    </span>
  );
}

/** The line under a list's title: where its rows come from and what confirms one; a game-files list leads with the mark. */
export function ListNote({ children, files }: { children: ReactNode; files?: boolean }) {
  return (
    <p data-list-note className="mb-2 max-w-reading text-meta text-fg-2">
      {files && <><Badge tone="files" />{" "}</>}
      {children}
    </p>
  );
}

/**
 * A list's text matches, as /search matches them (lib/name-match.ts): each row keyed to its rank, lowest best, or
 * null without text. An id keeps each list's own rule, so with one typed no typo is read.
 */
export function nameMatches<T>(rows: readonly T[], text: string | undefined, id: number | null, name: (row: T) => string | null | undefined): { ranked: Map<T, number> | null; respelled?: string } {
  if (!text) return { ranked: null };
  const found = matchNames(rows, text, name, { typo: id === null });
  return { ranked: new Map(found.hits.map((h) => [h.row, h.r])), ...(found.respelled ? { respelled: found.respelled } : {}) };
}

/**
 * Text matches best first (an exact name leads) unless a sort was asked for; the list's own order holds within a rank.
 * A row the text never ranked is one the list kept by its id (the objects list keeps both): it leads, as on /search.
 */
export function byRank<T>(rows: T[], ranked: Map<T, number> | null, sorted: boolean): T[] {
  return ranked && !sorted ? [...rows].sort((a, b) => (ranked.get(a) ?? -1) - (ranked.get(b) ?? -1)) : rows;
}

/** The one line above a list when the typo fallback read the query, as /search says it. */
export function Respelled({ q }: { q: string }) {
  return <p data-respelled className="mb-2 text-cell text-fg-2">Showing results for {q}</p>;
}

/** `?drops=1`: true, absent: undefined, anything else: null. */
export function flag(search: Search, k: string): boolean | undefined | null {
  const v = one(search, k);
  return v === undefined ? undefined : v === "1" ? true : null;
}

/** `?level=10-20` or `?level=12`: a range of whole levels 1 to 999; null when malformed. */
export function range(search: Search, k: string): { min: number; max: number } | undefined | null {
  const v = one(search, k);
  if (v === undefined) return undefined;
  const m = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(v);
  if (!m) return null;
  const min = Number(m[1]), max = Number(m[2] ?? m[1]);
  return min >= 1 && min <= max ? { min, max } : null;
}

export const rangeParam = (r?: { min: number; max: number }) => (r ? (r.min === r.max ? String(r.min) : `${r.min}-${r.max}`) : undefined);

/**
 * Faceted menu counts, the item lists' rule: each menu counts what the list would hold with every other filter on.
 * `tests` holds each filter's test, null while it is off. One pass gives the rows that pass every test (`matched`)
 * and, for each filter, the rows that fail none but its own (`without`), which its menu counts.
 */
export function facetRows<T, K extends string>(rows: readonly T[], tests: Record<K, ((row: T) => boolean) | null>): { matched: T[]; without: Record<K, T[]> } {
  const keys = Object.keys(tests) as K[];
  const on = keys.filter((k) => tests[k] !== null);
  const matched: T[] = [];
  const without = Object.fromEntries(keys.map((k) => [k, [] as T[]])) as Record<K, T[]>;
  for (const row of rows) {
    let missed: K | null = null;
    let many = false;
    for (const k of on) {
      if (tests[k]!(row)) continue;
      if (missed !== null) { many = true; break; }
      missed = k;
    }
    if (many) continue;
    if (missed !== null) { without[missed].push(row); continue; }
    matched.push(row);
    for (const k of keys) without[k].push(row);
  }
  return { matched, without };
}

/**
 * The note under a menu whose options leave rows out: how many of `rows` (a facet's `without`) have no value for it,
 * so the options adding to less than the list says why. Undefined when every row has one.
 */
export function unrecordedNote<T>(rows: readonly T[], has: (row: T) => boolean): string | undefined {
  let n = 0;
  for (const row of rows) if (!has(row)) n++;
  return n ? `Not recorded: ${n.toLocaleString("en-US")}` : undefined;
}

/** How many of `rows` each key holds, in one pass. */
export function countBy<T, V>(rows: readonly T[], key: (row: T) => V): Map<V, number> {
  const out = new Map<V, number>();
  for (const row of rows) out.set(key(row), (out.get(key(row)) ?? 0) + 1);
  return out;
}

/** The level brackets the level menus offer; any other range still works typed into the URL. */
export const LEVEL_BRACKETS = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60]].map(([min, max]) => ({ min, max }));

/**
 * The level brackets of a counted Level menu (NPCs, quests), labelled: LEVEL_BRACKETS and a top "61+" bracket, so the
 * few rows above level 60 have a choice and the counts with the "Not recorded" note add up to the list.
 */
export const COUNTED_LEVEL_BRACKETS = [...LEVEL_BRACKETS.map((b) => ({ ...b, label: `${b.min}–${b.max}` })), { min: 61, max: 999, label: "61+" }];

/** A list URL with its parameters in the given order, empty ones left out. */
export function listHref(path: string, params: [string, string | undefined][]): string {
  const s = new URLSearchParams(params.filter((p): p is [string, string] => Boolean(p[1]))).toString().replace(/%2C/g, ",");
  return s ? `${path}?${s}` : path;
}

export const sortParam = <K extends string>(sort?: { key: K; desc: boolean }) => (sort ? `${sort.desc ? "-" : ""}${sort.key}` : undefined);

/** The sort a header link asks for: the default order (no parameter) when it is the list's default. */
export function nextSort<K extends string>(key: string, dir: SortDirection, fallback: { key: K; desc: boolean }): { key: K; desc: boolean } | undefined {
  const next = { key: key as K, desc: dir === "desc" };
  return next.key === fallback.key && next.desc === fallback.desc ? undefined : next;
}

/** Sorted copy: text keys A to Z with empty ones last either way, numbers ascending; ties by id. */
export function sortRows<T>(rows: T[], key: (row: T) => string | number | null, desc: boolean, id: (row: T) => number): T[] {
  const dir = desc ? -1 : 1;
  return rows.map((row) => ({ row, k: key(row) })).sort((a, b) => {
    if (a.k === null || b.k === null) return a.k === b.k ? id(a.row) - id(b.row) : a.k === null ? 1 : -1;
    const c = typeof a.k === "number" && typeof b.k === "number" ? a.k - b.k : String(a.k).localeCompare(String(b.k));
    return c * dir || id(a.row) - id(b.row);
  }).map((x) => x.row);
}

/**
 * The plain list is indexed, each of its pages under its own URL (a later page is the only path to the rows on
 * it); a filter, a sort or a search is noindex, its canonical page 1 of the plain list.
 */
export function listMetadata(meta: { title: string; description: string; path: string }, plain: boolean, page = 1): Metadata {
  if (plain && page > 1) return pageMetadata({ ...meta, title: `${meta.title} – Page ${page}`, path: listHref(meta.path, [["page", String(page)]]) });
  return { ...pageMetadata(meta), ...(plain ? {} : { robots: { index: false, follow: true } }) };
}

/** A list with no public rows yet: the empty meter, one sentence and a plain link to the addon. */
export function NoObservations({ children }: { children: string }) {
  return (
    <div data-empty-state className="flex flex-wrap items-center gap-3 py-4 text-cell text-fg-2">
      <AgreementMeter count={0} />
      <span>{children}</span>
      <Link href="/addon" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Get the addon</Link>
    </div>
  );
}

/** A filtered list with no rows: one line, the filters as removable chips, and a way back. */
export function NoMatches({ noun, chips, clearHref }: { noun: string; chips: { label: string; href: string }[]; clearHref: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-4 text-cell text-fg-2">
      <span>No {noun} match these filters.</span>
      {chips.map((c) => (
        <Link key={c.href} href={c.href} className="inline-flex h-6 items-center gap-1 rounded-full border border-edge px-2 text-cell-2 text-fg-2 hover:border-fg-2 hover:text-fg">
          {c.label}<span aria-hidden="true">×</span><span className="sr-only">(remove)</span>
        </Link>
      ))}
      <Link href={clearHref} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Clear filters</Link>
    </div>
  );
}

/** A source could not be read: the list is unrecorded, never empty. Storage, unless the line names another source. */
export function Unreadable({ children = STORAGE_UNREACHABLE }: { children?: string }) {
  return <p className="py-4 text-cell text-fg-2">{children}</p>;
}

/** What a list says it holds: the game files' entries and the players' confirmations kept apart. */
export function listCaption(noun: string, rows: readonly { confirmed: boolean }[], confirmations: boolean): string {
  const label = noun.charAt(0).toUpperCase() + noun.slice(1);
  if (!confirmations) return `${label} in the game files: ${rows.length}`;
  return `${label} in the game files or reported by players: ${rows.length}, ${rows.filter((r) => r.confirmed).length} confirmed by players`;
}

/** The Confirmed column. With no rollup read, nothing is known about confirmation: unrecorded, not unconfirmed. */
export function confirmedCell(entry: { confirmed: boolean }, confirmations: boolean): string {
  return entry.confirmed ? "Confirmed" : confirmations ? "Unconfirmed" : "Unrecorded";
}

/** The Confirmed column's cell: "Confirmed", the hollow diamond before "Unconfirmed", or a muted "Unrecorded". */
export function ConfirmedCell({ entry, confirmations }: { entry: { confirmed: boolean }; confirmations: boolean }) {
  const word = confirmedCell(entry, confirmations);
  if (word === "Confirmed") return <span className="text-fg">{word}</span>;
  if (word === "Unrecorded") return <span className="text-muted">{word}</span>;
  // The diamond's own screen-reader word would repeat the cell's, so it says where the entry comes from instead.
  return <span className="inline-flex items-center gap-1.5 text-fg-2"><Badge tone="files">from the game files</Badge>{word}</span>;
}

/** The sentence a list shows when it holds no entry at all: neither the files nor the players have given one. */
export const noneListed = (noun: string): string =>
  `No ${noun} is listed yet. None is in the game files, and none has been confirmed by three installs.`;

/** Shown when the player rollup could not be read: the entries below come from the game files alone. */
export function ConfirmationsUnread() {
  return <p data-confirmations-unread className="py-2 text-cell text-fg-2">Player confirmations could not be read just now, so the Confirmed column is unrecorded.</p>;
}
