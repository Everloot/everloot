const RANGE = /^(?:(\d+)-(\d+)|\*)\/(\d+)$/;

/**
 * Every row of a PostgREST table, read a page at a time from `offset`, or an error when the pages cannot be shown to
 * hold all of them. Each request must send `Prefer: count=exact`: the total in Content-Range says when the read is
 * complete, not a short page. A missing or inconsistent range, or pages that stop before the total, are an error, so a
 * caller that withholds names on a failed read never takes part of a hide list for the whole of it.
 */
export async function readAllRows(page: (offset: number) => Promise<Response>): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (;;) {
    const response = await page(rows.length);
    const part: unknown = await response.json();
    if (!Array.isArray(part)) throw new Error("Invalid rows");
    const range = RANGE.exec(response.headers.get("content-range")?.trim() ?? "");
    if (!range) throw new Error("Row count missing");
    const first = range[1] === undefined ? null : Number(range[1]);
    const matches = part.length === 0 ? first === null : first === rows.length && Number(range[2]) - first + 1 === part.length;
    if (!matches) throw new Error("Rows do not match their range");
    rows.push(...part);
    if (rows.length >= Number(range[3])) return rows;
    if (part.length === 0) throw new Error("Rows stopped before their count");
  }
}
