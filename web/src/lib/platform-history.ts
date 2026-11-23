import type { MarketState } from "@kb/market";
import type { CoverageSummary } from "./coverage-summary";
import { r2Client, r2Config, type Corpus, type R2Config } from "./upload-store";

/**
 * Everloot's own numbers over time (#1354): one row per UTC day, in one small file, so growth can be charted and
 * queried without replaying anything. Only counts are kept: no install, character, guild or realm is named, so
 * nothing in it outlives an opt-out. The market's prices already have their own history (the auction reports, frozen
 * per day); this is the platform's.
 *
 * The stored-views job freezes each completed day on its first run after midnight UTC, from the snapshot it just built
 * (the row's `dataAsOf` says how current that was). When the file does not exist yet, it is started with every
 * earlier day the corpus can show, from the records' capture times: those rows say `source: "backfill"`, count the
 * records captured by the end of that day (uploads that arrived later included), and carry no market or coverage.
 */
export const HISTORY_KEY = "history/daily.json";

export interface DayRow {
  date: string;
  source: "snapshot" | "backfill";
  /** The snapshot the row was counted from; null for a backfilled day. */
  dataAsOf: string | null;
  /** Uploads folded into the corpus; null for a backfilled day (capture times say nothing about arrival). */
  uploads: number | null;
  records: number;
  /** Distinct installs behind the records, counted, never named. */
  contributors: number;
  kinds: Record<string, number>;
  market: { realms: number; houses: number; items: number } | null;
  coverage: { installs: number; confirmed: number; waiting: number } | null;
}

interface HistoryFile { version: 1; days: DayRow[] }
type Deps = { cloud?: R2Config | null; fetch?: typeof fetch };

const dayOf = (iso: string) => new Date(Date.parse(iso)).toISOString().slice(0, 10);
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
/** The UTC day before `now`'s: the last completed one. */
export const completedDay = (now: Date) => new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

type Counted = Pick<DayRow, "records" | "contributors" | "kinds">;
function counter() {
  const kinds: Record<string, number> = {};
  const installs = new Set<string>();
  let records = 0;
  return {
    add(record: { kind?: unknown; installId?: unknown }) {
      records++;
      const kind = typeof record.kind === "string" ? record.kind : "unknown";
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      if (typeof record.installId === "string" && record.installId) installs.add(record.installId);
    },
    snapshot(): Counted {
      return { records, contributors: installs.size, kinds: Object.fromEntries(Object.entries(kinds).sort(([a], [b]) => a.localeCompare(b))) };
    },
  };
}

export function marketCounts(state: MarketState | null): DayRow["market"] {
  if (!state) return null;
  const items = new Set<string>();
  for (const realm of Object.values(state.realms ?? {})) for (const id of Object.keys(realm.items ?? {})) items.add(id);
  for (const house of Object.values(state.houses ?? {})) for (const id of Object.keys(house.items ?? {})) items.add(id);
  return { realms: Object.keys(state.realms ?? {}).length, houses: Object.keys(state.houses ?? {}).length, items: items.size };
}

/** Today's row from the snapshot just built. */
export function snapshotRow(date: string, corpus: Corpus, market: MarketState | null, coverage: CoverageSummary | null): DayRow {
  const count = counter();
  for (const record of corpus.records) count.add(record as { kind?: unknown; installId?: unknown });
  return {
    date, source: "snapshot", dataAsOf: corpus.dataAsOf ?? null, uploads: corpus.uploads, ...count.snapshot(),
    market: marketCounts(market),
    coverage: coverage ? { installs: coverage.installs, confirmed: coverage.confirmed, waiting: coverage.waiting } : null,
  };
}

/** A row for every day from the first capture to `through`, each counting the records captured by its end. */
export function backfillRows(corpus: Corpus, through: string): DayRow[] {
  const dated = corpus.records
    .map((record) => ({ record, at: Date.parse(String((record as { capturedAt?: unknown }).capturedAt ?? "")) }))
    .filter((r) => Number.isFinite(r.at))
    .sort((a, b) => a.at - b.at);
  if (!dated.length) return [];
  const rows: DayRow[] = [];
  const count = counter();
  let i = 0;
  for (let date = dayOf(new Date(dated[0].at).toISOString()); date <= through; date = nextDay(date)) {
    const end = Date.parse(`${nextDay(date)}T00:00:00Z`);
    while (i < dated.length && dated[i].at < end) count.add(dated[i++].record as { kind?: unknown; installId?: unknown });
    rows.push({ date, source: "backfill", dataAsOf: null, uploads: null, ...count.snapshot(), market: null, coverage: null });
  }
  return rows;
}

function storage(deps: Deps) {
  const cloud = deps.cloud === undefined ? r2Config() : deps.cloud;
  if (!cloud) return null;
  const url = `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${HISTORY_KEY}`;
  const send = async (init: RequestInit) => (deps.fetch ?? fetch)(await r2Client(cloud).sign(url, init), { signal: AbortSignal.timeout(20_000) });
  return { send };
}

function parse(raw: unknown): HistoryFile | null {
  const file = raw as Partial<HistoryFile> | null;
  return file?.version === 1 && Array.isArray(file.days) && file.days.every((d) => typeof d?.date === "string") ? file as HistoryFile : null;
}

/** The days stored so far, oldest first: empty before the first one, null when storage cannot be read (unknown, not none). */
export async function readDailyHistory(deps: Deps = {}): Promise<DayRow[] | null> {
  const s = storage(deps);
  if (!s) return null;
  try {
    const res = await s.send({ method: "GET" });
    if (res.status === 404) return [];
    if (!res.ok) return null;
    return parse(await res.json())?.days ?? null;
  } catch {
    return null;
  }
}

/**
 * Freezes the last completed day if the file does not have it yet (and starts the file with the backfill). Reads the
 * corpus, the market and the coverage only when there is a day to write. The write is conditional on the file read,
 * so two runs cannot both append; a refused write throws, and the next run reads the file again.
 */
export async function writeDailyHistory(now: Date, deps: Deps & {
  corpus: () => Promise<Corpus>; market: () => Promise<MarketState | null>; coverage: () => Promise<CoverageSummary | null>;
}): Promise<{ written: boolean; date: string; days?: number }> {
  const s = storage(deps);
  if (!s) throw new Error("the platform history needs the cloud store");
  const date = completedDay(now);
  // Uncompressed, so R2 answers with the object's strong ETag: a compressed answer carries a weak one, which no
  // If-Match accepts. Without this every write after the first failed with 412 (2026-11-23, no 11/22 row).
  const res = await s.send({ method: "GET", headers: { "accept-encoding": "identity" } });
  let file: HistoryFile | null = null;
  if (res.status !== 404) {
    if (!res.ok) throw new Error(`history read failed (${res.status})`);
    file = parse(await res.json());
    if (!file) throw new Error("history file is not readable: left as it is");
    if (file.days.some((d) => d.date === date)) return { written: false, date };
  }
  const etag = res.headers.get("etag");
  if (file && (!etag || etag.startsWith("W/"))) throw new Error(`history file has no strong ETag (${etag ?? "none"}): cannot append safely`);
  const corpus = await deps.corpus();
  if (corpus.unreachable) throw new Error("corpus unreachable");
  const row = snapshotRow(date, corpus, await deps.market(), await deps.coverage());
  // A new file starts with every day before this one that the capture times can show.
  const earlier = file ? file.days : backfillRows(corpus, dayBefore(date));
  const days = [...earlier.filter((d) => d.date !== date), row].sort((a, b) => a.date.localeCompare(b.date));
  const put = await s.send({
    method: "PUT", body: JSON.stringify({ version: 1, days } satisfies HistoryFile),
    headers: { "content-type": "application/json", ...(file ? { "if-match": etag! } : { "if-none-match": "*" }) },
  });
  // The job's runs never overlap (one concurrency group), so a 412 means the file changed under this run: say so,
  // so the run names `history` and the health check shows it, and the next run reads the file again.
  if (put.status === 412) throw new Error("history write refused (412): the file changed since it was read; the next run retries the day");
  if (!put.ok) throw new Error(`history write failed (${put.status})`);
  return { written: true, date, days: days.length };
}
