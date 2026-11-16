// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AhledgerPrices from "./AhledgerPrices";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const price = { itemId: 2589, minBuyout: 20, median: 43, quantity: 9085, salesPerDay: 18095.4, observedAt: "2026-11-15T15:03:06.000Z" };
const regions = [
  { label: "US", markets: ["forever.pvp.alliance.us", "forever.pvp.horde.us"] },
  { label: "EU", markets: ["forever.pvp.horde.eu"] },
];

test("the page's HTML holds no AH Ledger price: the panel reads them in the browser", () => {
  const html = renderToStaticMarkup(<AhledgerPrices itemId={2589} regions={regions} />);
  expect(html).toContain('data-ahledger="loading"');
  expect(html).not.toMatch(/9,085|43c/);
  expect(html).toContain('href="https://ahledger.com"');
});

test("each market's row links to AH Ledger's item page; a market without a price says so; the region switch reads that region", async () => {
  const fetchImpl = vi.fn(async (url: string) => Response.json({ ok: true, prices: url.includes("alliance") ? [] : [price], credit: { url: "https://ahledger.com/test-credit" } }));
  vi.stubGlobal("fetch", fetchImpl);
  await act(async () => root.render(<AhledgerPrices itemId={2589} regions={regions} />));
  expect(fetchImpl.mock.calls.map(([u]) => u)).toEqual(["/api/ahledger/forever.pvp.alliance.us?items=2589", "/api/ahledger/forever.pvp.horde.us?items=2589"]);
  expect(container.querySelector("[data-ahledger]")?.getAttribute("data-ahledger")).toBe("rows");
  const text = container.textContent ?? "";
  expect(text).toContain("PvP Alliance");
  expect(text).toContain("no price");
  expect(text).toContain("9,085");
  expect(text).toContain("18,095.4");
  expect(text).toContain("15 Nov, 15:03 UTC");
  expect(container.querySelector('a[href="https://ahledger.com/items/2589/forever.pvp.horde.us"]')).not.toBeNull();
  expect(container.querySelector('a[href="https://ahledger.com/test-credit"]')?.textContent).toBe("Prices from AHledger");

  const eu = [...container.querySelectorAll("button")].find((b) => b.textContent === "EU")!;
  await act(async () => eu.click());
  expect(fetchImpl.mock.calls.at(-1)?.[0]).toBe("/api/ahledger/forever.pvp.horde.eu?items=2589");
});

test("a failed read says AH Ledger could not be read, not that there is no price", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503 })));
  await act(async () => root.render(<AhledgerPrices itemId={2589} regions={regions} />));
  expect(container.querySelector("[data-ahledger]")?.getAttribute("data-ahledger")).toBe("failed");
  expect(container.textContent).toContain("could not be read");
  expect(container.textContent).not.toContain("no price");
});
