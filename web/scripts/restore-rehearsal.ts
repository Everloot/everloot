/**
 * Restore rehearsal for an R2 mirror (scripts/backup-r2.mjs): rebuild the public corpus from the
 * mirrored raw uploads with the site's own local store, in a scratch folder, and check that every
 * event the backed-up snapshot published comes back. Nothing touches production.
 * Run: npx tsx scripts/restore-rehearsal.ts <mirror folder>
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUploadStore } from "../src/lib/upload-store";
import { canonicalJson, publicRecords, type CorpusState } from "../../kb/src/corpus";

type Row = { installId: string; eventId: string };
type Entry = { record: Row; grants: string[] };

function readObject(file: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error("restore input is missing or invalid JSON");
  }
}

function index(rows: unknown[], internal: boolean) {
  const indexed = new Map<string, { label: string; contents: string }>();
  for (const value of rows) {
    const entry = value as Entry;
    const row = (internal ? entry?.record : value) as Row;
    if (!row || typeof row.installId !== "string" || !row.installId || typeof row.eventId !== "string" || !row.eventId) {
      throw new Error("snapshot event has no valid identity");
    }
    if (internal && (!Array.isArray(entry.grants) || entry.grants.some((grant) => typeof grant !== "string"))) {
      throw new Error("snapshot event grants are invalid");
    }
    const key = JSON.stringify([row.installId, row.eventId]);
    if (indexed.has(key)) throw new Error("duplicate snapshot event identity");
    const contents = internal ? { record: row, grants: [...new Set(entry.grants)].sort() } : row;
    indexed.set(key, { label: `${row.installId}|${row.eventId}`, contents: canonicalJson(contents) });
  }
  return indexed;
}

export async function rehearseRestore(mirror: string) {
  const snapshot = readObject(join(mirror, "snapshots", "corpus.json"));
  const internal = "corpusState" in snapshot;
  const state = snapshot.corpusState as CorpusState | undefined;
  const rows = internal ? state?.events : snapshot.records;
  if (!Array.isArray(rows) || (internal && (state?.version !== 1 || !Array.isArray(state.conflicts)
      || state.conflicts.some((conflict) => typeof conflict !== "string")))) {
    throw new Error("snapshot structure is invalid");
  }
  const expected = index(rows, internal);
  if (!expected.size) throw new Error("empty snapshot cannot establish recovery");
  const scratch = mkdtempSync(join(tmpdir(), "everloot-restore-"));
  try {
    // The local store reads <dir>/uploads/*.json; the bucket nests them by date.
    mkdirSync(join(scratch, "uploads"));
    let uploads = 0;
    const root = join(mirror, "uploads");
    for (const day of existsSync(root) ? readdirSync(root).sort() : []) {
      for (const file of readdirSync(join(root, day)).filter((f) => f.endsWith(".json")).sort()) {
        const source = join(root, day, file);
        if (!Array.isArray(readObject(source).records)) throw new Error("upload records are invalid");
        cpSync(source, join(scratch, "uploads", `${uploads}-${file}`));
        uploads++;
      }
    }
    let rebuiltState: CorpusState | undefined;
    const store = createUploadStore({ cloud: null, localDir: scratch, cacheMs: 0,
      publication: async (corpusState) => { rebuiltState = corpusState; return publicRecords(corpusState); },
    });
    const corpus = await store.loadCorpus();
    if (corpus.unreachable || !rebuiltState) throw new Error("rebuilt corpus is unreadable");
    const rebuilt = index(internal ? rebuiltState.events : corpus.records, internal);
    const missing: string[] = [], changed: string[] = [];
    for (const [key, row] of expected) {
      const actual = rebuilt.get(key);
      if (!actual) missing.push(row.label);
      else if (actual.contents !== row.contents) changed.push(row.label);
    }
    const expectedConflicts = internal ? state!.conflicts : snapshot.conflictTombstones ?? [];
    if (!Array.isArray(expectedConflicts) || expectedConflicts.some((conflict) => typeof conflict !== "string")) {
      throw new Error("snapshot conflicts are invalid");
    }
    const conflictsMatch = canonicalJson([...expectedConflicts].sort()) === canonicalJson([...rebuiltState.conflicts].sort());
    return { ok: missing.length === 0 && changed.length === 0 && conflictsMatch,
      uploads, rebuilt: rebuilt.size, snapshot: expected.size, missing, changed, conflictsMatch };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Run directly (npx tsx): this package is CommonJS, so no top-level await. Imported by tests: skipped.
if (typeof require !== "undefined" && require.main === module) void (async () => {
  const mirror = process.argv[2];
  if (!mirror) throw new Error("usage: npx tsx scripts/restore-rehearsal.ts <mirror folder>");
  const result = await rehearseRestore(mirror);
  console.log(JSON.stringify({ ...result, missing: result.missing.length, changed: result.changed.length }, null, 1));
  if (!result.ok) process.exit(1);
})();
