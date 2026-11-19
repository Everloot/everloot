import { expect, test } from "vitest";
import sharp from "sharp";
import { renderAuctionReportCard } from "./og-card";
import { buildAuctionReports } from "./auction-report";
import { emptyMarket, foldMarket } from "@kb/market";
test("both share sizes render real PNGs with a complete daily fixture", async () => {
 const now = new Date("2026-11-15T12:00Z");
 const records = [13,14].flatMap(day => [0,1,2].map(i => ({kind: "auction_snapshot", installId: `reporter-${i}`, realm: "CAMWOW US1 Realm 4 PvP", house: "Horde", capturedAt: `2026-11-${day}T12:00:00Z`, items: [[765, 4, 40, day*10, day*10]]})));
 const r = buildAuctionReports(foldMarket(emptyMarket(),records,now),now)[1]!;
 for (const tall of [true,false]) {
  const image = await renderAuctionReportCard(r,tall);
  const bytes = Buffer.from(await image.arrayBuffer());
  expect((await sharp(bytes).metadata())).toMatchObject({format:"png",width:1200,height:tall?1800:630});
 }
});
test("large coverage lists preserve a visible data-time footer in both sizes", async () => {
 const report: import("./auction-report").AuctionReport = { date:"2026-11-14",publishedAt:"2026-11-15T00:05:00Z",headline:"Herbs: 20 of 27 comparable item-house prices fell from the day before.",houses:Array.from({length:40},(_,i)=>`US · CAMWOW US1 Realm ${i} PvP · Horde · PvP`),goods:500,scannedThrough:"2026-11-14T23:50:00Z",includesOwnScans:true,risers:[],fallers:[],mostListed:[],categories:[],spreads:[] };
 for (const tall of [true,false]) {
  const bytes = Buffer.from(await (await renderAuctionReportCard(report,tall)).arrayBuffer());
  const { data, info } = await sharp(bytes).extract({left:40,top:(tall?1800:630)-110,width:1120,height:80}).raw().toBuffer({resolveWithObject:true});
  let textPixels=0;
  for(let i=0;i<data.length;i+=info.channels) if(data[i]>90 && data[i+1]>90 && data[i+2]>65) textPixels++;
  expect(textPixels).toBeGreaterThan(500);
 }
});
