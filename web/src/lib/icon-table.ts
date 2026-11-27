// A manifest's icon tables (spell id -> "fileId.webp" and the like), kept small. The live manifest carries ~32k spell
// icons; as a Map of ready URLs that was ~4 MB per isolate, held for as long as the isolate lives. Here each table is two
// Int32Arrays (ids in ascending order, file ids beside them, 8 bytes an icon) and `get` builds the URL when a page asks.

/** What a page reads from an icon table. A Map of URLs is one too (page tests pass those). */
export interface IconsById {
  readonly size: number;
  get(id: number): string | undefined;
  has(id: number): boolean;
  /** In ascending order. */
  keys(): Iterable<number>;
}

/** Builds an icon's URL from the asset folder and its name; a module function, so a table holds no closure over the parse. */
export type IconUrl = (base: string, name: string) => string;

const INT32_MAX = 2 ** 31 - 1;
// The form the producer writes: a plain decimal id and "<file id>.webp", both in 32 bits, so they read back exactly.
const ID = /^(0|[1-9]\d{0,9})$/;
const FILE = /^(0|[1-9]\d{0,9})\.webp$/;

class CompactIcons implements IconsById {
  constructor(
    private readonly ids: Int32Array, private readonly files: Int32Array,
    private readonly base: string, private readonly url: IconUrl,
  ) {}
  get size() { return this.ids.length; }
  private find(id: number): number {
    const { ids } = this;
    let lo = 0;
    let hi = ids.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const v = ids[mid];
      if (v === id) return mid;
      if (v < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
  get(id: number) {
    const i = this.find(id);
    return i < 0 ? undefined : this.url(this.base, `${this.files[i]}.webp`);
  }
  has(id: number) { return this.find(id) >= 0; }
  keys() { return this.ids.values(); }
}

/**
 * A manifest's icon table as read for pages: id -> `url(base, name)` for keys that are whole numbers (others are left out), or
 * null when the table is not an object of icon names that pass `isPath` (the manifest's path rule). Missing reads as
 * empty. The table itself is not kept: in the producer's form it becomes two typed arrays, in any other a Map of URLs as
 * before. Read straight from the parsed JSON rather than through a schema, which would copy the whole table first.
 */
export function iconTable(table: unknown, base: string, url: IconUrl, isPath: (name: string) => boolean): IconsById | null {
  if (table === undefined) return new Map();
  if (typeof table !== "object" || table === null || Array.isArray(table)) return null;
  const record = table as Record<string, unknown>;
  const keys = Object.keys(record);
  const ids = new Int32Array(keys.length);
  const files = new Int32Array(keys.length);
  let n = 0;
  let compact = true;
  for (const key of keys) {
    const name = record[key];
    if (typeof name !== "string") return null;
    const m = FILE.exec(name);
    if (!m && !isPath(name)) return null;
    if (!compact) continue;
    if (!ID.test(key)) {
      if (/^\d+$/.test(key)) compact = false;
      continue;
    }
    const id = Number(key);
    const file = m ? Number(m[1]) : NaN;
    // Ascending, as an object lists whole-number keys; anything else keeps the Map, so its order and lookups stay as they were.
    if (!m || id > INT32_MAX || file > INT32_MAX || (n > 0 && id <= ids[n - 1])) { compact = false; continue; }
    ids[n] = id;
    files[n] = file;
    n++;
  }
  if (compact) return new CompactIcons(ids.slice(0, n), files.slice(0, n), base, url);
  return new Map(keys.filter((id) => /^\d+$/.test(id)).map((id) => [Number(id), url(base, record[id] as string)] as const));
}
