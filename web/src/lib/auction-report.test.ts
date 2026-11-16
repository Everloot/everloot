import { expect, test } from "vitest";
import { emptyMarket, foldMarket } from "../../../kb/src/market";
import { buildAuctionReports } from "./auction-report";
const now = new Date("2026-11-15T12:00:00Z");
const scans = (day: string, house = "Horde", quantity = 40, reporters = 3) => Array.from({ length: reporters }, (_, i) => ({ kind: "auction_snapshot", installId: `reporter-${i}`, realm: "CAMWOW US1 Realm 4 PvP", house, capturedAt: `${day}T18:00:00Z`, items: [[765, 8, quantity, day === "2026-11-14" ? 200 : 100, day === "2026-11-14" ? 200 : 100]] }));
const build = (rows: unknown[]) => buildAuctionReports(foldMarket(emptyMarket(), rows, now), now, new Map([[765, { name: "Silverleaf", category: "Herbs" }]]));
test("completed UTC days only, exact previous day, with house and region attribution", () => {
 const reports = build([...scans("2026-11-13"), ...scans("2026-11-14"), ...scans("2026-11-15")]);
 const r = reports.at(-1)!;
 expect(r.date).toBe("2026-11-14"); expect(r.houses).toHaveLength(1); expect(r.goods).toBe(1);
 expect(r.risers[0]).toMatchObject({ itemId: 765, change: 1, region: "us", ruleset: "pvp", house: "Horde" });
 expect(r.spreads).toEqual([]); expect(r.categories).toEqual([]);
 expect(r.mostListed[0]?.listings).toBe(8);
});
test("no prior day and gaps do not invent moves", () => {
 expect(build(scans("2026-11-14"))[0]!.risers).toEqual([]);
 expect(build([...scans("2026-11-12"), ...scans("2026-11-14")]).at(-1)!.risers).toEqual([]);
});
test("thin public goods remain coverage but cannot drive moves or spreads; unpublished days disappear", () => {
 const r = build([...scans("2026-11-13"), ...scans("2026-11-14", "Horde", 1)])[1]!;
 expect(r.goods).toBe(1); expect(r.risers).toEqual([]); expect(r.categories).toEqual([]);
 expect(build(scans("2026-11-14", "Horde", 40, 2))).toEqual([]);
});
test("spreads compare the same good within a region and ruleset only", () => {
 const rows = [...scans("2026-11-14"), ...scans("2026-11-14", "Alliance").map(r => ({...r, items: [[765, 8, 40, 400, 400]]}))];
 expect(build(rows)[0]!.spreads[0]).toMatchObject({ itemId: 765, cheapest: 200, dearest: 400 });
});
test("outliers cannot drive movers or spreads, and sparse categories do not claim a trend", () => {
 const rows = [9,10,11,12,13,14].flatMap(d => scans(`2026-11-${String(d).padStart(2,"0")}`).map(r => ({...r, capturedAt: `2026-11-${String(d).padStart(2,"0")}T18:00:00Z`, items: [[765,8,40,d === 14 ? 1000 : 100,d === 14 ? 1000 : 100]]})));
 const r = build(rows).at(-1)!;
 expect(r.risers).toEqual([]); expect(r.categories).toEqual([]); expect(r.headline).not.toContain("Herbs:");
 expect(r.publishedAt).toBe(now.toISOString());
});
test("a category trend needs at least three public comparisons", () => {
 const rows = ["2026-11-13","2026-11-14"].flatMap(d => scans(d).map(r => ({...r,items:[765,766,767].map(id => [id,8,40,d.endsWith("14")?200:100,d.endsWith("14")?200:100])})));
 const items = new Map([765,766,767].map(id => [id,{name:`Item ${id}`,category:"Herbs"}]));
 const r=buildAuctionReports(foldMarket(emptyMarket(),rows,now),now,items).at(-1)!;
 expect(r.categories).toEqual([{name:"Herbs",up:3,down:0,total:3}]);
 expect(r.headline).toContain("3 of 3");
});
