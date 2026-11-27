/**
 * One-time repair for armory characters stored with no item levels. It reads; it never writes to production.
 *
 * Since 2026-11-24/25, Blizzard's Forever equipment answer has no item level for a character who has logged in since the
 * change. The crawler stored those reads with null levels until PR #1641 (2026-11-27), and since then keeps a stored
 * level only when one exists, so these rows have no ranked item level and no Gear Score and are missing from the boards
 * and the /players gear columns. The armory pages fill the levels in at display time (lib/armory-file-levels.ts); this
 * script prepares the same fill for the stored rows.
 *
 * What it does:
 * 1. Reads every armory_characters row with at least one equipped item of null level, through the Supabase Management
 *    API's read-only query (a database_read token is enough: it runs as supabase_read_only_user).
 * 2. Reads the game files' item level for each of those item ids (ItemSparse, the private item shards the site reads).
 * 3. For each row where at least one item gets a level: fills the null levels and recomputes item_level and gear_score
 *    with the crawler's formula (kb/src/armory/gear.ts). An item the files give no level stays null (an empty slot).
 *    A level already stored is never changed; Blizzard's equipped and average item levels are left as they are.
 * 4. Prints the counts. With --sql <file>, writes one SQL file for the owner to review and apply (Supabase SQL editor,
 *    as the postgres role). The SQL changes only equipment, item_level and gear_score, and only where the row's
 *    fetched_at is still the one read here, so a row the crawler has re-read since is left alone. It does not touch
 *    fetched_at or checked_at (the pages' "Last read"), details, or the queue, as the crawler's upsert would.
 *
 * Run from web/ (dry run, counts only):
 *   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... NEXT_PUBLIC_GAME_ASSETS_URL=... \
 *   GAME_DATA_S3_ENDPOINT=... GAME_DATA_BUCKET=... GAME_DATA_ACCESS_KEY_ID=... GAME_DATA_SECRET_ACCESS_KEY=... \
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/repair-armory-item-levels.ts [--limit <rows>] [--sql <file>]
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { gearNumbers } from "@kb/armory/gear";

/** A stored equipped item, as the crawler writes it (kb/src/armory/parse.ts). */
export interface StoredItem { slot: string; item_id: number; name?: string; level: number | null; quality?: string; inventory_type?: string }
export interface StoredRow {
  region: string; slug: string; fetched_at: string; level: number;
  item_level: number | null; gear_score: number | null; equipment: StoredItem[];
}
export interface Repair {
  region: string; slug: string; fetched_at: string; level: number;
  /** Items that get the files' level, and items that stay without one. */
  filled: number; missing: number;
  before: { item_level: number | null; gear_score: number | null };
  after: { item_level: number | null; gear_score: number | null };
}

/** The row's repair, or null when the files give a level for none of its items without one. */
export function repairRow(row: StoredRow, fileLevel: (itemId: number) => number | null | undefined): Repair | null {
  let filled = 0, missing = 0;
  const items = row.equipment.map((i) => {
    if (i.level != null) return i;
    const level = fileLevel(i.item_id);
    if (level == null || !(level > 0)) { missing++; return i; }
    filled++;
    return { ...i, level };
  });
  if (filled === 0) return null;
  const n = gearNumbers(items.map((i) => ({
    slot: { type: i.slot }, item: { id: i.item_id }, name: i.name ?? "", level: i.level == null ? null : { value: i.level },
    quality: { type: i.quality ?? "" }, inventory_type: { type: i.inventory_type ?? "" },
  })));
  return {
    region: row.region, slug: row.slug, fetched_at: row.fetched_at, level: row.level, filled, missing,
    before: { item_level: row.item_level, gear_score: row.gear_score },
    after: { item_level: n.item_level, gear_score: n.gear_score },
  };
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const num = (n: number | null) => {
  if (n === null) return "null";
  if (!Number.isFinite(n)) throw new Error(`not a number: ${n}`);
  return String(n);
};
const int = (n: number) => {
  if (!Number.isSafeInteger(n)) throw new Error(`not an integer: ${n}`);
  return String(n);
};

/**
 * One transaction: the files' level per item id and the recomputed numbers per row in temporary tables, then one update
 * that fills each null level from the first and sets the numbers from the second, guarded by fetched_at.
 */
export function repairSql(repairs: readonly Repair[], levels: ReadonlyMap<number, number>, header: string): string {
  const ids = [...levels.keys()].sort((a, b) => a - b);
  const chunk = <T,>(xs: readonly T[], size = 1000) => Array.from({ length: Math.ceil(xs.length / size) }, (_, k) => xs.slice(k * size, (k + 1) * size));
  return [
    ...header.split("\n").map((l) => `-- ${l}`),
    "begin;",
    "create temp table repair_levels(item_id integer primary key, level integer not null) on commit drop;",
    ...chunk(ids).map((part) => `insert into repair_levels values ${part.map((id) => `(${int(id)},${int(levels.get(id)!)})`).join(",")};`),
    "create temp table repair_rows(region text, slug text, fetched_at timestamptz, item_level numeric, gear_score numeric, primary key(region, slug)) on commit drop;",
    ...chunk(repairs).map((part) => `insert into repair_rows values ${part.map((r) => `(${lit(r.region)},${lit(r.slug)},${lit(r.fetched_at)},${num(r.after.item_level)},${num(r.after.gear_score)})`).join(",")};`),
    "update public.armory_characters c set",
    "  equipment = (select coalesce(jsonb_agg(case when x.e->>'level' is null and l.level is not null then jsonb_set(x.e, '{level}', to_jsonb(l.level)) else x.e end order by x.o), '[]'::jsonb)",
    "               from jsonb_array_elements(c.equipment) with ordinality as x(e, o) left join repair_levels l on l.item_id = (x.e->>'item_id')::integer),",
    "  item_level = r.item_level, gear_score = r.gear_score",
    "from repair_rows r",
    "where c.region = r.region and c.slug = r.slug and c.fetched_at = r.fetched_at;",
    `-- Expect UPDATE ${repairs.length} or fewer: a row read again since this file was made is skipped.`,
    "commit;",
    "",
  ].join("\n");
}

/** A read-only query through the Management API (POST /v1/projects/{ref}/database/query, read_only). */
async function query<T>(sql: string, token: string, ref: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T[];
}

/** Every row with an equipped item of null level, in pages ordered by region and slug. */
async function readRows(token: string, ref: string, limit: number): Promise<StoredRow[]> {
  const rows: StoredRow[] = [];
  let after: [string, string] = ["", ""];
  while (rows.length < limit) {
    const page = await query<StoredRow>(
      `select region, slug, fetched_at::text as fetched_at, level, item_level::float8 as item_level, gear_score::float8 as gear_score, equipment
       from public.armory_characters
       where exists (select 1 from jsonb_array_elements(equipment) e where e->>'level' is null)
         and (region, slug) > (${lit(after[0])}, ${lit(after[1])})
       order by region, slug limit ${Math.min(1000, limit - rows.length)}`,
      token, ref,
    );
    rows.push(...page);
    if (page.length < 1000) break;
    after = [page.at(-1)!.region, page.at(-1)!.slug];
  }
  return rows;
}

async function main(argv: string[]) {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const sqlOut = arg("--sql");
  const limit = Number(arg("--limit") ?? Infinity);
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim(), ref = process.env.SUPABASE_PROJECT_REF?.trim();
  if (!token || !ref) throw new Error("set SUPABASE_ACCESS_TOKEN (database_read is enough) and SUPABASE_PROJECT_REF");
  const { loadItemLevels, loadSiteAssets, privateStoreFromEnv } = await import("../src/lib/game-assets");
  const assets = await loadSiteAssets();
  const store = privateStoreFromEnv();
  if (!assets || !store) throw new Error("set NEXT_PUBLIC_GAME_ASSETS_URL and the GAME_DATA_* read key: the item levels come from the game files");

  const rows = await readRows(token, ref, limit);
  const ids = [...new Set(rows.flatMap((r) => r.equipment.filter((i) => i.level == null).map((i) => i.item_id)))];
  const read = await loadItemLevels(assets, ids, store);
  const levels = new Map([...read].filter(([, l]) => l.level > 0).map(([id, l]) => [id, l.level]));
  const repairs = rows.flatMap((r) => repairRow(r, (id) => levels.get(id)) ?? []);

  const counts = {
    build: assets.version,
    rows_with_null_levels: rows.length,
    rows_repaired: repairs.length,
    rows_fully_filled: repairs.filter((r) => r.missing === 0).length,
    rows_still_missing_some: repairs.filter((r) => r.missing > 0).length,
    rows_files_know_nothing: rows.length - repairs.length,
    level_60_repaired: repairs.filter((r) => r.level >= 60).length,
    item_level_from_null: repairs.filter((r) => r.before.item_level === null && r.after.item_level !== null).length,
    item_level_changed: repairs.filter((r) => r.before.item_level !== null && r.before.item_level !== r.after.item_level).length,
    item_ids_without_level: ids.length,
    item_ids_known_in_files: levels.size,
    items_filled: repairs.reduce((a, r) => a + r.filled, 0),
    items_left_null: rows.reduce((a, r) => a + r.equipment.filter((i) => i.level == null).length, 0) - repairs.reduce((a, r) => a + r.filled, 0),
  };
  console.log(JSON.stringify(counts, null, 1));
  for (const r of repairs.slice(0, 5)) console.log(`${r.region}/${r.slug}: item level ${r.before.item_level} -> ${r.after.item_level}, Gear Score ${r.before.gear_score} -> ${r.after.gear_score}, ${r.filled} filled, ${r.missing} left`);
  if (sqlOut) {
    const header = `Armory item-level repair, made ${new Date().toISOString()} from game files build ${assets.version}.\n${repairs.length} rows, ${levels.size} item levels. Review, then run as the postgres role. See web/scripts/repair-armory-item-levels.ts.`;
    writeFileSync(sqlOut, repairSql(repairs, levels, header));
    console.log(`wrote ${sqlOut}`);
  } else {
    console.log("Dry run: nothing written. Add --sql <file> to write the SQL for review.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
