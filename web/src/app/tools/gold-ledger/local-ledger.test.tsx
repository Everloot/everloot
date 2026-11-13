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

const TWO = LUA.replace(`["money_event"] = {`, `["money_event"] = {
      { ["capturedAt"] = "${today}T00:00:04Z", ["character"] = "Jaina", ["realm"] = "Moon Guard", ["category"] = "auction", ["copper"] = 777 },`);

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
  expect(text).toContain("123 gold 45 silver 67 copper"); // gold
  expect(text).toContain("200 gold 0 silver 0 copper"); // peak
  expect(text).toContain("1 gold 23 silver 45 copper"); // quest, in the week card and the receipts
  expect(text).toContain("2 silver 50 copper"); // flight
  expect(text).toContain("1 gold 20 silver 95 copper"); // net this week
  expect(container.querySelectorAll("[data-river] > li")).toHaveLength(30);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
});

test("the window's local ledger shows repairs, vendor purchases and transfers between your characters, sending nothing", async () => {
  const at = Math.floor(Date.now() / 1000) - 60;
  const withLedger = LUA.replace(/\n}$/, `
  ["roster"] = {
    ["k1"] = { ["name"] = "Thrall", ["realm"] = "Moon Guard", ["copper"] = 1300000, ["lastSeen"] = ${at} },
    ["k2"] = { ["name"] = "Jaina", ["realm"] = "Moon Guard" },
  },
  ["ledger"] = {
    ["events"] = {
      { ["at"] = ${at}, ["key"] = "k1", ["category"] = "repair", ["copper"] = 4321 },
      { ["at"] = ${at}, ["key"] = "k1", ["category"] = "vendor_spend", ["copper"] = 600 },
      { ["at"] = ${at}, ["key"] = "k1", ["category"] = "mail_out", ["copper"] = 20000, ["ownAlt"] = true },
      { ["at"] = ${at}, ["key"] = "k2", ["category"] = "mail_in", ["copper"] = 20000, ["ownAlt"] = true },
    },
  },
}`);
  await act(async () => root.render(<LocalLedger />));
  await drop(withLedger);
  const categories = container.querySelector('[aria-labelledby="ledger-categories"]')!.textContent!;
  expect(categories).toContain("Repairs");
  expect(categories).toContain("43 silver 21 copper");
  expect(categories).toContain("Vendor purchases");
  expect(categories).not.toContain("Mail out");
  expect(categories).toMatch(/2 gold 0 silver 0 copper.* moved between your own characters/);
  const receipts = container.querySelector('[aria-labelledby="ledger-receipts"]')!.textContent!;
  expect(receipts).toContain("Mail out, your character");
  // The roster's gold is newer than the file's snapshot, and Jaina has no snapshot at all.
  expect(container.querySelector('[aria-labelledby="ledger-roster"]')!.textContent).toContain("130 gold 0 silver 0 copper");
  expect(container.querySelector('[aria-labelledby="ledger-roster"]')!.textContent).toContain("Jaina");
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("the spending insights follow the period and the auction sales show the house cut", async () => {
  const now = Math.floor(Date.now() / 1000);
  const withLedger = LUA.replace(/\n}$/, `
  ["roster"] = { ["k1"] = { ["name"] = "Thrall", ["realm"] = "Moon Guard" } },
  ["ledger"] = {
    ["events"] = {
      { ["at"] = ${now - 20 * 86400}, ["key"] = "k1", ["category"] = "repair", ["copper"] = 90000 },
      { ["at"] = ${now - 60}, ["key"] = "k1", ["category"] = "auction_spend", ["copper"] = 30000 },
    },
    ["sales"] = {
      { ["at"] = ${now - 120}, ["key"] = "k1", ["itemName"] = "Linen Cloth", ["count"] = 20, ["total"] = 19000, ["cut"] = 1000, ["status"] = "paid" },
      { ["at"] = ${now - 30}, ["key"] = "k1", ["itemName"] = "Silk Cloth", ["status"] = "pending" },
    },
  },
}`);
  await act(async () => root.render(<LocalLedger />));
  await drop(withLedger);
  const spending = () => container.querySelector('[aria-labelledby="ledger-spending"]')!.textContent!;
  // 30 days by default: both payments, the repair the larger.
  expect(spending()).toContain("Repairs");
  expect(spending()).toContain("Auction purchases");
  expect(spending()).toMatch(/Spent.*12 gold 0 silver 0 copper/);
  expect(container.querySelectorAll("[data-daily-spending] > li")).toHaveLength(30);
  const largest = [...container.querySelectorAll('[aria-labelledby="ledger-largest"] tbody tr')].map((tr) => tr.textContent);
  expect(largest[0]).toContain("Repairs");

  const seven = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Period"] button')].find((b) => b.textContent === "7 days")!;
  await act(async () => { seven.click(); });
  expect(seven.getAttribute("aria-pressed")).toBe("true");
  expect(spending()).not.toContain("Repairs");
  expect(spending()).toMatch(/Spent.*3 gold 0 silver 0 copper/);
  expect(container.querySelectorAll("[data-daily-spending] > li")).toHaveLength(7);
  expect(container.querySelectorAll("[data-river] > li")).toHaveLength(7);

  const sales = container.querySelector('[aria-labelledby="ledger-sales"]')!.textContent!;
  expect(sales).toContain("Linen Cloth");
  expect(sales).toMatch(/House cut.*10 silver 0 copper.*\(5%\)/);
  expect(sales).toContain("1 sale is waiting in the mailbox");
  expect(fetchSpy).not.toHaveBeenCalled();
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
  expect(container.textContent).toContain("123 gold 45 silver 67 copper");
  expect(remember().checked).toBe(true);

  const forget = [...container.querySelectorAll("button")].find((b) => b.textContent === "Forget")!;
  await act(async () => { forget.click(); });
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(container.textContent).not.toContain("123 gold 45 silver 67 copper");
});

test("choosing a character narrows the week, categories and receipts to them and names them", async () => {
  await act(async () => root.render(<LocalLedger />));
  await drop(TWO);
  const select = container.querySelector<HTMLSelectElement>("select")!;
  expect(select.labels?.[0]?.textContent).toBe("Character");
  expect([...select.options].map((o) => o.textContent)).toEqual(["All characters", "Thrall (Moon Guard)", "Jaina (Moon Guard)"]);
  const notes = () => container.textContent!;
  const receipts = () => [...container.querySelectorAll('[aria-labelledby="ledger-receipts"] tbody tr')].map((tr) => tr.textContent);
  expect(notes()).toContain("The last 7 days, all characters.");
  expect(receipts()).toHaveLength(3);

  await act(async () => {
    select.value = "1:Thrall-Moon Guard";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(notes()).toContain("The last 7 days, Thrall (Moon Guard).");
  expect(notes()).toContain("Every money event in the file, Thrall (Moon Guard).");
  expect(notes()).not.toContain("all characters");
  expect(receipts()).toHaveLength(2);
  expect(receipts().join(" ")).not.toContain("Jaina");
  expect(notes()).not.toContain("7s 77c");
  // The Characters table stays whole.
  expect(container.querySelector('[aria-labelledby="ledger-roster"]')!.textContent).toContain("Jaina");
});
