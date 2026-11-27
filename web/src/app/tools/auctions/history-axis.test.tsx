import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { AhledgerPoint } from "@/lib/ahledger";
import { HistoryChart } from "./AhledgerHistory";

// Made-up prices: a median near 2s 21c with one p75 spike to 27s 37c, as the Copper Ore history had.
const day = (i: number, over: Partial<AhledgerPoint> = {}): AhledgerPoint => ({ t: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(), min: 200, median: 221, p25: 210, p75: 240, ...over });

test("one outlier does not stretch the axis: it reads the robust range, and the point past it is marked on the edge", () => {
  const series = [...Array.from({ length: 20 }, (_, i) => day(i)), day(20, { p75: 2737 }), day(21, { min: 14 })];
  const out = renderToStaticMarkup(<HistoryChart series={series} />);
  // The caption's range is the axis's, not 14c to 27s 37c.
  expect(out).not.toContain("37");
  expect(out).toContain("data-history-clipped");
  expect(out).toContain("beyond the axis");
});

test("a series with no outlier keeps the full range and marks nothing", () => {
  const out = renderToStaticMarkup(<HistoryChart series={Array.from({ length: 10 }, (_, i) => day(i, { median: 221 + i }))} />);
  expect(out).not.toContain("data-history-clipped");
  expect(out).not.toContain("beyond the axis");
});
