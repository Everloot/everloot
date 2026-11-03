import { CENSUS_KINDS, COMPLETION_KINDS, PULL_KINDS, parseRecords, type IntakeRecord } from "@everloot/protocol";
import { foldRecorderInstalls } from "./recorder-installs.js";

export interface CorpusEvent { record: IntakeRecord; grants: string[] }
export interface CorpusState {
  version: 1;
  events: CorpusEvent[];
  conflicts: string[];
  legacyRecords: number;
}

export function eventKey(row: IntakeRecord): string {
  return JSON.stringify([row.installId, row.eventId]);
}

export function namedRecord(row: IntakeRecord): boolean {
  return "guildName" in row || "character" in row || row.kind === "collection_owned";
}

/** Stable object-key order; array order remains part of the observed event. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);
}

/**
 * True when `rich` is `poor` plus fields `poor` lacks, every shared field equal. An uploader built on an older
 * protocol drops the fields it does not know; the same event sent later with them is the same event, not a conflict.
 */
function addsFieldsOnly(rich: IntakeRecord, poor: IntakeRecord): boolean {
  const r = rich as Record<string, unknown>;
  const p = poor as Record<string, unknown>;
  return Object.keys(p).every((k) => k in r && canonicalJson(r[k]) === canonicalJson(p[k]));
}

/** No time/hash backfill for legacy observations: it could merge legitimate events. */
export function mergeCorpus(previous: CorpusState | undefined, raw: readonly unknown[], grantIds: string[] = []): CorpusState {
  const events = new Map<string, CorpusEvent>();
  const conflicts = new Set(previous?.conflicts ?? []);
  let legacyRecords = previous?.legacyRecords ?? 0;
  for (const e of previous?.events ?? []) events.set(eventKey(e.record), e);
  for (const parsed of parseRecords(raw).records) {
    // Full scans are thousands of items each; the market rollup (kb/src/market.ts) reads them from
    // the uploads, so the corpus every page loads does not grow with them.
    if (parsed.kind === "auction_snapshot") continue;
    // The completion kinds are folded into their own rollup (kb/src/completion-rollup.ts), latest row per
    // character and id, so this corpus, which every page loads, does not carry them.
    if (COMPLETION_KINDS.includes(parsed.kind)) continue;
    // Census rows are only ever published as counts (spec 2026-10-18-census-design.md §5.2), like addon lists.
    // Stored ones carry a character key in place of the GUID and fail the wire schema anyway; this is explicit.
    if (CENSUS_KINDS.includes(parsed.kind)) continue;
    // Pull summaries name the group and live in their own tables, where a hidden character can be deleted
    // (web/src/lib/pull-store.ts). Intake never puts them in an upload; one that got there is not folded in.
    if (PULL_KINDS.includes(parsed.kind)) continue;
    const row = { ...parsed };
    // Old SavedVariables may contain a placeholder or secret. Neither is a public fact.
    if ("claimToken" in row) delete row.claimToken;
    if (!row.eventId) { legacyRecords++; continue; }
    const key = eventKey(row);
    if (conflicts.has(key)) continue;
    const old = events.get(key);
    const grants = [...new Set([...(old?.grants ?? []), ...grantIds])].sort();
    if (!old || canonicalJson(old.record) === canonicalJson(row) || addsFieldsOnly(row, old.record)) {
      // New, the same, or the same event with fields an older uploader dropped: keep the fuller copy.
      events.set(key, { record: row, grants });
    } else if (addsFieldsOnly(old.record, row)) {
      // An older uploader's copy arriving after the fuller one: keep the fuller one.
      events.set(key, { record: old.record, grants });
    } else {
      events.delete(key);
      conflicts.add(key);
    }
  }
  return {
    version: 1, events: [...events].sort(([a], [b]) => a.localeCompare(b)).map(([, e]) => e),
    conflicts: [...conflicts].sort(), legacyRecords,
  };
}

/**
 * The same result as one mergeCorpus call per batch, in order. Each call rebuilds and re-sorts every
 * prior event, so replaying a snapshot event by event was quadratic. Consecutive batches with the same
 * grant set fold identically in a single call, and anonymous uploads all share the empty set.
 */
export function mergeCorpusBatches(
  previous: CorpusState | undefined,
  batches: readonly { raw: readonly unknown[]; grants: readonly string[] }[],
): CorpusState {
  let state = previous;
  let raw: unknown[] = [];
  let grants: string[] = [];
  let key: string | null = null;
  for (const batch of batches) {
    const set = [...new Set(batch.grants)].sort();
    const next = set.join(",");
    if (key !== null && next !== key) {
      state = mergeCorpus(state, raw, grants);
      raw = [];
    }
    key = next;
    grants = set;
    for (const row of batch.raw) raw.push(row);
  }
  return key === null ? state ?? mergeCorpus(undefined, []) : mergeCorpus(state, raw, grants);
}

/**
 * Named publication is evaluated against CURRENT authority, never a cached assertion. Polestar Recorder install ids
 * are folded into one voter per player (recorder-installs.ts) here, so every reader counts them the same way.
 */
export function publicRecords(state: CorpusState,
  authorize?: (row: IntakeRecord, grants: string[]) => IntakeRecord | null,
): IntakeRecord[] {
  return foldRecorderInstalls(state.events.flatMap(({ record, grants }) => {
    if (!namedRecord(record)) return [record];
    const allowed = authorize?.(record, grants);
    return allowed ? [allowed] : [];
  }));
}
