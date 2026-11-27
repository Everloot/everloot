import { expect, test } from "vitest";
import { repairRow, repairSql, type StoredRow } from "./repair-armory-item-levels";

const row = (over: Partial<StoredRow> = {}): StoredRow => ({
  region: "eu", slug: "earl-loralrin", fetched_at: "2026-11-27 17:22:16.6442+00", level: 60, item_level: null, gear_score: null,
  equipment: [
    { slot: "HEAD", item_id: 16846, name: "Giantstalker's Helmet", level: null, quality: "EPIC", inventory_type: "HEAD" },
    { slot: "MAIN_HAND", item_id: 17069, name: "Striker's Mark", level: null, quality: "RARE", inventory_type: "RANGEDRIGHT" },
    { slot: "CHEST", item_id: 99999, name: "Not In The Files", level: null, quality: "RARE", inventory_type: "CHEST" },
  ],
  ...over,
});
const files = new Map([[16846, 66], [17069, 69]]);

test("a row's null levels take the game files' levels and its numbers are recomputed; an item the files lack stays null", () => {
  const r = repairRow(row(), (id) => files.get(id))!;
  expect(r).toMatchObject({ region: "eu", slug: "earl-loralrin", filled: 2, missing: 1, before: { item_level: null, gear_score: null } });
  expect(r.after.item_level).toBe(7);
  expect(r.after.gear_score).not.toBeNull();
  // A stored level is never changed: with HEAD stored at 70 only MAIN_HAND is filled.
  const kept = repairRow(row({ equipment: row().equipment.map((i) => (i.slot === "HEAD" ? { ...i, level: 70 } : i)) }), (id) => files.get(id))!;
  expect(kept).toMatchObject({ filled: 1, after: { item_level: Math.floor((70 + 69) / 17) } });
  // Nothing the files know: no repair.
  expect(repairRow(row(), () => null)).toBeNull();
  expect(repairRow(row(), () => 0)).toBeNull();
});

test("the SQL fills levels and sets the numbers in one transaction, only for rows not read again since", () => {
  const r = repairRow(row({ slug: "o'neil-x" }), (id) => files.get(id))!;
  const sql = repairSql([r], files, "made for a test\nsecond line");
  expect(sql.startsWith("-- made for a test\n-- second line\nbegin;\n")).toBe(true);
  expect(sql).toContain("insert into repair_levels values (16846,66),(17069,69);");
  expect(sql).toContain(`insert into repair_rows values ('eu','o''neil-x','2026-11-27 17:22:16.6442+00',7,${r.after.gear_score});`);
  expect(sql).toContain("where c.region = r.region and c.slug = r.slug and c.fetched_at = r.fetched_at;");
  // Only the three columns: never the read times, details or the queue.
  const update = sql.slice(sql.indexOf("update public.armory_characters"));
  expect(update).not.toMatch(/fetched_at\s*=\s*now|checked_at|details|armory_queue/);
  expect(sql.trimEnd().endsWith("commit;")).toBe(true);
});
