/**
 * The NPC loot table and the item-source table (docs/design/specs/2026-10-21-loot-tables-design.md, section 9).
 * One reading of the addon's loot windows, the ones the loot API attributed (`sourceEvidence: "loot-api"`), with
 * every number's denominator and dates beside it. A rate is windows holding the item over the source's windows,
 * shown once 3 installs looted the source: the public rows are `rollupDrops`' public rates. Below that, a page says
 * how many windows from how many installs it has, and no item is tied to a source. Recorder windows never enter
 * here; `pending-loot.ts` counts them apart.
 */
import { countsAsKillOrGather, INDEPENDENT_INSTALLS } from "./drop-rollup.js";

/** A source's windows: how many, from how many installs, and the first and last capture day (UTC). */
export interface WindowSpan { windows: number; installs: number; first: string | null; last: string | null }

/** One item from one source: `withItem` windows held it, out of the source's `windows`. */
export interface LootTableRow {
  sourceNpcId?: number;
  sourceObjectId?: number;
  itemId: number;
  withItem: number;
  windows: number;
  rate: number;
  installs: number;
  first: string | null;
  last: string | null;
}

interface SourceTally { windows: number; installs: Set<string>; first: string | null; last: string | null; items: Map<number, { windows: number; installs: Set<string> }> }

export interface LootTables {
  /** `npc:<id>` or `obj:<id>`. */
  sources: Map<string, SourceTally>;
  /** Loot-API windows left out: no reporter or no source. */
  leftOut: number;
}

export interface NpcLootTable {
  npcId: number;
  /** none: no windows; short: windows from fewer than 3 installs; rated: 3 or more, rows public. */
  state: "none" | "short" | "rated";
  span: WindowSpan;
  rows: LootTableRow[];
  /** Installs still needed before a rate shows. */
  missingInstalls: number;
}

export interface ItemDropSources {
  rows: LootTableRow[];
  /** Windows holding the item on sources fewer than 3 installs looted, never broken down by source. */
  short: { windows: number; installs: number } | null;
}

const positive = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** The UTC day of a capture time, or null for a time that is not one or is later than the corpus time. */
function captureDay(at: unknown, asOf: number): string | null {
  if (typeof at !== "string") return null;
  const t = Date.parse(at);
  if (!Number.isFinite(t) || t > asOf) return null;
  return new Date(t).toISOString().slice(0, 10);
}

export function lootTablesFromRecords(records: readonly unknown[], asOf: Date | string | null = null): LootTables {
  const until = asOf === null ? Infinity : new Date(asOf).getTime();
  const sources = new Map<string, SourceTally>();
  let leftOut = 0;
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.kind !== "loot" || row.sourceEvidence !== "loot-api" || !Array.isArray(row.items)) continue;
    if (!countsAsKillOrGather(row.lootType)) continue;
    const installId = typeof row.installId === "string" ? row.installId.trim() : "";
    const key = positive(row.sourceNpcId) ? `npc:${row.sourceNpcId}` : positive(row.sourceObjectId) ? `obj:${row.sourceObjectId}` : null;
    if (!installId || !key) {
      leftOut += 1;
      continue;
    }
    const source = sources.get(key) ?? { windows: 0, installs: new Set<string>(), first: null, last: null, items: new Map() };
    source.windows += 1;
    source.installs.add(installId);
    const day = captureDay(row.capturedAt, until);
    if (day && (source.first === null || day < source.first)) source.first = day;
    if (day && (source.last === null || day > source.last)) source.last = day;
    const counted = new Set<number>();
    for (const entry of row.items as { itemId?: unknown; count?: unknown }[]) {
      if (!positive(entry?.itemId) || !positive(entry?.count) || counted.has(entry.itemId)) continue;
      counted.add(entry.itemId);
      const item = source.items.get(entry.itemId) ?? { windows: 0, installs: new Set<string>() };
      item.windows += 1;
      item.installs.add(installId);
      source.items.set(entry.itemId, item);
    }
    sources.set(key, source);
  }
  return { sources, leftOut };
}

const spanOf = (source: SourceTally | undefined): WindowSpan =>
  source ? { windows: source.windows, installs: source.installs.size, first: source.first, last: source.last } : { windows: 0, installs: 0, first: null, last: null };

function rowOf(key: string, source: SourceTally, itemId: number, withItem: number): LootTableRow {
  const id = Number(key.slice(4));
  return {
    ...(key.startsWith("npc:") ? { sourceNpcId: id } : { sourceObjectId: id }),
    itemId,
    withItem,
    windows: source.windows,
    rate: withItem / source.windows,
    installs: source.installs.size,
    first: source.first,
    last: source.last,
  };
}

/** Every item from one NPC, once 3 installs looted it; before that, only its windows and installs. */
export function npcLootTable(tables: LootTables, npcId: number): NpcLootTable {
  const source = tables.sources.get(`npc:${npcId}`);
  const span = spanOf(source);
  const missingInstalls = Math.max(0, INDEPENDENT_INSTALLS - span.installs);
  if (!source) return { npcId, state: "none", span, rows: [], missingInstalls };
  if (missingInstalls > 0) return { npcId, state: "short", span, rows: [], missingInstalls };
  const rows = [...source.items].map(([itemId, item]) => rowOf(`npc:${npcId}`, source, itemId, item.windows));
  rows.sort((a, b) => b.rate - a.rate || a.itemId - b.itemId);
  return { npcId, state: "rated", span, rows, missingInstalls };
}

/** Every source 3 installs looted whose windows held the item, and one count for the sources short of that. */
export function itemDropSources(tables: LootTables, itemId: number): ItemDropSources {
  const rows: LootTableRow[] = [];
  let shortWindows = 0;
  const shortInstalls = new Set<string>();
  for (const [key, source] of tables.sources) {
    const item = source.items.get(itemId);
    if (!item) continue;
    if (source.installs.size >= INDEPENDENT_INSTALLS) {
      rows.push(rowOf(key, source, itemId, item.windows));
    } else {
      shortWindows += item.windows;
      for (const id of item.installs) shortInstalls.add(id);
    }
  }
  rows.sort((a, b) => b.windows - a.windows || b.rate - a.rate || (a.sourceNpcId ?? a.sourceObjectId ?? 0) - (b.sourceNpcId ?? b.sourceObjectId ?? 0));
  return { rows, short: shortWindows > 0 ? { windows: shortWindows, installs: shortInstalls.size } : null };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "dated 2026-10-10 to 2026-10-14", one day once, nothing without dates. */
export function datedPhrase(span: Pick<WindowSpan, "first" | "last">): string {
  if (!span.first || !span.last) return "";
  return span.first === span.last ? `dated ${span.first}` : `dated ${span.first} to ${span.last}`;
}

/** "N loot windows from M installs, dated …": the denominator and its dates. */
export function spanPhrase(span: WindowSpan): string {
  const dated = datedPhrase(span);
  return `${plural(span.windows, "loot window", "loot windows")} from ${plural(span.installs, "install", "installs")}${dated ? `, ${dated}` : ""}`;
}

/** What an NPC without a rate has, and what it still needs. */
export function missingLine(table: Pick<NpcLootTable, "span" | "missingInstalls">): string {
  return `${spanPhrase(table.span)}. A rate needs windows from ${INDEPENDENT_INSTALLS} installs: ${table.missingInstalls} more.`;
}

/** The item page's one sentence for windows on sources short of 3 installs. */
export function shortLine(short: { windows: number; installs: number }): string {
  return `${plural(short.windows, "loot window", "loot windows")} with this item from ${plural(short.installs, "install", "installs")}, on sources fewer than ${INDEPENDENT_INSTALLS} installs have looted. A rate needs windows from ${INDEPENDENT_INSTALLS} installs on the same source.`;
}

/** How the rates under a table were made. */
export const METHOD_LINE = "Observed frequency is the loot windows holding the item out of the loot windows opened on the source, from windows the game's loot API attributed, recorded by the Everloot addon. A window is a loot, not a kill.";
