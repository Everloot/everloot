import { vi } from "vitest";
import type { ReleaseDb } from "../../../kb/src/release-db";

/** Test-only: one spy that records the SQL and parameters of every read the release runs, through `all` or `get`. */
export function spyOnQueries(db: ReleaseDb) {
  const spy = vi.fn();
  for (const method of ["all", "get"] as const) {
    const read = db[method].bind(db);
    vi.spyOn(db, method).mockImplementation(((sql: string, ...params: unknown[]) => {
      spy(sql, ...params);
      return read(sql, ...params);
    }) as ReleaseDb[typeof method]);
  }
  return spy;
}
