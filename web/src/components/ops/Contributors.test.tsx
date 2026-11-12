// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OpsContributor } from "@/lib/ops/types";
import Contributors from "./Contributors";

const rows: OpsContributor[] = [
  { id: "a", alias: "Contributor Alpha", excluded: false, realms: ["CAMWOW US1 Realm 4 PvP"], kinds: ["loot"], successfulReceipts: 2, records: 3, lastReceivedAt: "2026-11-12T12:00:00Z", daysActive: ["2026-11-12"], series: "receipts" },
  { id: "b", alias: "Contributor Beta", excluded: false, realms: ["Unfamiliar realm"], kinds: ["quest"], successfulReceipts: 1, records: 2, lastReceivedAt: "2026-10-25T12:00:00Z", daysActive: ["2026-10-25"], series: "stored-uploads" },
  { id: "c", alias: "Owner fixture", excluded: true, realms: [], kinds: [], successfulReceipts: 1, records: 1, lastReceivedAt: "2026-11-12T12:00:00Z", daysActive: ["2026-11-12"], series: "receipts" },
];
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function select(label: string, value: string) {
  const el = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });
}
it("excludes owner/tests and filters exact realms, kinds and UTC active dates", async () => {
  await act(async () => root.render(<Contributors rows={rows} asOf="2026-11-12T14:00:00Z" />));
  expect(container.textContent).toContain("Contributor Alpha");
  expect(container.textContent).not.toContain("Owner fixture");
  expect(container.textContent).not.toContain("Contributor Beta");
  await select("Active window", "30");
  expect(container.textContent).toContain("Contributor Beta");
  await select("Contribution kind", "quest");
  expect(container.textContent).not.toContain("Contributor Alpha");
  await select("Contribution kind", "");
  await act(async () => Array.from(container.querySelectorAll("button")).find(b => b.textContent === "US1 · Realm 4")!.click());
  expect(container.textContent).not.toContain("Contributor Beta");
  expect(container.querySelector<HTMLSelectElement>('select[aria-label="Realm"]')!.value).toBe(rows[0].realms[0]);
});
it("keeps realm filtering separate from focusable and touch details", async () => {
  await act(async () => root.render(<Contributors rows={rows} asOf="2026-11-12T14:00:00Z" />));
  const filter = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "US1 · Realm 4")!;
  filter.focus();
  expect(document.activeElement).toBe(filter);
  expect(document.getElementById(filter.getAttribute("aria-describedby")!)?.textContent).toBe(rows[0].realms[0]);
  const details = container.querySelector<HTMLButtonElement>('button[aria-label^="Realm details"]')!;
  await act(async () => details.click());
  expect(details.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector<HTMLSelectElement>('select[aria-label="Realm"]')!.value).toBe("");
  await act(async () => details.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(details.getAttribute("aria-expanded")).toBe("false");
});
