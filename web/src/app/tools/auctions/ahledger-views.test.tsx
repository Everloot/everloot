// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AhledgerHistory from "./AhledgerHistory";
import AhledgerCrafting from "./AhledgerCrafting";
import { AhledgerDeals, AhledgerEconomySummary } from "./AhledgerMarket";
import { AHLEDGER_MARKET_SLOT } from "./AhledgerPanel";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const history = { median7d: 123456, median30d: 234567, salesPerDay: 3.5, windowDays: 7, series: [
  { t: "2026-11-14T00:00:00Z", min: 10, median: 15, p25: 12, p75: 18 },
  { t: "2026-11-15T00:00:00Z", min: 11, median: 16, p25: 13, p75: 19 },
] };
const credit = { text: "Prices from AHledger", url: "https://ahledger.com/test-credit" };
const panels: { name: string; panel: () => ReactNode; field: string; empty: unknown; message: string }[] = [
  { name: "history", panel: () => <AhledgerHistory itemId={42} />, field: "history", empty: { ...history, median7d: null, median30d: null, salesPerDay: null, series: [] }, message: "No price history" },
  { name: "crafting", panel: () => <AhledgerCrafting profession="Enchanting" />, field: "recipes", empty: [], message: "No crafting margins" },
  { name: "deals", panel: () => <AhledgerDeals />, field: "deals", empty: [], message: "No deals meet" },
  { name: "economy", panel: () => <AhledgerEconomySummary />, field: "markets", empty: [], message: "No full scans" },
];

for (const p of panels) {
  test(`${p.name}: server HTML has only the loading shell and credit; no fetch or prices`, () => {
    const fetchImpl = vi.fn(); vi.stubGlobal("fetch", fetchImpl);
    const html = renderToStaticMarkup(p.panel());
    expect(html).toContain('data-ahledger="loading"');
    expect(html).toContain('href="https://ahledger.com"');
    expect(html).not.toMatch(/123456|234567|Test item|Test recipe|<table|data-history-line/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test(`${p.name}: loading and empty answers keep a credit link`, async () => {
    let finish!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    await act(async () => root.render(p.panel()));
    expect(container.textContent).toContain("Reading AH Ledger");
    expect(container.querySelector('a[href="https://ahledger.com"]')).not.toBeNull();
    await act(async () => finish(Response.json({ ok: true, [p.field]: p.empty, credit })));
    expect(container.textContent).toContain(p.message);
    expect(container.querySelector('a[href="https://ahledger.com/test-credit"]')?.textContent).toBe("Prices from AHledger");
  });

  test(`${p.name}: failed reads say failed, not empty, and keep credit`, async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503 })));
    await act(async () => root.render(p.panel()));
    expect(container.querySelector("[data-ahledger]")?.getAttribute("data-ahledger")).toBe("failed");
    expect(container.textContent).toContain("could not be read");
    expect(container.textContent).not.toContain(p.message);
    expect(container.querySelector('a[href="https://ahledger.com"]')).not.toBeNull();
  });
}

test("history reads the realm's initial market, renders both lines and band, and switches one market at a time", async () => {
  const fetchImpl = vi.fn(async () => Response.json({ ok: true, history, credit })); vi.stubGlobal("fetch", fetchImpl);
  await act(async () => root.render(<AhledgerHistory itemId={42} defaultMarket="forever.pvp.alliance.eu" />));
  expect(fetchImpl.mock.calls).toHaveLength(1);
  expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe("/api/ahledger/forever.pvp.alliance.eu/history?item=42");
  expect(container.querySelectorAll("[data-history-line]")).toHaveLength(2);
  expect(container.querySelector("[data-history-band]")).not.toBeNull();
  expect(container.querySelector("linearGradient")).toBeNull();
  expect(container.textContent).toContain("7-day median"); expect(container.textContent).toContain("30-day median");
  expect(container.textContent).toContain("3.5 (7-day window)");
  const faction = container.querySelectorAll("select")[2];
  await act(async () => { faction.value = "horde"; faction.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(fetchImpl.mock.calls).toHaveLength(2);
  expect((fetchImpl.mock.calls[1] as unknown[])[0]).toBe("/api/ahledger/forever.pvp.horde.eu/history?item=42");
});

test("crafting renders monetary margins and unpriced rows, with unsupported professions making no request", async () => {
  const fetchImpl = vi.fn(async () => Response.json({ ok: true, recipes: [{ spellId: 42, name: "Test recipe", cost: null, netValue: 20, margin: null, salesPerDay: null, profitPerDay: null }], credit })); vi.stubGlobal("fetch", fetchImpl);
  await act(async () => root.render(<AhledgerCrafting profession="Fishing" />));
  expect(fetchImpl).not.toHaveBeenCalled(); expect(container.innerHTML).toBe("");
  await act(async () => root.render(<AhledgerCrafting profession="Enchanting" />));
  expect(container.textContent).toContain("unpriced"); expect(container.textContent).toContain("unrecorded");
  expect(container.textContent).toContain("upper bound");
  expect(container.querySelector('a[href="/database/spells/42"]')?.textContent).toBe("Test recipe");
});

test("deals link to Everloot items and show the reference basis, then region and ruleset changes fetch that market", async () => {
  const fetchImpl = vi.fn(async () => Response.json({ ok: true, deals: [{ itemId: 42, name: "Test item", minBuyout: 10, referenceMedian: 20, basis: "7d", quantity: 5, saving: 50 }], credit })); vi.stubGlobal("fetch", fetchImpl);
  await act(async () => root.render(<AhledgerDeals />));
  expect(container.querySelector('a[href="/tools/auctions/item/42"]')?.textContent).toBe("Test item");
  expect(container.textContent).toContain("7d");
  await act(async () => { const el = container.querySelectorAll("select")[0]; el.value = "kr"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { const el = container.querySelectorAll("select")[1]; el.value = "rppvp"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  expect((fetchImpl.mock.calls.at(-1) as unknown[])[0]).toBe("/api/ahledger/forever.rppvp.alliance.kr/deals");
});

test("economy compares current and week-ago values per labelled market and rejects an off-site credit", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, markets: [{ market: "forever.pvp.horde.eu", current: 123456, weekAgo: null }], credit: { url: "https://evil.test" } })));
  await act(async () => root.render(<AhledgerEconomySummary />));
  expect(container.textContent).toContain("PvP Horde EU"); expect(container.textContent).toContain("unrecorded");
  expect(container.querySelector('a[href="https://ahledger.com"]')).not.toBeNull();
});

test("a stale market response cannot replace the newly selected market's answer", async () => {
  let finishOld!: (res: Response) => void;
  vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOld = resolve; })).mockImplementation(async () => Response.json({ ok: true, deals: [], credit })));
  await act(async () => root.render(<AhledgerDeals />));
  await act(async () => { const el = container.querySelectorAll("select")[2]; el.value = "horde"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => finishOld(Response.json({ ok: true, deals: [{ itemId: 42, name: "Stale test item" }], credit })));
  expect(container.textContent).not.toContain("Stale test item"); expect(container.textContent).toContain("No deals meet");
});

test("an unreadable success body is a failed read", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ notice: "unavailable" })));
  await act(async () => root.render(<AhledgerDeals />));
  expect(container.textContent).toContain("could not be read");
});

test("a market picked in one panel is the next panel's market; a realm page's own market comes first", async () => {
  const fetchImpl = vi.fn(async () => Response.json({ ok: true, deals: [], recipes: [], history, credit })); vi.stubGlobal("fetch", fetchImpl);
  await act(async () => root.render(<AhledgerDeals />));
  expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe("/api/ahledger/forever.normal.alliance.us/deals");
  await act(async () => { const el = container.querySelectorAll("select")[2]; el.value = "horde"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(localStorage.getItem(AHLEDGER_MARKET_SLOT)).toBe("forever.normal.horde.us");
  await act(async () => root.render(<AhledgerCrafting profession="Enchanting" />));
  // Only the remembered market is read: no request for the default one first.
  expect(fetchImpl.mock.calls.map((c) => (c as unknown[])[0]).filter((u) => String(u).includes("crafting"))).toEqual(["/api/ahledger/forever.normal.horde.us/crafting?profession=Enchanting"]);
  expect((container.querySelectorAll("select")[2] as HTMLSelectElement).value).toBe("horde");
  await act(async () => root.render(<AhledgerHistory itemId={42} defaultMarket="forever.pvp.alliance.eu" />));
  expect((fetchImpl.mock.calls.at(-1) as unknown[])[0]).toBe("/api/ahledger/forever.pvp.alliance.eu/history?item=42");
});

test("a remembered value that is not a market, or storage the browser refuses, reads the default market", async () => {
  const fetchImpl = vi.fn(async () => Response.json({ ok: true, deals: [], credit })); vi.stubGlobal("fetch", fetchImpl);
  localStorage.setItem(AHLEDGER_MARKET_SLOT, "forever.hardcore.horde.us/../x");
  await act(async () => root.render(<AhledgerDeals />));
  expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe("/api/ahledger/forever.normal.alliance.us/deals");
  await act(async () => root.unmount()); root = createRoot(container);
  const blocked = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
  try {
    await act(async () => root.render(<AhledgerDeals />));
    expect((fetchImpl.mock.calls.at(-1) as unknown[])[0]).toBe("/api/ahledger/forever.normal.alliance.us/deals");
  } finally { blocked.mockRestore(); }
});

const recipes = [
  { spellId: 1, name: "Test alpha", cost: 30, netValue: 40, margin: 10, salesPerDay: 2, profitPerDay: 20 },
  { spellId: 2, name: "Test beta", cost: 10, netValue: 60, margin: 50, salesPerDay: 1, profitPerDay: 50 },
  { spellId: 3, name: "Test gamma", cost: null, netValue: 60, margin: null, salesPerDay: null, profitPerDay: null },
];
const recipeOrder = () => [...container.querySelectorAll('tbody a')].map((el) => el.textContent);
test("crafting sorts profit, margin and cost in both directions with unknown values last, and filters names", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, recipes, credit })));
  await act(async () => root.render(<AhledgerCrafting profession="Enchanting" />));
  expect(recipeOrder()).toEqual(["Test beta", "Test alpha", "Test gamma"]);
  const select = container.querySelector('select[aria-label="Sort crafting margins"]') as HTMLSelectElement;
  expect(select).not.toBeNull();
  for (const [value, order] of [
    ["profit", ["Test alpha", "Test beta", "Test gamma"]],
    ["-margin", ["Test beta", "Test alpha", "Test gamma"]],
    ["margin", ["Test alpha", "Test beta", "Test gamma"]],
    ["cost", ["Test beta", "Test alpha", "Test gamma"]],
    ["-cost", ["Test alpha", "Test beta", "Test gamma"]],
    ["-net", ["Test beta", "Test gamma", "Test alpha"]],
    ["net", ["Test alpha", "Test beta", "Test gamma"]],
    ["-sales", ["Test alpha", "Test beta", "Test gamma"]],
    ["sales", ["Test beta", "Test alpha", "Test gamma"]],
  ] as const) {
    await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(recipeOrder(), value).toEqual(order);
    expect(new URL(window.location.href).searchParams.get("sort"), value).toBe(value);
  }
  // The default order leaves no parameter behind.
  await act(async () => { select.value = "-profit"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(new URL(window.location.href).searchParams.has("sort")).toBe(false);
  const input = container.querySelector('input[type="search"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, " BETA ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(recipeOrder()).toEqual(["Test beta"]);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "missing");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("No recipes match");
  expect(container.textContent).not.toContain("Prices as of");
});

test("crafting URL market wins over memory, preserves URL state on selection, and follows browser navigation", async () => {
  localStorage.setItem(AHLEDGER_MARKET_SLOT, "forever.normal.alliance.us");
  window.history.replaceState({ marker: 1 }, "", "/tools/professions/enchanting?other=keep&market=forever.pvp.horde.eu#recipes");
  const fetchImpl = vi.fn(async () => Response.json({ ok: true, recipes, credit })); vi.stubGlobal("fetch", fetchImpl);
  await act(async () => root.render(<AhledgerCrafting profession="Enchanting" />));
  expect(fetchImpl.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["/api/ahledger/forever.pvp.horde.eu/crafting?profession=Enchanting"]);
  await act(async () => { const select = container.querySelectorAll("select")[0]; select.value = "us"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(new URL(window.location.href).searchParams.get("market")).toBe("forever.pvp.horde.us");
  expect(window.location.search).toContain("other=keep"); expect(window.location.hash).toBe("#recipes");
  expect(window.history.state).toEqual({ marker: 1 });
  expect(localStorage.getItem(AHLEDGER_MARKET_SLOT)).toBe("forever.pvp.horde.us");
  await act(async () => { window.history.replaceState(null, "", "?market=forever.normal.alliance.kr"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect((fetchImpl.mock.calls.at(-1) as unknown[])[0]).toBe("/api/ahledger/forever.normal.alliance.kr/crafting?profession=Enchanting");
});

test("crafting makes a remembered market shareable immediately and rejects invalid URL markets", async () => {
  localStorage.setItem(AHLEDGER_MARKET_SLOT, "forever.rp.horde.eu");
  window.history.replaceState(null, "", "?market=invalid&other=keep");
  const fetchImpl = vi.fn(async () => Response.json({ ok: true, recipes: [], credit })); vi.stubGlobal("fetch", fetchImpl);
  await act(async () => root.render(<AhledgerCrafting profession="Enchanting" />));
  expect(new URL(window.location.href).searchParams.get("market")).toBe("forever.rp.horde.eu");
  expect(window.location.search).toContain("other=keep");
  expect(fetchImpl.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["/api/ahledger/forever.rp.horde.eu/crafting?profession=Enchanting"]);
});

test("crafting reads its sort from a shared URL, marks the sorted column, follows browser navigation and ignores an unknown sort", async () => {
  window.history.replaceState(null, "", "/tools/professions/enchanting?market=forever.pvp.horde.eu&sort=-net");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, recipes, credit })));
  await act(async () => root.render(<AhledgerCrafting profession="Enchanting" />));
  const select = () => container.querySelector('select[aria-label="Sort crafting margins"]') as HTMLSelectElement;
  expect(recipeOrder()).toEqual(["Test beta", "Test gamma", "Test alpha"]);
  expect(select().value).toBe("-net");
  expect(container.querySelector('th[aria-sort="descending"]')?.textContent).toContain("Net value");
  await act(async () => { window.history.replaceState(null, "", "?market=forever.pvp.horde.eu&sort=sales"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(recipeOrder()).toEqual(["Test beta", "Test alpha", "Test gamma"]);
  expect(container.querySelector('th[aria-sort="ascending"]')?.textContent).toContain("Sales per day");
  await act(async () => { window.history.replaceState(null, "", "?market=forever.pvp.horde.eu&sort=-name"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(recipeOrder()).toEqual(["Test beta", "Test alpha", "Test gamma"]);
  expect(select().value).toBe("-profit");
});
