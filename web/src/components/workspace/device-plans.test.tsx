// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { bucketKey, type LocalPlan, type Owner, type PlayerWorkspace } from "@/lib/player-workspace";
import DevicePlans from "./DevicePlans";
import LocalPlanSave from "./LocalPlanSave";

// The device's plans as a player meets them: this browser's localStorage, and /api/auth/me as the only thing the
// page asks the network. Codes are the share-code doc's (docs/2026-10-17-talent-share-code.md).

const MAGE = "EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg";
const MAGE_SMALL = "EL1-mage-1482-1.60.1.70450-OTAwMDE6MQ";
const DRUID = "EL1-druid-0-1.60.1.70450-OTAwMDE6MQ";
const PLANNED = "O1p-AABCC";
const A_ID = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const B_ID = "7c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e";
const ANON: Owner = { kind: "anonymous" };
const A: Owner = { kind: "account", userId: A_ID };
const B: Owner = { kind: "account", userId: B_ID };
const id = (n: number) => `1a2b3c4d-0000-4000-8000-${String(n).padStart(12, "0")}`;

let container: HTMLDivElement;
let root: Root;
/** Who /api/auth/me says is signed in, and how many of its next answers fail. */
let who: { id: string; name: string } | null;
let meFails: number;
let requests: string[];
/** While set, the next answer waits for it; the answer is still the one for the moment it was asked. */
let gate: Promise<void> | null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/tools/builds");
  localStorage.clear();
  who = null;
  meFails = 0;
  requests = [];
  gate = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${String(input)}`);
    if (String(input) !== "/api/auth/me") throw new Error(`Unexpected request ${String(input)}`);
    if (meFails > 0) { meFails--; return Response.json({ error: "Authentication is temporarily unavailable" }, { status: 503 }); }
    const answer = who;
    const wait = gate;
    gate = null;
    if (wait) await wait;
    return Response.json({ user: answer && { ...answer, entitlements: [] } });
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const plan = (over: Partial<LocalPlan> = {}): LocalPlan => ({
  id: id(1), name: "Frost", classSlug: "mage", code: MAGE, code2: null, order: PLANNED, order2: null,
  notes: "", updatedAt: "2026-10-20T12:00:00.000Z", boundTo: null, ...over,
});
const doc = (owner: Owner, plans: LocalPlan[]): PlayerWorkspace => ({ format: "everloot.player-workspace", version: 1, owner, plans, alts: [], watches: [] });
const seed = (owner: Owner, plans: LocalPlan[]) => localStorage.setItem(bucketKey(owner), JSON.stringify(doc(owner, plans)));
const stored = (owner: Owner) => JSON.parse(localStorage.getItem(bucketKey(owner)) ?? "null") as PlayerWorkspace | null;

/** Lets the account lookup and any reads that follow it finish. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function render(ui: ReactElement = <DevicePlans />) {
  await act(async () => root.render(ui));
  await settle();
}
const text = () => container.textContent ?? "";
const button = (label: RegExp, scope: ParentNode = container) => [...scope.querySelectorAll("button")].find((b) => label.test(b.textContent?.trim() ?? ""));
async function click(el: Element | undefined) {
  if (!el) throw new Error("Nothing to click");
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
  await settle();
}
function type(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null, value: string) {
  if (!field) throw new Error("No field");
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
  return act(async () => { setter.call(field, value); field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
/** The field a label names. */
const field = (label: string, scope: ParentNode = container) =>
  [...scope.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select") ?? null;
/** The listed plan with this name. */
const item = (name: string) => [...container.querySelectorAll("li")].find((li) => li.querySelector("h3")?.textContent === name);
const alerts = () => [...container.querySelectorAll('[role="alert"]')].map((a) => a.textContent).join(" ");
const comeBack = async () => { await act(async () => { window.dispatchEvent(new Event("focus")); }); await settle(); };

async function choose(file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("No file input");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
}
const backupFile = (workspace: PlayerWorkspace) => new File([JSON.stringify(workspace)], "everloot-plans-2026-10-26.json", { type: "application/json" });

/** Watches the download: the file's blob and its name. */
function watchDownload() {
  const blobs: Blob[] = [];
  const names: string[] = [];
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b: Blob) => { blobs.push(b); return "blob:everloot/1"; }, revokeObjectURL: () => {} }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
  return { blobs, names };
}

test("signed out, it lists this device's signed-out plans and asks the network only who is signed in", async () => {
  seed(ANON, [plan({ name: "Frost", notes: "Arena notes" })]);
  seed(A, [plan({ id: id(2), name: "A's plan" })]);
  await render();
  expect(item("Frost")?.textContent).toContain("Mage");
  expect(text()).toContain("Arena notes");
  expect(text()).not.toContain("A's plan");
  expect(requests).toEqual(["GET /api/auth/me"]);
});

test("an empty device says how to keep a plan here, and claims no count of agreeing installs", async () => {
  await render();
  expect(text()).toContain("No plans on this device yet.");
  expect(container.querySelector('[aria-label*="installs agree"]')).toBeNull();
});

test("signed in, it lists only that account's plans, never the signed-out ones or another account's", async () => {
  seed(ANON, [plan({ name: "Signed out plan" })]);
  seed(A, [plan({ id: id(2), name: "A's plan" })]);
  seed(B, [plan({ id: id(3), name: "B's plan" })]);
  who = { id: A_ID, name: "Thrall#1234" };
  await render();
  expect(item("A's plan")).toBeDefined();
  expect(text()).not.toContain("Signed out plan");
  expect(text()).not.toContain("B's plan");
  expect(Object.keys(localStorage).join(" ")).not.toContain("Thrall");
});

test("when the tab comes back under another account, or signed out, the list switches to that owner's plans", async () => {
  seed(ANON, [plan({ name: "Signed out plan" })]);
  seed(A, [plan({ id: id(2), name: "A's plan" })]);
  seed(B, [plan({ id: id(3), name: "B's plan" })]);
  who = { id: A_ID, name: "Thrall#1234" };
  await render();
  expect(item("A's plan")).toBeDefined();
  who = { id: B_ID, name: "Jaina#5678" };
  await comeBack();
  expect(item("B's plan")).toBeDefined();
  expect(text()).not.toContain("A's plan");
  who = null;
  await comeBack();
  expect(item("Signed out plan")).toBeDefined();
  expect(text()).not.toContain("B's plan");
});

test("an account answer that arrives after a newer one does not bring the older account's plans back", async () => {
  seed(A, [plan({ id: id(2), name: "A's plan" })]);
  seed(B, [plan({ id: id(3), name: "B's plan" })]);
  let release = () => {};
  gate = new Promise<void>((r) => { release = r; });
  who = { id: A_ID, name: "Thrall#1234" };
  await render();
  who = { id: B_ID, name: "Jaina#5678" };
  await comeBack();
  expect(item("B's plan")).toBeDefined();
  await act(async () => release());
  await settle();
  expect(item("B's plan")).toBeDefined();
  expect(text()).not.toContain("A's plan");
});

test("a failed check after a good one keeps the plans on screen rather than guessing another owner", async () => {
  seed(A, [plan({ id: id(2), name: "A's plan" })]);
  seed(ANON, [plan({ name: "Signed out plan" })]);
  who = { id: A_ID, name: "Thrall#1234" };
  await render();
  meFails = 1;
  await comeBack();
  expect(item("A's plan")).toBeDefined();
  expect(text()).not.toContain("Signed out plan");
});

test("a restore begun under one account is dropped when the account changes before the file is read", async () => {
  seed(A, [plan({ id: id(2), name: "A's plan" })]);
  who = { id: A_ID, name: "Thrall#1234" };
  await render();
  let release = () => {};
  const read = new Promise<void>((r) => { release = r; });
  const file = backupFile(doc(A, [plan({ id: id(4), name: "From A's backup" })]));
  Object.defineProperty(file, "text", { value: async () => { await read; return JSON.stringify(doc(A, [plan({ id: id(4), name: "From A's backup" })])); } });
  await choose(file);
  who = { id: B_ID, name: "Jaina#5678" };
  await comeBack();
  await act(async () => release());
  await settle();
  expect(button(/^Restore$/)).toBeUndefined();
  expect(text()).not.toContain("From A's backup");
  expect(stored(A)?.plans.map((p) => p.name)).toEqual(["A's plan"]);
  expect(stored(B)).toBeNull();
});

test("a pasted talent link is saved by name with both sets and both orders, and listed", async () => {
  await render();
  await type(field("Talent link or share code"), `https://everloot.app/tools/talents/mage#plan=${MAGE}&plan2=${MAGE_SMALL}&order=${PLANNED}&order2=O1g-A`);
  await click(button(/^Read the link$/));
  await type(field("Name"), "Frost pvp");
  await click(button(/^Save plan$/));
  expect(stored(ANON)?.plans).toEqual([expect.objectContaining({ name: "Frost pvp", classSlug: "mage", code: MAGE, code2: MAGE_SMALL, order: PLANNED, order2: "O1g-A", boundTo: null })]);
  expect(item("Frost pvp")?.textContent).toContain("Set 1: planned order");
  expect(item("Frost pvp")?.textContent).toContain("Set 2: provisional order");
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Saved "Frost pvp" on this device.');
  expect(requests).toEqual(["GET /api/auth/me"]);
});

test("spend orders show as saved, and the page says they are checked against the tree only when a plan opens", async () => {
  const unchecked = "Spend orders show as they were saved. The calculator checks them against the talent tree only when a plan opens.";
  seed(ANON, [plan()]);
  await render();
  expect(item("Frost")?.textContent).toContain("Set 1: planned order");
  expect(container.querySelector("#device-plans")?.parentElement?.parentElement?.textContent).toContain(unchecked);
  await type(field("Talent link or share code"), `https://everloot.app/tools/talents/mage#plan=${MAGE}&order=${PLANNED}`);
  await click(button(/^Read the link$/));
  expect(container.querySelector('form[aria-label="Name the plan"]')?.textContent).toContain(unchecked);
});

test("the page is left out of search, as /me is", async () => {
  const { metadata } = await import("@/app/tools/builds/page");
  expect(metadata.robots).toEqual({ index: false, follow: false });
});

test("pasted text that is not a plan, or a plan of two classes, says why and saves nothing", async () => {
  await render();
  await type(field("Talent link or share code"), "https://everloot.app/b/AbCd1234");
  await click(button(/^Read the link$/));
  expect(alerts()).toContain("not a talent link or a share code");
  await type(field("Talent link or share code"), `https://everloot.app/tools/talents/mage#plan=${MAGE}&plan2=${DRUID}`);
  await click(button(/^Read the link$/));
  expect(alerts()).toContain("Both talent sets must be for the same class.");
  expect(button(/^Save plan$/)).toBeUndefined();
  expect(stored(ANON)).toBeNull();
});

test("Open carries both sets and both orders to the calculator in the fragment, and Copy link copies that address", async () => {
  seed(ANON, [plan({ code2: MAGE_SMALL, order2: "O1g-A" })]);
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await render();
  const open = item("Frost")?.querySelector<HTMLAnchorElement>("a");
  const address = `/tools/talents/mage#plan=${MAGE}&plan2=${MAGE_SMALL}&order=${PLANNED}&order2=O1g-A`;
  expect(open?.getAttribute("href")).toBe(address);
  // CopyButton holds its labels side by side ("Copy link", then "Copied"), one shown at a time.
  await click(button(/^Copy link/, item("Frost")!));
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${address}`);
});

test("Edit renames a plan and changes its notes; Make a copy adds a second; Delete asks once more and removes only that one", async () => {
  seed(ANON, [plan()]);
  await render();
  await click(button(/^Edit$/, item("Frost")!));
  await type(field("Name", item("Frost")!), "Frost raid");
  await type(field("Notes", item("Frost")!), "Raid notes");
  await click(button(/^Save$/, item("Frost")!));
  expect(stored(ANON)?.plans).toEqual([expect.objectContaining({ id: id(1), name: "Frost raid", notes: "Raid notes", code: MAGE, order: PLANNED })]);
  expect(text()).toContain("Raid notes");
  await click(button(/^Make a copy$/, item("Frost raid")!));
  expect(stored(ANON)?.plans.map((p) => p.name)).toEqual(["Frost raid", "Frost raid (copy)"]);
  await click(button(/^Delete$/, item("Frost raid (copy)")!));
  expect(stored(ANON)?.plans).toHaveLength(2);
  await click(button(/^Delete for good$/, item("Frost raid (copy)")!));
  expect(stored(ANON)?.plans.map((p) => p.name)).toEqual(["Frost raid"]);
  expect(item("Frost raid (copy)")).toBeUndefined();
});

test("Download backup hands over only the active bucket, binding and all", async () => {
  const bound = plan({ id: id(2), name: "A's plan", boundTo: { userId: A_ID, at: "2026-10-21T00:00:00.000Z" } });
  seed(ANON, [plan({ name: "Signed out plan" })]);
  seed(A, [bound]);
  who = { id: A_ID, name: "Thrall#1234" };
  await render();
  const d = watchDownload();
  await click(button(/^Download backup$/));
  expect(d.names).toEqual([expect.stringMatching(/^everloot-plans-\d{4}-\d{2}-\d{2}\.json$/)]);
  const backup = JSON.parse(await d.blobs[0].text()) as PlayerWorkspace;
  expect(backup.owner).toEqual(A);
  expect(backup.plans).toEqual([bound]);
  expect(await d.blobs[0].text()).not.toContain("Signed out plan");
});

test("a restore shows what it would do and changes nothing until Restore is pressed", async () => {
  seed(ANON, [plan({ name: "Here" })]);
  await render();
  await choose(backupFile(doc(ANON, [
    plan({ name: "Here" }),
    plan({ id: id(2), name: "From the backup" }),
    plan({ id: id(3), name: "Future", order: "O2p-AABCC" }),
  ])));
  expect(text()).toContain("adds 2 plans");
  expect(text()).toContain("Future: set 1's spend order was made by a newer version of Everloot, so it opens as unknown.");
  expect(stored(ANON)?.plans.map((p) => p.name)).toEqual(["Here"]);
  await click(button(/^Restore$/));
  expect(stored(ANON)?.plans.map((p) => p.name)).toEqual(["Here", "From the backup", "Future"]);
  expect(stored(ANON)?.plans[2].order).toBe("O2p-AABCC");
  expect(item("Future")?.textContent).toContain("Set 1: order from a newer version");
});

test("a backup from another account is refused at the preview, and nothing changes", async () => {
  seed(B, [plan({ id: id(3), name: "B's plan" })]);
  who = { id: B_ID, name: "Jaina#5678" };
  await render();
  await choose(backupFile(doc(A, [plan({ id: id(4), name: "From A's backup", boundTo: { userId: A_ID, at: "2026-10-21T00:00:00.000Z" } })])));
  expect(alerts()).toContain("That backup belongs to a different account.");
  expect(button(/^Restore$/)).toBeUndefined();
  expect(stored(B)?.plans.map((p) => p.name)).toEqual(["B's plan"]);
});

test("when the browser refuses storage, it says plans cannot be kept here and offers no saving", async () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Access is denied.", "SecurityError"); });
  await render();
  expect(alerts()).toContain("not letting Everloot keep anything on this device");
  expect(field("Talent link or share code")).toBeNull();
  expect(button(/^Download backup$/)).toBeUndefined();
});

test("a full storage refuses the change with an alert and keeps the device as it was", async () => {
  seed(ANON, [plan()]);
  await render();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); });
  await click(button(/^Make a copy$/, item("Frost")!));
  expect(alerts()).toContain("storage is full, so nothing was saved");
  expect(stored(ANON)?.plans.map((p) => p.name)).toEqual(["Frost"]);
  expect(item("Frost (copy)")).toBeUndefined();
});

test("damaged stored plans are kept: their text can be downloaded, nothing is saved over them, and clearing asks first", async () => {
  localStorage.setItem(bucketKey(ANON), "{not json");
  await render();
  expect(alerts()).toContain("could not be read");
  expect(field("Talent link or share code")).toBeNull();
  const d = watchDownload();
  await click(button(/^Download what is stored$/));
  expect(await d.blobs[0].text()).toBe("{not json");
  await click(button(/^Clear stored plans$/));
  expect(localStorage.getItem(bucketKey(ANON))).toBe("{not json");
  await click(button(/^Clear for good$/));
  expect(localStorage.getItem(bucketKey(ANON))).toBeNull();
  expect(field("Talent link or share code")).not.toBeNull();
});

test("plans saved by a newer version are left alone, and the page says to reload", async () => {
  const newer = JSON.stringify({ format: "everloot.player-workspace", version: 2, owner: ANON });
  localStorage.setItem(bucketKey(ANON), newer);
  await render();
  expect(alerts()).toContain("saved by a newer version of Everloot. Reload the page");
  expect(button(/^Clear stored plans$/)).toBeUndefined();
  expect(localStorage.getItem(bucketKey(ANON))).toBe(newer);
});

test("when the account cannot be checked, no plans show until Try again finds out", async () => {
  seed(ANON, [plan()]);
  meFails = 1;
  await render();
  expect(alerts()).toContain("could not be checked");
  expect(item("Frost")).toBeUndefined();
  await click(button(/^Try again$/));
  expect(item("Frost")).toBeDefined();
});

// The calculator's widget. The calculator passes its codes and orders in; the address bar is never read.

const onMessage = vi.fn();
const widget = (codes: [string | null, string | null], orders: [string | null, string | null] = [null, null]) =>
  <LocalPlanSave classSlug="mage" codes={codes} orders={orders} defaultName="Frost Mage 3/2/0" onMessage={onMessage} />;
const panel = () => container.querySelector<HTMLFormElement>('form[aria-label="Save on this device"]');

test("LocalPlanSave saves the codes and orders it is given, not the address bar's", async () => {
  onMessage.mockClear();
  window.history.replaceState(null, "", `/tools/talents/mage#plan=${MAGE_SMALL}&order=O1p-A`);
  await render(widget([MAGE, null], [PLANNED, null]));
  await click(button(/^Save on this device$/));
  expect(field("Name", panel()!)?.value).toBe("Frost Mage 3/2/0");
  await click(button(/^Save plan$/, panel()!));
  expect(stored(ANON)?.plans).toEqual([expect.objectContaining({ name: "Frost Mage 3/2/0", code: MAGE, code2: null, order: PLANNED, order2: null })]);
  expect(onMessage).toHaveBeenLastCalledWith('Saved "Frost Mage 3/2/0" on this device.');
  expect(panel()).toBeNull();
});

test("LocalPlanSave needs a point in set 1, and says which set's spend order is unknown", async () => {
  onMessage.mockClear();
  await render(widget([null, null]));
  expect(button(/^Save on this device$/)?.disabled).toBe(true);
  await render(widget([MAGE, MAGE_SMALL], [null, "O1p-A"]));
  await click(button(/^Save on this device$/));
  await click(button(/^Save plan$/, panel()!));
  expect(onMessage).toHaveBeenLastCalledWith('Saved "Frost Mage 3/2/0" on this device. Set 1\'s spend order is unknown.');
  expect(stored(ANON)?.plans[0]).toMatchObject({ order: null, order2: "O1p-A" });
});

test("LocalPlanSave replaces the plan it saved last, and A new plan saves another", async () => {
  onMessage.mockClear();
  await render(widget([MAGE_SMALL, null], ["O1p-A", null]));
  await click(button(/^Save on this device$/));
  await click(button(/^Save plan$/, panel()!));
  const first = stored(ANON)!.plans[0];
  await render(widget([MAGE, null], [PLANNED, null]));
  await click(button(/^Save on this device$/));
  expect(field("Save as", panel()!)?.value).toBe(first.id);
  await click(button(/^Replace plan$/, panel()!));
  expect(stored(ANON)?.plans).toEqual([expect.objectContaining({ id: first.id, code: MAGE, order: PLANNED })]);
  expect(onMessage).toHaveBeenLastCalledWith('Updated "Frost Mage 3/2/0" on this device.');
  await click(button(/^Save on this device$/));
  await type(field("Save as", panel()!), "");
  await type(field("Name", panel()!), "Second");
  await click(button(/^Save plan$/, panel()!));
  expect(stored(ANON)?.plans.map((p) => p.name)).toEqual(["Frost Mage 3/2/0", "Second"]);
});

test("LocalPlanSave: an account switch while the panel is open closes it and saves nothing", async () => {
  onMessage.mockClear();
  who = { id: A_ID, name: "Thrall#1234" };
  await render(widget([MAGE, null], [PLANNED, null]));
  await click(button(/^Save on this device$/));
  expect(panel()).not.toBeNull();
  who = { id: B_ID, name: "Jaina#5678" };
  await comeBack();
  expect(panel()).toBeNull();
  expect(onMessage).toHaveBeenLastCalledWith(expect.stringContaining("signed in to a different account now, so nothing was saved"));
  expect(stored(A)).toBeNull();
  expect(stored(B)).toBeNull();
  await click(button(/^Save on this device$/));
  await click(button(/^Save plan$/, panel()!));
  expect(stored(B)?.plans).toHaveLength(1);
  expect(stored(A)).toBeNull();
});

test("LocalPlanSave: a full storage keeps the panel and its text, says so, and never says saved", async () => {
  onMessage.mockClear();
  await render(widget([MAGE, null], [PLANNED, null]));
  await click(button(/^Save on this device$/));
  await type(field("Notes", panel()!), "Keep this");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); });
  await click(button(/^Save plan$/, panel()!));
  expect(panel()?.querySelector('[role="alert"]')?.textContent).toContain("storage is full, so nothing was saved");
  expect(field("Notes", panel()!)?.value).toBe("Keep this");
  expect(onMessage).not.toHaveBeenCalledWith(expect.stringContaining("Saved"));
  expect(stored(ANON)).toBeNull();
});
