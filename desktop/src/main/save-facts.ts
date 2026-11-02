import { readFileSync, statSync } from "node:fs";
import { asksIn, type Ask } from "../../../companion/src/bridge/asks";
import { realmsIn } from "../../../companion/src/prices";
import { parseEverlootTable } from "../../../web/src/lib/sv-parse";
import type { CharactersInfo, FileSummary, ScanAge } from "../shared/types";
import { charactersAt, collectCharacters, type CharacterBase } from "./characters";

/**
 * What the Upload page shows of the records the upload would send, with the error parseEverlootLua would give
 * (null when it would read the file). `installId` finds the file's confirmed count in sent.json.
 */
export type UploadFacts = Pick<FileSummary, "error" | "addonVersion" | "clientBuild" | "kinds" | "records"> & { installId: string | null };

/**
 * What the jobs and pages read from an account file besides its upload records, and its characters (null for a file
 * the Characters page skips).
 */
export interface SaveFacts { realms: string[]; scans: ScanAge[]; asks: Ask[]; characters: CharacterBase | null; upload: UploadFacts }

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
      const check = { extra: null as string | null };
      const db = parseEverlootTable(text, check);
      facts = { realms: realmsIn(db), scans: scanAgesIn(db), asks: asksIn(db), characters: charactersIn(db), upload: uploadIn(db, check.extra) };
    } catch (err) { facts = err instanceof Error ? err : new Error(String(err)); }
    hit = { key, facts };
    memo.set(file, hit);
  }
  if (hit.facts instanceof Error) throw hit.facts;
  return hit.facts;
}

/** When the player last ran a full scan on each realm (`EverlootDB.lastScans`), newest first. */
export function scanAgesIn(db: Record<string, unknown>): ScanAge[] {
  const scans = db.lastScans;
  if (!scans || typeof scans !== "object") return [];
  const out: ScanAge[] = [];
  for (const [realm, v] of Object.entries(scans as Record<string, unknown>)) {
    const at = v && typeof v === "object" && typeof (v as { at?: unknown }).at === "string" ? (v as { at: string }).at : null;
    if (realm.trim().length >= 2) out.push({ realm: realm.trim(), at });
  }
  return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

/**
 * The record counts by kind, from the same parse, with parseEverlootLua's checks and errors in its order, so the Upload
 * page shows what the upload job would read without parsing the file again.
 */
function uploadIn(db: Record<string, unknown>, extra: string | null): UploadFacts {
  const refused = (error: string): UploadFacts => ({ error, addonVersion: null, clientBuild: null, kinds: [], records: 0, installId: null });
  if (extra) return refused(extra);
  const { version, installId, records: groups, clientBuild } = db;
  if (typeof version !== "string" || typeof installId !== "string") return refused("EverlootDB needs version + installId strings");
  if (!groups || typeof groups !== "object") return refused("EverlootDB.records is not a table");
  const counts = new Map<string, number>();
  let records = 0;
  // An empty or list-shaped records table has no named groups; parseEverlootLua reads only the named part (not __array).
  for (const [kind, rows] of Array.isArray(groups) ? [] : Object.entries(groups)) {
    if (kind === "__array") continue;
    if (!Array.isArray(rows)) return refused(`records.${kind} is not a list`);
    for (const row of rows) if (!row || typeof row !== "object" || Array.isArray(row)) return refused(`records.${kind} holds a non-row`);
    counts.set(kind, (counts.get(kind) ?? 0) + rows.length);
    records += rows.length;
  }
  const kinds = [...counts].filter(([, count]) => count > 0).map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  return { error: null, addonVersion: version, clientBuild: typeof clientBuild === "string" ? clientBuild : null, kinds, records, installId };
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
