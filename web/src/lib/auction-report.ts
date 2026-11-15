import { itemListings, type MarketState } from "../../../kb/src/market";
import { realmBoards } from "./auction-house";
import { realmRegion } from "./realms";

export const REPORT_PATH = "/tools/auctions/report";
export const reportHref = (date: string) => `${REPORT_PATH}/${date}`;
export type ReportItem = { name: string; category?: string };
export type ReportGood = { itemId: number; name: string; realm: string; house: string; region: string; ruleset: string; copper: number; change: number | null; listings: number | null; thin: boolean };
export type ReportSpread = { itemId: number; name: string; region: string; ruleset: string; cheapest: number; dearest: number; cheapHouse: string; dearHouse: string };
export interface AuctionReport {
 icon?: string | null; date: string; headline: string; houses: string[]; goods: number; scannedThrough: string | null; includesOwnScans: boolean;
 risers: ReportGood[]; fallers: ReportGood[]; mostListed: ReportGood[];
 categories: { name: string; up: number; down: number; total: number }[]; spreads: ReportSpread[];
}
const previousDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
/** Public daily market asking prices, not the rolling 14-day value. A comparison is always the same house,
 * region and item on consecutive UTC days. Thin days never drive a movement or spread. No scans are replayed. */
export function buildAuctionReports(state: MarketState, now: Date, items: ReadonlyMap<number, ReportItem> = new Map()): AuctionReport[] {
 const byDay = new Map<string, { rows: ReportGood[]; time: number; own: boolean }>();
 const today = now.toISOString().slice(0, 10);
 for (const board of realmBoards(state, now)) for (const row of board.rows) {
  const listings = itemListings(state, board.realm.key, row.value.itemId, now, row.house);
  for (const p of row.points) {
   if (p.day >= today) continue;
   const bucket = byDay.get(p.day) ?? { rows: [], time: 0, own: false };
   const before = row.points.find(b => b.day === previousDay(p.day));
   const meta = items.get(row.value.itemId);
   bucket.rows.push({ itemId: row.value.itemId, name: meta?.name ?? `Item ${row.value.itemId}`, realm: board.realm.name, house: row.house,
    region: realmRegion(board.realm.name) ?? "Region not confirmed yet", ruleset: board.realm.ruleset === "forever" ? "Ruleset not confirmed yet" : board.realm.ruleset,
    copper: p.market, change: !p.thin && before && !before.thin && before.market > 0 ? p.market / before.market - 1 : null,
    listings: listings[p.day] ?? null, thin: p.thin });
   bucket.own ||= p.reporters < 3;
   const scans = state.houses?.[`${board.realm.key}|${row.house.toLowerCase()}`]?.items[String(row.value.itemId)]?.open[p.day];
   for (const scan of Object.values(scans ?? {})) bucket.time = Math.max(bucket.time, scan[4]);
   byDay.set(p.day, bucket);
  }
 }
 return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, { rows, time, own }]) => {
  const moving = rows.filter(r => r.change !== null);
  const categories = new Map<string, { name: string; up: number; down: number; total: number }>();
  for (const r of moving) {
   const name = items.get(r.itemId)?.category; if (!name) continue;
   const cat = categories.get(name) ?? { name, up: 0, down: 0, total: 0 };
   cat.total++; if (r.change! > 0) cat.up++; if (r.change! < 0) cat.down++; categories.set(name, cat);
  }
  const spreadGroups = new Map<string, ReportGood[]>();
  for (const r of rows.filter(r => !r.thin && !r.region.includes("confirmed") && !r.ruleset.includes("confirmed"))) {
   const key = `${r.region}|${r.ruleset}|${r.itemId}`; const group = spreadGroups.get(key) ?? []; group.push(r); spreadGroups.set(key, group);
  }
  const spreads = [...spreadGroups.values()].flatMap(group => {
   group.sort((a,b) => a.copper-b.copper); const a = group[0]!, b = group.at(-1)!;
   return group.length < 2 || a.copper <= 0 || a.copper === b.copper ? [] : [{ itemId: a.itemId, name: a.name, region: a.region, ruleset: a.ruleset, cheapest: a.copper, dearest: b.copper, cheapHouse: `${a.realm} · ${a.house}`, dearHouse: `${b.realm} · ${b.house}` }];
  }).sort((a,b) => b.dearest / b.cheapest - a.dearest / a.cheapest).slice(0, 5);
  // Keep each ruleset represented rather than letting one busy market fill the whole report.
  const top = (up: boolean) => [...new Set(rows.map(r => r.ruleset))].flatMap(ruleset => moving.filter(r => r.ruleset === ruleset && (up ? r.change! > 0 : r.change! < 0)).sort((a,b) => up ? b.change!-a.change! : a.change!-b.change!).slice(0, 5));
  const cats = [...categories.values()].sort((a,b) => b.total-a.total);
  const lead = cats.find(c => c.down > c.up || c.up > c.down);
  const goods = new Set(rows.map(r => r.itemId)).size;
  return { date, goods, scannedThrough: time ? new Date(time).toISOString() : null, includesOwnScans: own,
   houses: [...new Set(rows.map(r => `${r.region} · ${r.realm} · ${r.house} · ${r.ruleset}`))].sort(),
   headline: lead ? `${lead.name}: ${Math.max(lead.up,lead.down)} of ${lead.total} comparable item-house prices ${lead.down > lead.up ? "fell" : "rose"} from the day before.` : `${goods} ${goods === 1 ? "good" : "goods"} with public asking prices across ${new Set(rows.map(r => `${r.realm}|${r.house}`)).size} scanned houses.`,
   risers: top(true), fallers: top(false), mostListed: rows.filter(r => r.listings !== null).sort((a,b) => b.listings!-a.listings!).slice(0, 10), categories: cats, spreads };
 });
}
