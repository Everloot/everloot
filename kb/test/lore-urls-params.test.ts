import { expect, test } from "vitest";
import { loreUrls } from "../src/page-urls.js";
import type { ReleaseDb } from "../src/release-db.js";

// D1 refuses a statement that binds more than 100 parameters; the lore lookup must split a long list.
test("loreUrls asks in batches D1 accepts, and still finds every lore page", async () => {
  const seen: number[] = [];
  const db: ReleaseDb = {
    async all<T>(_sql: string, ...params: unknown[]) {
      seen.push(params.length);
      if (params.length > 100) throw new Error("too many SQL variables");
      return params.filter((p): p is number => typeof p === "number" && p >= 1000).map((id) => ({ id })) as T[];
    },
    async get() { return undefined; },
  };
  const rows = Array.from({ length: 150 }, (_, i) => ({ id: 1000 + i, extId: String(1000 + i), name: `Page ${i}`, kind: "lore_page" }));
  const urls = await loreUrls(db, rows);
  expect(urls.size).toBe(150);
  expect(Math.max(...seen)).toBeLessThanOrEqual(100);
});
