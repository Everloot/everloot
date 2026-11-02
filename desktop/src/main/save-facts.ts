import { readFileSync, statSync } from "node:fs";
import { asksIn, type Ask } from "../../../companion/src/bridge/asks";
import { realmsIn } from "../../../companion/src/prices";
import { parseEverlootTable } from "../../../web/src/lib/sv-parse";
import type { CharactersInfo, ScanAge } from "../shared/types";
import { charactersAt, collectCharacters, type CharacterBase } from "./characters";
import { scanAgesIn } from "./inspect";

/**
 * What the jobs and pages read from an account file besides its upload records, and its characters (null for a file
 * the Characters page skips).
 */
export interface SaveFacts { realms: string[]; scans: ScanAge[]; asks: Ask[]; characters: CharacterBase | null }

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
      facts = { realms: realmsIn(db), scans: scanAgesIn(db), asks: asksIn(db), characters: charactersIn(db) };
    } catch (err) { facts = err instanceof Error ? err : new Error(String(err)); }
    hit = { key, facts };
    memo.set(file, hit);
  }
  if (hit.facts instanceof Error) throw hit.facts;
  return hit.facts;
}

/**
 * The characters in the file, from the same parse, so the Characters page, the chat's my_characters and the realm
 * suggestions do not read every save again. Null for a file parseEverlootLua would refuse: no version or installId,
 * or a records group that is not a list of rows.
 */
function charactersIn(db: Record<string, unknown>): CharacterBase | null {
  const groups = db.records;
  if (typeof db.version !== "string" || typeof db.installId !== "string" || !groups || typeof groups !== "object") return null;
  const records: Array<Record<string, unknown>> = [];
  // An empty records table reads as an empty list.
  for (const [kind, rows] of Array.isArray(groups) ? [] : Object.entries(groups)) {
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      records.push({ ...(row as Record<string, unknown>), kind });
    }
  }
  return collectCharacters(records);
}

/** Every account file's characters at `now`, in file order. A file that cannot be read shows on the Upload page. */
export function charactersFromFiles(files: string[], now = Date.now()): CharactersInfo {
  const all: CharactersInfo = { characters: [], progress: [], talents: [] };
  for (const file of files) {
    let base: CharacterBase | null;
    try { base = saveFacts(file).characters; } catch { continue; }
    if (!base) continue;
    const one = charactersAt(base, now);
    all.characters.push(...one.characters); all.progress.push(...one.progress); all.talents.push(...one.talents);
  }
  return all;
}
