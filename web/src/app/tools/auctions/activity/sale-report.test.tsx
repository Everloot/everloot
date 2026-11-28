// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import SaleReport from "./sale-report";

test("opens a local file, shows the selected recipe's sales, switches cycles and clears the report", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const now = Date.parse("2026-11-28T12:00:00Z") / 1000;
  const clock = vi.spyOn(Date, "now").mockReturnValue(now * 1000);
  try {
    await act(async () => root.render(<SaleReport initialName="Cloth" />));
    const input = div.querySelector("input")!;
    Object.defineProperty(input, "files", { value: [{
      size: 300,
      text: async () => `EverlootDB = { ledger = { sales = {
        { itemName = "Cloth", status = "paid", total = 720, at = ${now - 1} },
        { itemName = "Ore", status = "paid", total = 880, at = ${now - 1} },
      } } }`,
    }] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(div.querySelector("select")?.value).toBe("Cloth");
    expect(div.querySelector("tbody")?.textContent).toContain("Cloth");
    expect(div.querySelector("tbody")?.textContent).not.toContain("Ore");
    const button = (label: string) => [...div.querySelectorAll("button")].find(b => b.textContent === label)!;
    await act(async () => button("Since weekly reset").click());
    expect(div.textContent).toContain("This file has no current weekly reset time.");
    await act(async () => button("This month").click());
    expect(div.querySelector("tbody")?.textContent).toContain("Cloth");
    await act(async () => button("Clear report").click());
    expect(div.querySelector("table")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    div.remove();
    fetchSpy.mockRestore();
    clock.mockRestore();
  }
});
