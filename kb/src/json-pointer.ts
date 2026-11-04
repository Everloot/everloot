/** The most rows any one answer carries from an array. */
export const MAX_ROWS = 48;

export type PointerRead = { ok: true; value: unknown } | { ok: false; keys: string[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const keysOf = (v: unknown): string[] => (isObject(v) ? Object.keys(v) : []);

/**
 * Reads an RFC 6901 JSON pointer from `root`. "" is the root. A pointer that leads nowhere is a miss, never a throw:
 * `keys` are the own keys of the deepest object reached, empty when that is not an object.
 */
export function readPointer(root: unknown, pointer: string): PointerRead {
  if (pointer === "") return { ok: true, value: root };
  if (!pointer.startsWith("/")) return { ok: false, keys: keysOf(root) };
  let at: unknown = root;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(at)) {
      // Only a canonical index reads: no "-", no leading zeros, no "length".
      if (!/^(0|[1-9]\d*)$/.test(token) || Number(token) >= at.length) return { ok: false, keys: [] };
      at = at[Number(token)];
    } else if (isObject(at) && Object.hasOwn(at, token)) {
      at = at[token];
    } else {
      return { ok: false, keys: keysOf(at) };
    }
  }
  return { ok: true, value: at };
}

/**
 * One page of an array: `limit` is held to [1, MAX_ROWS] and `offset` to 0 or more. `nextOffset` is present only when
 * rows remain after the page. Anything that is not an array passes through unchanged.
 */
export function pageArray(value: unknown, offset: number, limit: number): { value: unknown; nextOffset?: number } {
  if (!Array.isArray(value)) return { value };
  const from = Math.max(0, Math.floor(offset));
  const to = from + Math.min(MAX_ROWS, Math.max(1, Math.floor(limit)));
  const page = value.slice(from, to);
  return to < value.length ? { value: page, nextOffset: to } : { value: page };
}

/**
 * Every top-level array longer than MAX_ROWS cut to its first MAX_ROWS rows, with a sibling `<name>NextOffset` saying
 * where the rest starts. `cut` says whether anything was cut.
 */
export function cutArrays(data: Record<string, unknown>): { data: Record<string, unknown>; cut: boolean } {
  let cut = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.length > MAX_ROWS) {
      cut = true;
      out[key] = value.slice(0, MAX_ROWS);
      out[`${key}NextOffset`] = MAX_ROWS;
    } else out[key] = value;
  }
  return { data: cut ? out : data, cut };
}

export type FieldRead =
  | { ok: true; pointer: string; value: unknown; nextOffset?: number; from: number; total?: number }
  | { ok: false; keys: string[] };

/**
 * One field of a record's data: the value at `pointer`, an array as one page of it, an object with its own long arrays
 * cut. `from` is the row the page starts at and `total` the array's length, when the value is an array.
 */
export function readField(data: Record<string, unknown>, pointer: string, offset: number, limit: number): FieldRead {
  const read = readPointer(data, pointer);
  if (!read.ok) return read;
  if (Array.isArray(read.value)) {
    const paged = pageArray(read.value, offset, limit);
    return { ok: true, pointer, ...paged, from: Math.max(0, Math.floor(offset)), total: read.value.length };
  }
  const value = isObject(read.value) ? cutArrays(read.value).data : read.value;
  return { ok: true, pointer, value, from: 0 };
}
