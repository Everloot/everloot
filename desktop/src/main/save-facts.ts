import { readFileSync, statSync } from "node:fs";
import { asksIn, type Ask } from "../../../companion/src/bridge/asks";
import { realmsIn } from "../../../companion/src/prices";
import { parseEverlootTable } from "../../../web/src/lib/sv-parse";
import type { ScanAge } from "../shared/types";
import { scanAgesIn } from "./inspect";

/** What the jobs and pages read from an account file besides its records. */
export interface SaveFacts { realms: string[]; scans: ScanAge[]; asks: Ask[] }

/** One parse per file write (size and write time), shared by the prices and ask jobs, the state push and the pages. */
const memo = new Map<string, { key: string; facts: SaveFacts | Error }>();

/**
 * The file's realms, scan ages and pending asks. A file that cannot be read throws its read error; one that does not
 * parse throws the parse error, kept until the next write. Each caller keeps its own handling of either.
 */
export function saveFacts(file: string): SaveFacts {
  const st = statSync(file), key = `${st.mtimeMs}:${st.size}`;
  let hit = memo.get(file);
  if (!hit || hit.key !== key) {
    const text = readFileSync(file, "utf8");
    let facts: SaveFacts | Error;
    try {
      const db = parseEverlootTable(text);
      facts = { realms: realmsIn(db), scans: scanAgesIn(db), asks: asksIn(db) };
    } catch (err) { facts = err instanceof Error ? err : new Error(String(err)); }
    hit = { key, facts };
    memo.set(file, hit);
  }
  if (hit.facts instanceof Error) throw hit.facts;
  return hit.facts;
}
