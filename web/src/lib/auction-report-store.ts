import { cache } from "react";
import { AwsClient } from "aws4fetch";
import type { AuctionReport, ReportItem } from "./auction-report";
import { storedViewNeedsWrite, STAMP } from "./stored-view-freshness";
import type { R2Config } from "./upload-store";

const ROOT = "snapshots/auction-reports";
const INDEX = `${ROOT}/index.json`;
const config = (): R2Config | null => {
 const c = { r2AccountId: process.env.R2_ACCOUNT_ID, r2AccessKeyId: process.env.R2_ACCESS_KEY_ID, r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY, r2Bucket: process.env.R2_BUCKET };
 return Object.values(c).every(Boolean) ? c as R2Config : null;
};
type Deps = { cloud?: R2Config | null; fetch?: typeof fetch };
function storage(deps: Deps) {
 const c = deps.cloud === undefined ? config() : deps.cloud;
 if (!c) return null;
 const client = new AwsClient({ accessKeyId: c.r2AccessKeyId, secretAccessKey: c.r2SecretAccessKey, service: "s3", region: "auto" });
 const url = (key: string) => `https://${c.r2AccountId}.r2.cloudflarestorage.com/${c.r2Bucket}/${key}`;
 const request = async (key: string, init?: RequestInit) => (deps.fetch ?? fetch)(await client.sign(url(key), init), { cache: "no-store" });
 return { client, url, request };
}
export const isReportDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0,10) === s;
async function readReportDates(deps: Deps = {}): Promise<string[]> {
 const s = storage(deps); if (!s) return [];
 try {
  const res = await s.request(INDEX); if (!res.ok) return [];
  const file = await res.json() as { version?: number; dates?: unknown };
  return file.version === 1 && Array.isArray(file.dates) && file.dates.every(d => typeof d === "string" && isReportDate(d)) ? file.dates.sort().reverse() : [];
 } catch { return []; }
}
/** No corpus or market fallback: missing snapshots stay unavailable until the next successful cron. */
async function readAuctionReport(date: string, deps: Deps = {}): Promise<AuctionReport | null> {
 if (!isReportDate(date)) return null;
 const s = storage(deps); if (!s) return null;
 try {
  const res = await s.request(`${ROOT}/${date}.json`); if (!res.ok) return null;
  const report = await res.json() as AuctionReport;
  return report.date === date && Array.isArray(report.houses) && report.goods > 0 ? report : null;
 } catch { return null; }
}
export const reportDates = cache(readReportDates);
export const storedAuctionReport = cache(readAuctionReport);

/** Freeze each completed UTC day on first publication. The day stamp advances even on an idle midnight cron;
 * a failed PUT cannot advance the index. Historical files are retained after the market's rolling window expires. */
export async function writeAuctionReports(now = new Date(), deps: Deps & { build?: () => Promise<AuctionReport[]> } = {}): Promise<{ written: boolean; reports?: number }> {
 const s = storage(deps); if (!s) throw new Error("auction reports need the cloud store");
 const stamp = now.toISOString().slice(0,10);
 if (!await storedViewNeedsWrite(s.client, s.url(INDEX), stamp, deps.fetch ?? fetch)) return { written: false };
 const response = await s.request(INDEX);
 let dates: string[] = [];
 if (response.status !== 404) {
  if (!response.ok) throw new Error("auction report index unreadable");
  const old = await response.json() as { version: number; dates: string[] };
  if (old.version !== 1 || !Array.isArray(old.dates) || !old.dates.every(isReportDate)) throw new Error("auction report index invalid");
  dates = old.dates;
 }
 const reports = await (deps.build ?? (async () => {
  const [{ uploadStore }, { CLIENT_TAXONOMY }, { loadShownNames }, { loadSiteAssets, loadItemTips }, { buildAuctionReports }] = await Promise.all([
   import("./upload-store"), import("../../../kb/src/client-layer-file"), import("./shown-item-names"), import("./game-assets"), import("./auction-report"),
  ]);
  const market = await uploadStore.loadMarket(); if (!market.state) throw new Error("market unavailable");
  const names = await loadShownNames();
  const items = new Map<number, ReportItem>();
  const subclasses = new Map(CLIENT_TAXONOMY.subclasses.map(c => [`${c.classId}:${c.id}`, c.name]));
  for (const [id, cls, sub] of CLIENT_TAXONOMY.items) {
   const name = names.agreed.get(id) ?? names.matched?.names.get(id)?.name;
   items.set(id, { name: name ?? `Item ${id}`, category: cls === 7 ? subclasses.get(`${cls}:${sub}`) ?? undefined : undefined });
  }
  const reports = buildAuctionReports(market.state, now, items);
  const featured = reports.map(r => r.risers.slice().sort((a,b) => b.change!-a.change!)[0]?.itemId ?? r.mostListed[0]?.itemId).filter((id): id is number => id !== undefined);
  const assets = featured.length ? await loadSiteAssets() : null;
  const tips = await loadItemTips(assets, [...new Set(featured)]);
  for (const report of reports) {
   const id = report.risers.slice().sort((a,b) => b.change!-a.change!)[0]?.itemId ?? report.mostListed[0]?.itemId;
   report.icon = id ? tips.get(id)?.icon ?? null : null;
  }
  return reports;
 }))();
 let count = 0;
 for (const report of reports) {
  if (dates.includes(report.date)) continue;
  const put = await s.request(`${ROOT}/${report.date}.json`, { method: "PUT", body: JSON.stringify(report), headers: { "content-type": "application/json" } });
  if (!put.ok) throw new Error(`auction report write failed (${put.status})`);
  dates.push(report.date); count++;
 }
 const put = await s.request(INDEX, { method: "PUT", body: JSON.stringify({ version: 1, dates: dates.sort() }), headers: { "content-type": "application/json", [STAMP]: stamp } });
 if (!put.ok) throw new Error(`auction report index write failed (${put.status})`);
 return { written: true, reports: count };
}
