// How many rows a database list shows on one page: 50 unless the address asks for another of PAGE_SIZES with ?per=.

/** Rows on one page of a list when the address names no size. */
export const PER_PAGE = 50;

/** The sizes a reader can pick under a list. */
export const PAGE_SIZES = [25, 50, 100] as const;

/** `?per=100`: a size other than the default; undefined for none or the default (one URL per view); null for anything else. */
export function parsePer(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!/^\d{1,3}$/.test(raw) || !(PAGE_SIZES as readonly number[]).includes(n)) return null;
  return n === PER_PAGE ? undefined : n;
}

/** The ?per= value a link writes: nothing for the default size. */
export const perParam = (per?: number): string | undefined => (per && per !== PER_PAGE ? String(per) : undefined);
