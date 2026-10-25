import type { Metadata } from "next";
import Link from "next/link";
import { AgreementMeter, type SortDirection } from "@/components/ui";
import { pageMetadata } from "@/lib/seo";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";

// What the database lists other than items share: their query strings, their indexing rule and their empty
// states (density spec, 2026-10-20, section 4).

export type Search = Record<string, string | string[] | undefined>;

/** Rows on one page of a list. */
export const PER_PAGE = 50;

const one = (search: Search, k: string) => (typeof search[k] === "string" ? (search[k] as string) : undefined);

/** A list's sort and page, and its name box; null when a value is malformed (the page answers 404). */
export interface ListQuery<K extends string> { q?: string; sort?: { key: K; desc: boolean }; page: number }

export function listQuery<K extends string>(search: Search, sorts: readonly K[]): ListQuery<K> | null {
  const sort = one(search, "sort"), page = one(search, "page");
  const sorted = sort === undefined ? undefined : /^(-?)([a-z]+)$/.exec(sort);
  if (sort !== undefined && (!sorted || !(sorts as readonly string[]).includes(sorted[2]))) return null;
  if (page !== undefined && !/^[1-9]\d{0,4}$/.test(page)) return null;
  const q = one(search, "q")?.trim().slice(0, 60);
  return { ...(q ? { q } : {}), ...(sorted ? { sort: { key: sorted[2] as K, desc: sorted[1] === "-" } } : {}), page: page === undefined ? 1 : Number(page) };
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

/** The level brackets the level menus offer; any other range still works typed into the URL. */
export const LEVEL_BRACKETS = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60]].map(([min, max]) => ({ min, max }));

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

/** Storage could not be read: the list is unrecorded, never empty. */
export function Unreadable() {
  return <p className="py-4 text-cell text-fg-2">{STORAGE_UNREACHABLE}</p>;
}
