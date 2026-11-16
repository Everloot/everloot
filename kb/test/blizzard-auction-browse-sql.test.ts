import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("Blizzard browse, history and stored-time readers preserve snapshots, retention and privileges", async () => {
  const db = new PGlite();
  const read = (path: string) => readFileSync(new URL(`../../supabase/${path}`, import.meta.url), "utf8");
  try {
    await db.exec("create role anon; create role authenticated; create role service_role; create role backup_exporter;");
    await db.exec(read("migrations/20261113120000_blizzard_auctions.sql"));
    await db.exec(read("tests/blizzard_auctions.sql"));
    for (let i = 0; i < 2; i++) await db.exec(read("migrations/20261115160000_blizzard_auction_browse.sql"));
    await db.exec(read("tests/blizzard_auction_browse.sql"));
    for (let i = 0; i < 2; i++) await db.exec(read("migrations/20261116230000_blizzard_auction_stamps.sql"));
    await db.exec(read("tests/blizzard_auction_stamps.sql"));
    expect((await db.query("select count(*)::int as n from public.blizzard_auction_prices")).rows).toEqual([{ n: 0 }]);
  } finally { await db.close(); }
}, 30_000);
