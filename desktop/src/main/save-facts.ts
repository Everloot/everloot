import { readFileSync, statSync } from "node:fs";
import { asksIn, type Ask } from "../../../companion/src/bridge/asks";
import { realmsIn } from "../../../companion/src/prices";
import { parseEverlootTable } from "../../../web/src/lib/sv-parse";
import type { ScanAge } from "../shared/types";
import { summarizeRecords } from "./characters";
import { scanAgesIn } from "./inspect";

/** What the jobs and pages read from an account file besides its records, and the realms of its characters. */
export interface SaveFacts { realms: string[]; scans: ScanAge[]; asks: Ask[]; characterRealms: string[] }

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
      facts = { realms: realmsIn(db), scans: scanAgesIn(db), asks: asksIn(db), characterRealms: characterRealmsIn(db) };
    } catch (err) { facts = err instanceof Error ? err : new Error(String(err)); }
    hit = { key, facts };
    memo.set(file, hit);
  }
  if (hit.facts instanceof Error) throw hit.facts;
  return hit.facts;
}

/**
 * The realm of each character in the file, richest first and repeats kept, as the Characters page lists them. Read
 * from the same parse, so the Overview and the Market page do not read every save again to suggest realms. A file
 * the Characters page would skip (no version or installId, a records group that is not a list of rows) has none.
 */
function characterRealmsIn(db: Record<string, unknown>): string[] {
  const groups = db.records;
  if (typeof db.version !== "string" || typeof db.installId !== "string" || !groups || typeof groups !== "object" || Array.isArray(groups)) return [];
  const records: Array<Record<string, unknown>> = [];
  for (const [kind, rows] of Object.entries(groups)) {
    if (!Array.isArray(rows)) return [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return [];
      records.push({ ...(row as Record<string, unknown>), kind });
    }
  }
  return summarizeRecords(records).characters.map((c) => c.realm);
}
