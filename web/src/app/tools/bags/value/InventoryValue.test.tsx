// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { MARKET_PRICE_FIELDS_FULL } from "@everloot/protocol";
import InventoryValue from "./InventoryValue";

const realm = "CAMWOW US1 Realm 4 PVP";
const attribution = {
  licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  credit: "Everloot contributors", source: "https://everloot.app/tools/auctions", terms: "https://everloot.app/terms",
};
const day = "2026-11-27";
const dataAsOf = `${day}T15:00:00.000Z`;
const row = (id: number, min: number, ageDays: number) => [id, null, min, min, 1, ageDays ? "2026-11-23" : day, 3, ageDays ? null : dataAsOf, ageDays, null];

test("submits unique IDs to the selected house in batches and values current quotes only", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn(async (url: string) => {
    const query = new URL(url, "https://everloot.app").searchParams;
    if (!query.has("items")) return Response.json({ ok: true, dataAsOf, realms: [realm], houses: { [realm]: ["Horde", "Neutral"] }, attribution });
    if (query.get("items")!.startsWith("101,")) return new Response(null, { status: 429 });
    return Response.json({ ok: true, realm, house: "Horde", dataAsOf, rule: "Players' scans", fields: MARKET_PRICE_FIELDS_FULL, attribution, items: [row(1, 105, 0), row(2, 900, 4)] });
  });
  vi.stubGlobal("fetch", fetcher);
  const initialUrl = window.location.href;
  const writeStorage = vi.spyOn(Storage.prototype, "setItem");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const choose = (id: string, value: string) => act(async () => {
    const field = host.querySelector<HTMLSelectElement>(`#${id}`)!;
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const addInventory = (value: string) => act(async () => {
    const field = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const valueInventory = () => act(async () => { host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); });
  try {
    await act(async () => root.render(<InventoryValue />));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await choose("inventory-realm", realm);
    expect(host.querySelector<HTMLSelectElement>("#inventory-house")!.value).toBe("");
    await choose("inventory-house", "Horde");
    await addInventory("do not send this text");
    await valueInventory();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Line 1");

    await addInventory(`EVERLOOT-INVENTORY-1\n${Array.from({ length: 103 }, (_, i) => `${i + 1} 11`).join("\n")}\n1 6`);
    await valueInventory();
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (let index = 1; index <= 2; index++) {
      const request = new URL(fetcher.mock.calls[index][0], "https://everloot.app");
      expect(request.pathname).toBe("/api/market/prices");
      expect([...request.searchParams.keys()].sort()).toEqual(["fields", "house", "items", "realm"]);
      expect(request.searchParams.get("house")).toBe("Horde");
      expect(request.searchParams.get("realm")).toBe(realm);
      expect(request.searchParams.get("fields")).toBe("full");
      expect(request.searchParams.get("items")?.split(",")).toEqual(Array.from({ length: index === 1 ? 100 : 3 }, (_, i) => String(i + (index === 1 ? 1 : 101))));
    }
    expect(host.textContent).toContain("Known subtotal");
    expect(host.textContent).toContain("17s 85c");
    expect(host.textContent).toContain("1 of 103 item types");
    expect(host.textContent).toContain("2026-11-23");
    expect(host.textContent).toContain("Quote too old");
    expect(host.textContent).toContain("No public quote");
    expect(host.textContent).toContain("Quote request unavailable");

    await choose("inventory-house", "Neutral");
    expect(host.textContent).not.toContain("17s 85c");
    expect(fetcher).toHaveBeenCalledTimes(3);
    await valueInventory();
    expect(host.textContent).toContain("No current quotes");
    expect(host.textContent).not.toContain("17s 85c");
    expect(window.location.href).toBe(initialUrl);
    expect(writeStorage).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    writeStorage.mockRestore();
    vi.unstubAllGlobals();
  }
});
