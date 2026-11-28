import { parseEverlootTable } from "./sv-parse";

const DAY = 86400;
const NOTICE_DAYS = 28;
export const SALE_CYCLES = [
  ["day", "Last 24 hours"],
  ["week", "Since weekly reset"],
  ["month", "This month"],
] as const;
export type SaleCycle = typeof SALE_CYCLES[number][0];

interface Sale {
  itemName: string;
  at: number;
  status: "paid" | "pending" | "unmatched";
  total: number | null;
  noticeAt: number | null;
}
interface Reset { start: number; next: number }
export interface SaleLedger { sales: Sale[]; reset: Reset | null }
interface Seller { itemName: string; sales: number; total: number }
interface SaleHour { hour: number; notices: number; days: number }

const table = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Read only sale facts from the local file. It stays in browser memory and the rest of the ledger is discarded. */
export function readSaleLedger(text: string): SaleLedger {
  const check = { extra: null };
  const ledger = table(parseEverlootTable(text, check).ledger);
  if (check.extra) throw new Error(check.extra);
  const { start, next } = table(ledger.auctionReset);
  const reset = whole(start) && whole(next) && next > start && next - start <= 8 * DAY ? { start, next } : null;
  const rows: unknown[] = Array.isArray(ledger.sales) ? ledger.sales : [];
  const sales = rows.flatMap((raw): Sale[] => {
    const { itemName, at, status, total, noticeAt } = table(raw);
    if (typeof itemName !== "string" || !itemName || itemName.length > 80 || !whole(at)) return [];
    if (status !== "paid" && status !== "pending" && status !== "unmatched") return [];
    return [{ itemName, at, status, total: whole(total) && total > 0 ? total : null, noticeAt: whole(noticeAt) ? noticeAt : null }];
  });
  return { sales, reset };
}

/** The same windows, confirmed-receipt ordering and UTC notice threshold as addon/modules/ledger.lua. */
export function saleCycles(ledger: SaleLedger, now: number, itemName?: string) {
  const midnight = Math.floor(now / DAY) * DAY;
  const month = midnight - (new Date(now * 1000).getUTCDate() - 1) * DAY;
  const reset = ledger.reset;
  const start = {
    day: now - DAY,
    week: reset && reset.start <= now && now < reset.next ? reset.start : null,
    month,
  };
  const groups = { day: new Map<string, Seller>(), week: new Map<string, Seller>(), month: new Map<string, Seller>() };
  const buckets = Array.from({ length: 24 }, () => ({ notices: 0, days: new Set<number>() }));
  for (const row of ledger.sales) {
    if (row.at > now || (itemName !== undefined && row.itemName !== itemName)) continue;
    const notice = row.status === "paid" ? row.noticeAt : row.at;
    if (notice !== null && notice >= now - NOTICE_DAYS * DAY && notice <= row.at) {
      const bucket = buckets[Math.floor(notice / 3600) % 24];
      bucket.notices += 1;
      bucket.days.add(Math.floor(notice / DAY));
    }
    if (row.status !== "paid" || row.total === null) continue;
    for (const [cycle] of SALE_CYCLES) {
      const since = start[cycle];
      if (since === null || row.at < since) continue;
      const group = groups[cycle].get(row.itemName) ?? { itemName: row.itemName, sales: 0, total: 0 };
      group.sales += 1;
      group.total += row.total;
      groups[cycle].set(row.itemName, group);
    }
  }
  const sorted = (cycle: SaleCycle) => [...groups[cycle].values()].sort((a, b) =>
    b.sales - a.sales || b.total - a.total || (a.itemName < b.itemName ? -1 : a.itemName > b.itemName ? 1 : 0));
  const hours: SaleHour[] = buckets.map((row, hour) => ({ hour, notices: row.notices, days: row.days.size }));
  const peak = hours.filter(row => row.notices >= 3 && row.days >= 2)
    .sort((a, b) => b.notices - a.notices || b.days - a.days || a.hour - b.hour)[0] ?? null;
  return { start, rank: { day: sorted("day"), week: sorted("week"), month: sorted("month") }, hours, peak };
}
