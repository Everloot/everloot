import { DAY_MS, directionOf, LEDGER_INCOME, LEDGER_SPENDING, periodStart, utcDay } from "../shared/ledger";
import type { ReportInfo, ReportQuery, ReportRow } from "../shared/reports";
import type { LocalTables } from "./characters";

interface Bucket { at: number; day: number; key: string; category: string; item: string; ownAlt: boolean; sale: boolean; total: number; units: number | null }
export interface LedgerIndex { present: boolean; characters: { key: string; name: string }[]; buckets: Bucket[] }
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const CATEGORIES = new Set<string>([...LEDGER_INCOME, ...LEDGER_SPENDING]);
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** Index by timestamp/character/category/item once per file write, inside the existing save reader. */
export function indexLedger(local: LocalTables): LedgerIndex {
  const ledger = obj(local.ledger), roster = obj(local.roster);
  const characters = Object.entries(roster).flatMap(([key, v]) => {
    const r = obj(v);
    return typeof r.name === "string" && typeof r.realm === "string" && r.name && r.realm ? [{ key, name: `${r.name} — ${r.realm}` }] : [];
  });
  const keys = new Set(characters.map(c => c.key));
  const groups = new Map<string, Bucket>();
  for (const sale of [false, true]) for (const raw of (Array.isArray(ledger[sale ? "sales" : "events"]) ? ledger[sale ? "sales" : "events"] : []) as unknown[]) {
    const r = obj(raw), total = sale ? r.total : r.copper;
    if (typeof r.key !== "string" || !keys.has(r.key) || !positive(total) || typeof r.at !== "number" || !Number.isSafeInteger(r.at) || r.at < 0 || r.at > 8640000000000) continue;
    if (sale ? r.status !== "paid" || !positive(r.count) : typeof r.category !== "string" || !CATEGORIES.has(r.category)) continue;
    const b: Bucket = { at: r.at * 1000, day: utcDay(r.at * 1000), key: r.key, category: sale ? "auction" : r.category as string, item: typeof r.itemName === "string" ? r.itemName : "", ownAlt: r.ownAlt === true, sale, total, units: positive(r.count) ? r.count : null };
    const id = JSON.stringify([b.at, b.key, b.category, b.item, b.ownAlt, sale]);
    const old = groups.get(id);
    if (old) { old.total += total; old.units = old.units === null || b.units === null ? null : old.units + b.units; } else groups.set(id, b);
  }
  return { present: Array.isArray(ledger.events), characters, buckets: [...groups.values()] };
}

/** Only aggregated local results cross IPC. Account ids are folder names, never filesystem paths. */
export function reportAt(files: { account: string; index: LedgerIndex }[], raw: ReportQuery = {}, now = Date.now()): ReportInfo {
  const q = obj(raw) as ReportQuery;
  const period = [7, 14, 30, 90, "all"].includes(q.period!) ? q.period! : 30;
  const metric = ["profit", "sales", "purchases", "expenses"].includes(q.metric!) ? q.metric! : "profit";
  const accounts = files.map(f => ({ id: f.account, characters: f.index.characters }));
  const selected = files.filter(f => !q.account || f.account === q.account);
  const count = selected.reduce((n, f) => n + f.index.characters.filter(c => !q.character || (q.account && c.key === q.character)).length, 0);
  const buckets = selected.flatMap(f => f.index.buckets).filter(b => (!q.character || (q.account && b.key === q.character)) && b.at <= now);
  // The addon's retained window is at most 90 UTC days, even if an old file still holds older rows.
  const floor = periodStart(now, 90);
  const oldest = Math.max(floor, buckets.reduce((min, b) => Math.min(min, b.day), utcDay(now)));
  const start = period === "all" ? oldest : periodStart(now, period);
  const length = Math.round((utcDay(now) - start) / DAY_MS) + 1;
  const previousStart = start - length * DAY_MS;
  const days = Array.from({ length }, (_, i) => ({ date: new Date(start + i * DAY_MS).toISOString().slice(0, 10), total: 0 }));
  const groups = new Map<string, ReportRow>();
  const categories = new Map<string, number>();
  const items = new Set<string>();
  let total = 0;
  for (const b of buckets) {
    if (b.day < floor || (count > 1 && b.ownAlt)) continue;
    if (metric === "sales" ? !b.sale : b.sale) continue;
    if (metric === "purchases" && !["auction_spend", "vendor_spend"].includes(b.category)) continue;
    if (metric === "expenses" && directionOf(b.category) !== "out") continue;
    if (b.item) items.add(b.item);
    if ((q.item && b.item !== q.item) || b.day < previousStart) continue;
    const value = b.total * (metric === "profit" && directionOf(b.category) === "out" ? -1 : 1);
    let row = groups.get(b.item);
    if (!row) { row = { item: b.item, units: 0, total: 0, average: null, previous: 0, change: null }; groups.set(b.item, row); }
    if (b.day < start) { row.previous += value; continue; }
    row.total += value;
    row.units = row.units === null || b.units === null ? null : row.units + b.units;
    total += value;
    days[Math.round((b.day - start) / DAY_MS)].total += value;
    categories.set(b.category, (categories.get(b.category) ?? 0) + value);
  }
  let running = 0;
  if (q.cumulative === true) for (const d of days) { running += d.total; d.total = running; }
  for (const r of groups.values()) {
    r.average = r.units ? Math.floor(r.total / r.units) : null;
    r.change = r.previous ? (r.total - r.previous) / Math.abs(r.previous) * 100 : null;
  }
  return { hasLedger: selected.some(f => f.index.present), unreadable: 0, accounts, items: [...items].sort(), from: days[0].date, to: days[days.length - 1].date, previousComplete: selected.length > 0 && Math.max(floor, buckets.reduce((min, b) => Math.min(min, b.day), Infinity)) <= previousStart, total, days, rows: [...groups.values()].sort((a, b) => b.total - a.total || a.item.localeCompare(b.item)), categories: [...categories].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total) };
}
