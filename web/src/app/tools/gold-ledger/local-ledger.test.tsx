// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import LocalLedger, { STORAGE_KEY } from "./LocalLedger";

const today = new Date().toISOString().slice(0, 10);
const LUA = `EverlootDB = {
  ["version"] = "0.2.6",
  ["installId"] = "abc",
  ["records"] = {
    ["gold_snapshot"] = {
      { ["capturedAt"] = "${today}T00:00:01Z", ["character"] = "Thrall", ["realm"] = "Moon Guard", ["currentCopper"] = 1234567, ["peakCopper"] = 2000000 },
    },
    ["money_event"] = {
      { ["capturedAt"] = "${today}T00:00:02Z", ["character"] = "Thrall", ["realm"] = "Moon Guard", ["category"] = "quest", ["copper"] = 12345 },
      { ["capturedAt"] = "${today}T00:00:03Z", ["character"] = "Thrall", ["realm"] = "Moon Guard", ["category"] = "flight", ["copper"] = 250 },
    },
  },
}`;

let container: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function drop(text: string, name = "Everloot.lua") {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File([text], name)], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  // file.text() resolves on a later tick.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const remember = () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][0]!;

test("without a file it says where the file is and that it stays here", async () => {
  await act(async () => root.render(<LocalLedger />));
  expect(container.textContent).toContain("The file stays on this computer");
  expect(container.textContent).toContain("WTF/Account/<account>/SavedVariables/Everloot.lua");
  expect(container.querySelector("[data-river]")).toBeNull();
});

test("reads Everloot.lua in the browser and shows the ledger, sending nothing", async () => {
  await act(async () => root.render(<LocalLedger />));
  await drop(LUA);
  const text = container.textContent!;
  expect(text).toContain("Thrall");
  expect(text).toContain("123g 45s 67c"); // gold
  expect(text).toContain("200g 0s 0c"); // peak
  expect(text).toContain("1g 23s 45c"); // quest, in the week card and the receipts
  expect(text).toContain("2s 50c"); // flight
  expect(text).toContain("1g 20s 95c"); // net this week
  expect(container.querySelectorAll("[data-river] > li")).toHaveLength(30);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
});

test("a file that is not an Everloot export says so", async () => {
  await act(async () => root.render(<LocalLedger />));
  await drop("SomethingElseDB = {}", "Other.lua");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be read");
});

test("Remember keeps the summary, not the file, and Forget clears it", async () => {
  await act(async () => root.render(<LocalLedger />));
  await act(async () => { remember().click(); });
  await drop(LUA);
  const stored = window.localStorage.getItem(STORAGE_KEY)!;
  expect(JSON.parse(stored).roster[0]).toMatchObject({ character: "Thrall", copper: 1_234_567 });
  expect(stored).not.toContain("installId");

  // A new visit shows the remembered ledger.
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<LocalLedger />));
  expect(container.textContent).toContain("123g 45s 67c");
  expect(remember().checked).toBe(true);

  const forget = [...container.querySelectorAll("button")].find((b) => b.textContent === "Forget")!;
  await act(async () => { forget.click(); });
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(container.textContent).not.toContain("123g 45s 67c");
});
