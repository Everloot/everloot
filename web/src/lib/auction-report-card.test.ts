import { expect, test } from "vitest";
import sharp from "sharp";
import { renderAuctionReportCard } from "./og-card";
import { buildAuctionReports } from "./auction-report";
import { emptyMarket, foldMarket } from "../../../kb/src/market";
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
