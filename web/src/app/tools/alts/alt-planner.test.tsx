// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AccountControls from "@/components/AccountControls";
import { scrubEvent } from "@/lib/analytics/load";
import { isProtectedPath } from "@/lib/document-boundary";
import { bucketKey, type LocalAlt, type LocalPlan, type Owner, type PlayerWorkspace } from "@/lib/player-workspace";
import AltPlanner from "./AltPlanner";

// /tools/alts as a player meets it: this browser's localStorage, the player's own Everloot.lua read in the page, and
// /api/auth/me as the only thing the page asks the network.

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", async (actual) => ({ ...(await actual<object>()), useRouter: () => ({ refresh }) }));

const MAGE = "EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg";
const A_ID = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const B_ID = "7c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e";
const ANON: Owner = { kind: "anonymous" };
const A: Owner = { kind: "account", userId: A_ID };
const B: Owner = { kind: "account", userId: B_ID };
const id = (n: number) => `1a2b3c4d-0000-4000-8000-${String(n).padStart(12, "0")}`;

// The player's own gold and link rows, and a sighting of another player that never names an alt.
const SV = `EverlootDB = {
["version"] = "0.3.12",
["installId"] = "install-fixture-0003",
["records"] = {
["gold_snapshot"] = {
{ ["installId"] = "install-fixture-0003", ["eventId"] = "epoch-3:1", ["capturedAt"] = "2026-10-23T10:00:00Z", ["character"] = "Thrall", ["realm"] = "Moon Guard", ["currentCopper"] = 125000, ["peakCopper"] = 125000 },
{ ["installId"] = "install-fixture-0003", ["eventId"] = "epoch-3:2", ["capturedAt"] = "2026-10-24T08:00:00Z", ["character"] = "Jaina", ["realm"] = "Moon Guard", ["currentCopper"] = 2000000, ["peakCopper"] = 2500000 },
},
["character_link"] = {
{ ["installId"] = "install-fixture-0003", ["eventId"] = "character_link:1", ["capturedAt"] = "2026-10-21T18:00:00Z", ["code"] = "EL-7K3Q-9P", ["name"] = "Thrall", ["realm"] = "Moon Guard", ["race"] = "Orc", ["class"] = "SHAMAN", ["level"] = 24, ["faction"] = "Horde", ["guid"] = "Player-4395-0A1B2C3D", ["completionKey"] = "0a1b2c3d" },
},
["player_seen"] = {
{ ["installId"] = "install-fixture-0003", ["eventId"] = "player_seen:1", ["capturedAt"] = "2026-10-25T00:00:00Z", ["name"] = "Arthas", ["realm"] = "Nightslayer", ["race"] = "Human", ["class"] = "PALADIN", ["level"] = 60 },
},
},
}
`;

let container: HTMLDivElement;
let root: Root;
/** Who /api/auth/me says is signed in, and how many of its next answers fail. */
let who: { id: string; name: string } | null;
let meFails: number;
let requests: string[];
/** While set, the next answer waits for it. */
let gate: Promise<void> | null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/tools/alts");
  localStorage.clear();
  who = null;
  meFails = 0;
  requests = [];
  gate = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${String(input)}${init?.body ? ` ${String(init.body)}` : ""}`);
    if (String(input) === "/api/auth/logout" && init?.method === "POST") { who = null; return Response.json({ ok: true, next: false }); }
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
  id: id(1), name: "Frost", classSlug: "mage", code: MAGE, code2: null, order: null, order2: null,
  notes: "", updatedAt: "2026-10-20T12:00:00.000Z", boundTo: null, ...over,
});
const alt = (over: Partial<LocalAlt> = {}): LocalAlt => ({
  id: id(500), name: "Thrall", realm: "Moon Guard", classSlug: "shaman", faction: "horde", level: 24, professions: [], notes: "",
  planIds: [], provenance: { source: "manual", fileRecordAt: null, fileDetails: [] }, updatedAt: "2026-10-20T12:00:00.000Z", ...over,
});
const doc = (owner: Owner, plans: LocalPlan[], alts: LocalAlt[]): PlayerWorkspace =>
  ({ format: "everloot.player-workspace", version: 2, owner, plans, alts, watches: [] });
const seed = (owner: Owner, plans: LocalPlan[], alts: LocalAlt[]) => localStorage.setItem(bucketKey(owner), JSON.stringify(doc(owner, plans, alts)));
const stored = (owner: Owner) => JSON.parse(localStorage.getItem(bucketKey(owner)) ?? "null") as PlayerWorkspace | null;

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function render(ui: ReactElement = <AltPlanner />) {
  await act(async () => root.render(ui));
  await settle();
}
const text = () => container.textContent ?? "";
const button = (label: RegExp, scope: ParentNode = container) => [...scope.querySelectorAll("button")].find((b) => label.test(b.textContent?.trim() ?? ""));
async function click(el: Element | undefined | null) {
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
  [...scope.querySelectorAll("label")].find((l) => l.textContent?.trim().startsWith(label))?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select") ?? null;
/** The listed alt with this name. */
const item = (name: string) => [...container.querySelectorAll("li")].find((li) => li.querySelector("h3")?.textContent === name);
const alerts = () => [...container.querySelectorAll('[role="alert"]')].map((a) => a.textContent).join(" ");
const statusText = () => [...container.querySelectorAll('[role="status"]')].map((s) => s.textContent).join(" ");
const comeBack = async () => { await act(async () => { window.dispatchEvent(new Event("focus")); }); await settle(); };
const addForm = () => container.querySelector<HTMLFormElement>('form[aria-label="Add an alt"]');
const filePreview = () => container.querySelector<HTMLElement>('[aria-label="What reading the file would do"]');

async function chooseFile(label: string, file: File) {
  const input = container.querySelector<HTMLInputElement>(`input[type="file"][aria-label="${label}"]`);
  if (!input) throw new Error(`No file input ${label}`);
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
}
const readSaveFile = (text = SV) => chooseFile("Choose Everloot.lua", new File([text], "Everloot.lua", { type: "text/plain" }));

/** Watches the download: the file's blob and its name. */
function watchDownload() {
  const blobs: Blob[] = [];
  const names: string[] = [];
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b: Blob) => { blobs.push(b); return "blob:everloot/1"; }, revokeObjectURL: () => {} }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
  return { blobs, names };
}

test("with no file at all, an alt is added by hand with its details and plans, and the page asks the network only who is signed in", async () => {
  seed(ANON, [plan({ name: "Frost" })], []);
  await render();
  const form = addForm()!;
  await type(field("Name", form), "Jaina");
  await type(field("Realm", form), "Moon Guard");
  await type(field("Class", form), "mage");
  await type(field("Faction", form), "alliance");
  await type(field("Level", form), "60");
  await click(field("Enchanting", form));
  await click(field("Frost", form));
  await type(field("Notes", form), "Raid main");
  await click(button(/^Add alt$/, form));
  expect(stored(ANON)?.alts).toEqual([expect.objectContaining({
    name: "Jaina", realm: "Moon Guard", classSlug: "mage", faction: "alliance", level: 60, professions: ["Enchanting"], notes: "Raid main", planIds: [id(1)],
    provenance: { source: "manual", fileRecordAt: null, fileDetails: [] },
  })]);
  const jaina = item("Jaina")!;
  for (const shown of ["Moon Guard", "Mage", "Level 60", "Alliance", "Enchanting", "Raid main", "Frost", "Added by hand"]) expect(jaina.textContent, shown).toContain(shown);
  expect(jaina.querySelector<HTMLAnchorElement>('a[href^="/tools/talents/mage#plan="]')?.textContent).toBe("Frost");
  expect(statusText()).toContain('Added "Jaina" to this device.');
  expect(field("Name", addForm()!)?.value).toBe("");
  expect(requests).toEqual(["GET /api/auth/me"]);
});

test("opening an alt's saved plan never leaves its code in an analytics pageview (reported case)", async () => {
  const p = plan();
  seed(ANON, [p], [alt({ planIds: [p.id] })]);
  await render();
  const a = container.querySelector<HTMLAnchorElement>('a[href^="/tools/talents/mage#plan="]')!;
  expect(a).toBeTruthy();
  const event = { properties: { $current_url: new URL(a.getAttribute("href")!, "https://everloot.app").href } };
  const sent = scrubEvent(event, "https://everloot.app");
  expect(sent.properties.$current_url).not.toContain(p.code);
});

test("a detail outside its rules is refused in the form with its reason, and nothing is stored", async () => {
  await render();
  const form = addForm()!;
  await type(field("Name", form), "Jaina");
  await type(field("Level", form), "61");
  await click(button(/^Add alt$/, form));
  expect(alerts()).toContain("A level is a whole number from 1 to 60");
  expect(field("Name", form)?.value).toBe("Jaina");
  expect(stored(ANON)).toBeNull();
});

test("Edit changes an alt's details in place and keeps the rest", async () => {
  seed(ANON, [plan()], [alt({ notes: "Bank alt", planIds: [id(1)] })]);
  await render();
  await click(button(/^Edit$/, item("Thrall")!));
  const form = container.querySelector<HTMLFormElement>('form[aria-label="Edit Thrall"]')!;
  expect(field("Level", form)?.value).toBe("24");
  await type(field("Level", form), "31");
  await click(button(/^Save$/, form));
  expect(stored(ANON)?.alts).toEqual([expect.objectContaining({ id: id(500), level: 31, notes: "Bank alt", planIds: [id(1)] })]);
  expect(item("Thrall")?.textContent).toContain("Level 31");
});

/** Another tab's change to the stored alts, and the storage event this tab hears for it. */
async function changeInAnotherTab(change: (doc: PlayerWorkspace) => void) {
  const doc = stored(ANON)!;
  change(doc);
  const text = JSON.stringify(doc);
  localStorage.setItem(bucketKey(ANON), text);
  await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: bucketKey(ANON), newValue: text, storageArea: localStorage })); });
  await settle();
}

test("an edit left open while another tab changes the alt's notes does not write the old notes back (reported case)", async () => {
  seed(ANON, [], [alt({ notes: "original notes" })]);
  await render();
  await click(button(/^Edit$/, item("Thrall")!));
  const form = container.querySelector<HTMLFormElement>('form[aria-label="Edit Thrall"]')!;
  await type(form.querySelector<HTMLInputElement>('input[type="number"]'), "31");
  await changeInAnotherTab((doc) => { doc.alts[0].notes = "new notes saved in tab B"; doc.alts[0].updatedAt = "2026-10-27T12:00:00.000Z"; });
  expect(text()).toContain("new notes saved in tab B");
  await click(button(/^Save$/, form));
  expect(stored(ANON)?.alts[0].notes).toBe("new notes saved in tab B");
});

test("that save is refused with what changed; the form keeps the player's change and takes the other, and saving again keeps both", async () => {
  seed(ANON, [], [alt({ notes: "original notes" })]);
  await render();
  await click(button(/^Edit$/, item("Thrall")!));
  const form = container.querySelector<HTMLFormElement>('form[aria-label="Edit Thrall"]')!;
  await type(field("Level", form), "31");
  await changeInAnotherTab((doc) => { doc.alts[0].notes = "new notes saved in tab B"; doc.alts[0].updatedAt = "2026-10-27T12:00:00.000Z"; });
  await click(button(/^Save$/, form));
  expect(stored(ANON)?.alts[0]).toMatchObject({ level: 24, notes: "new notes saved in tab B" });
  expect(form.querySelector('[role="alert"]')?.textContent).toContain("changed somewhere else while you were editing it");
  expect(form.querySelector('[role="alert"]')?.textContent).toContain("Notes: now “new notes saved in tab B”");
  expect(field("Level", form)?.value).toBe("31");
  expect(field("Notes", form)?.value).toBe("new notes saved in tab B");
  await click(button(/^Save$/, form));
  expect(stored(ANON)?.alts[0]).toMatchObject({ level: 31, notes: "new notes saved in tab B" });
});

test("when both tabs changed the same detail, the player's value stays in the form and the other one is named", async () => {
  seed(ANON, [], [alt({ level: 24 })]);
  await render();
  await click(button(/^Edit$/, item("Thrall")!));
  const form = container.querySelector<HTMLFormElement>('form[aria-label="Edit Thrall"]')!;
  await type(field("Level", form), "31");
  await changeInAnotherTab((doc) => { doc.alts[0].level = 30; });
  await click(button(/^Save$/, form));
  expect(stored(ANON)?.alts[0].level).toBe(30);
  expect(form.querySelector('[role="alert"]')?.textContent).toContain("Level: you set 31 here; it is now 30");
  expect(field("Level", form)?.value).toBe("31");
  await click(button(/^Save$/, form));
  expect(stored(ANON)?.alts[0].level).toBe(31);
});

test("Delete asks first and offers a backup holding the alt; Delete for good removes only that alt, and its plans stay", async () => {
  seed(ANON, [plan()], [alt({ planIds: [id(1)] }), alt({ id: id(501), name: "Jaina", classSlug: "mage" })]);
  await render();
  await click(button(/^Delete$/, item("Thrall")!));
  expect(stored(ANON)?.alts).toHaveLength(2);
  expect(item("Thrall")?.textContent).toContain("Delete Thrall from this device for good?");
  const d = watchDownload();
  await click(button(/^Download a backup first$/, item("Thrall")!));
  const backup = JSON.parse(await d.blobs[0].text()) as PlayerWorkspace;
  expect(backup.alts.map((a) => a.name)).toEqual(["Thrall", "Jaina"]);
  expect(d.names).toEqual([expect.stringMatching(/^everloot-plans-\d{4}-\d{2}-\d{2}\.json$/)]);
  await click(button(/^Delete for good$/, item("Thrall")!));
  expect(stored(ANON)?.alts.map((a) => a.name)).toEqual(["Jaina"]);
  expect(stored(ANON)?.plans).toEqual([plan()]);
  expect(item("Thrall")).toBeUndefined();
  expect(statusText()).toContain('Deleted "Thrall" from this device.');
});

test("reading an Everloot.lua shows what it would add and changes nothing until asked; the same file again adds nothing", async () => {
  await render();
  await readSaveFile();
  const preview = filePreview()!;
  expect(preview.textContent).toContain("Thrall (Moon Guard)");
  expect(preview.textContent).toContain("Shaman · Level 24 · Horde");
  expect(preview.textContent).toContain("Jaina (Moon Guard)");
  expect(preview.textContent).not.toContain("Arthas");
  expect(stored(ANON)).toBeNull();
  await click(button(/^Add to this device$/, preview));
  expect(stored(ANON)?.alts.map((a) => [a.name, a.realm, a.classSlug, a.level, a.provenance.source])).toEqual([
    ["Jaina", "Moon Guard", null, null, "addon-file"],
    ["Thrall", "Moon Guard", "shaman", 24, "addon-file"],
  ]);
  expect(statusText()).toContain("Added 2 alts from your Everloot.lua.");
  expect(item("Thrall")?.textContent).toContain("Added from your Everloot.lua");
  const once = localStorage.getItem(bucketKey(ANON));
  await readSaveFile();
  expect(filePreview()?.textContent).toContain("Nothing to add: every character in this file is already here.");
  expect(button(/^Add to this device$/)).toBeUndefined();
  expect(localStorage.getItem(bucketKey(ANON))).toBe(once);
});

test("an alt with no realm set and a file character of its name: the preview asks which it is, and skips it until told", async () => {
  seed(ANON, [], [alt({ realm: null, classSlug: null, faction: null, level: null, notes: "Typed by hand" })]);
  await render();
  await readSaveFile();
  const choice = field("Thrall (Moon Guard)", filePreview()!) as HTMLSelectElement;
  expect([...choice.options].map((o) => o.textContent)).toEqual(["Skip it", "Add it as a new alt", "It is your alt Thrall (realm not set)"]);
  expect(choice.value).toBe("skip");
  expect(filePreview()?.textContent).toContain("may be your alt Thrall, whose realm is not set");
  await click(button(/^Add to this device$/, filePreview()!));
  expect(stored(ANON)?.alts.map((a) => [a.name, a.realm, a.notes])).toEqual([["Thrall", null, "Typed by hand"], ["Jaina", "Moon Guard", ""]]);
  await readSaveFile();
  await type(field("Thrall (Moon Guard)", filePreview()!), `alt:${id(500)}`);
  await click(button(/^Update on this device$/, filePreview()!));
  expect(stored(ANON)?.alts[0]).toMatchObject({ id: id(500), realm: "Moon Guard", classSlug: "shaman", level: 24, faction: "horde", notes: "Typed by hand" });
});

test("a file character that is here as two alts says so, offers each copy told apart, and changes neither realm", async () => {
  seed(ANON, [], [alt({ updatedAt: "2026-10-20T12:00:00.000Z" }), alt({ id: id(501), level: 30, updatedAt: "2026-10-22T12:00:00.000Z" })]);
  await render();
  await readSaveFile();
  expect(filePreview()?.textContent).toContain("Thrall (Moon Guard) is here as more than one alt");
  expect(filePreview()?.textContent).not.toContain("realm is not set");
  const choice = field("Thrall (Moon Guard)", filePreview()!) as HTMLSelectElement;
  expect([...choice.options].map((o) => o.textContent)).toEqual([
    "Skip it",
    "It is your alt Thrall (Moon Guard): Shaman · Level 24 · Horde, updated Oct 20, 2026",
    "It is your alt Thrall (Moon Guard): Shaman · Level 30 · Horde, updated Oct 22, 2026",
  ]);
  expect(choice.value).toBe("skip");
});

test("choosing which copy a file character is shows what that copy would get before anything is written, and an older file gives nothing", async () => {
  const fromFile = { source: "addon-file" as const, fileRecordAt: "2026-10-27T12:00:00.000Z", fileDetails: ["classSlug" as const, "level" as const, "faction" as const] };
  seed(ANON, [], [alt({ level: 60, provenance: fromFile }), alt({ id: id(501), provenance: { ...fromFile, fileRecordAt: "2026-10-20T00:00:00.000Z" } })]);
  await render();
  await readSaveFile(`EverlootDB = { ["version"] = "0.3.12", ["installId"] = "install-fixture-0003", ["records"] = { ["character_link"] = {
    { ["capturedAt"] = "2026-10-25T00:00:00Z", ["name"] = "Thrall", ["realm"] = "Moon Guard", ["class"] = "SHAMAN", ["level"] = 31, ["faction"] = "Horde" } } } }`);
  const before = localStorage.getItem(bucketKey(ANON));
  await type(field("Thrall (Moon Guard)", filePreview()!), `alt:${id(500)}`);
  expect(filePreview()?.textContent).toContain("Its details already come from an Everloot.lua at least as new as this one, so this file changes none of them.");
  expect(button(/^Update on this device$/, filePreview()!)).toBeUndefined();
  await type(field("Thrall (Moon Guard)", filePreview()!), `alt:${id(501)}`);
  expect(filePreview()?.textContent).toContain("Newer details from the file: level 24 → 31.");
  expect(localStorage.getItem(bucketKey(ANON))).toBe(before);
  await click(button(/^Update on this device$/, filePreview()!));
  expect(stored(ANON)?.alts.map((a) => a.level)).toEqual([60, 31]);
});

test("a file over 20 MiB is not read, and a damaged, cut-off or foreign file says so; nothing changes", async () => {
  seed(ANON, [], [alt()]);
  const before = localStorage.getItem(bucketKey(ANON));
  await render();
  const big = new File(["x"], "Everloot.lua");
  Object.defineProperty(big, "size", { value: 20 * 1024 * 1024 + 1 });
  const read = vi.fn(async () => "");
  Object.defineProperty(big, "text", { value: read });
  await chooseFile("Choose Everloot.lua", big);
  expect(alerts()).toContain("over 20 MiB");
  expect(read).not.toHaveBeenCalled();
  await readSaveFile(SV.slice(0, Math.floor(SV.length / 2)));
  expect(alerts()).toContain("cut off or damaged");
  await readSaveFile("PolestarRecorderDB = { }");
  expect(alerts()).toContain("not an Everloot.lua");
  expect(filePreview()).toBeNull();
  expect(localStorage.getItem(bucketKey(ANON))).toBe(before);
});

test("a file with none of the player's own records says so, and how many other records it did not use", async () => {
  await render();
  await readSaveFile(`EverlootDB = { ["version"] = "0.3.12", ["installId"] = "x", ["records"] = { ["player_seen"] = { { ["name"] = "Arthas", ["realm"] = "Nightslayer" } } } }`);
  expect(filePreview()?.textContent).toContain("This file has no gold, money or link records of your own characters");
  expect(filePreview()?.textContent).toContain("1 other record");
  expect(stored(ANON)).toBeNull();
});

test("nothing the planner holds goes into a request or an analytics event, and the page does not claim to use no network", async () => {
  const gtag = vi.fn();
  const capture = vi.fn();
  vi.stubGlobal("gtag", gtag);
  vi.stubGlobal("posthog", { capture });
  seed(ANON, [plan()], []);
  await render();
  await type(field("Name", addForm()!), "Jaina");
  await type(field("Notes", addForm()!), "Secret raid notes");
  await click(button(/^Add alt$/, addForm()!));
  await readSaveFile();
  await click(button(/^Add to this device$/, filePreview()!));
  watchDownload();
  await click(button(/^Download backup$/));
  await click(button(/^Delete$/, item("Thrall")!));
  await click(button(/^Delete for good$/, item("Thrall")!));
  expect(requests.every((r) => r === "GET /api/auth/me")).toBe(true);
  expect(gtag).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
  expect(text()).toContain("read in this browser and is not uploaded");
  expect(text()).not.toMatch(/no network|zero network|nothing is sent|no requests/i);
});

test("when the browser refuses storage, it says alts cannot be kept here and offers no adding, reading or restoring", async () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Access is denied.", "SecurityError"); });
  await render();
  expect(alerts()).toContain("alts cannot be saved here");
  expect(addForm()).toBeNull();
  expect(container.querySelector('input[type="file"]')).toBeNull();
});

test("a full storage refuses the alt with an alert, keeps what was typed and never says added", async () => {
  await render();
  await type(field("Name", addForm()!), "Jaina");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); });
  await click(button(/^Add alt$/, addForm()!));
  expect(alerts()).toContain("storage is full");
  expect(field("Name", addForm()!)?.value).toBe("Jaina");
  expect(statusText()).not.toContain("Added");
  expect(stored(ANON)).toBeNull();
});

test("damaged stored data is left as it is, with its text to download, and nothing is saved over it", async () => {
  localStorage.setItem(bucketKey(ANON), "{not json");
  await render();
  expect(alerts()).toContain("could not be read");
  expect(addForm()).toBeNull();
  const d = watchDownload();
  await click(button(/^Download what is stored$/));
  expect(await d.blobs[0].text()).toBe("{not json");
  expect(localStorage.getItem(bucketKey(ANON))).toBe("{not json");
});

test("a version 1 bucket's plans and alts show; it stays version 1 until an alt gets a version 2 detail, and keeps everything", async () => {
  localStorage.setItem(bucketKey(ANON), JSON.stringify({ format: "everloot.player-workspace", version: 1, owner: ANON, plans: [plan()],
    alts: [{ id: id(500), name: "Old alt", planIds: [id(1)], notes: "From before", updatedAt: "2026-10-20T12:00:00.000Z" }], watches: [] }));
  await render();
  expect(item("Old alt")?.textContent).toContain("Realm not set");
  expect(item("Old alt")?.textContent).toContain("From before");
  await type(field("Name", addForm()!), "Jaina");
  await click(button(/^Add alt$/, addForm()!));
  expect(stored(ANON)).toMatchObject({ version: 1, plans: [plan()] });
  expect(stored(ANON)?.alts.map((a) => [a.name, a.notes, a.planIds])).toEqual([["Old alt", "From before", [id(1)]], ["Jaina", "", []]]);
  await type(field("Name", addForm()!), "Thrall");
  await type(field("Realm", addForm()!), "Moon Guard");
  await click(button(/^Add alt$/, addForm()!));
  expect(stored(ANON)).toMatchObject({ version: 2, plans: [plan()] });
  expect(stored(ANON)?.alts.map((a) => [a.name, a.realm, a.notes])).toEqual([["Old alt", null, "From before"], ["Jaina", null, ""], ["Thrall", "Moon Guard", ""]]);
});

test("a version 1 bucket too full for the newer format says so up front, and why, before anything is added", async () => {
  const letters = (n: number) => "\u{1D538}".repeat(n);
  const size = (s: string) => new TextEncoder().encode(s).length;
  const alts = Array.from({ length: 60 }, (_, i) => ({ id: id(500 + i), name: letters(60), planIds: [], notes: letters(1000), updatedAt: "2026-10-20T12:00:00.000Z" }));
  const plans: LocalPlan[] = [];
  const doc = () => JSON.stringify({ format: "everloot.player-workspace", version: 1, owner: ANON, plans, alts, watches: [] });
  for (let i = 0; ; i++) {
    plans.push(plan({ id: id(i + 1), name: `Plan ${i}`, notes: letters(1000) }));
    if (size(doc()) > 1024 * 1024) { plans.pop(); break; }
  }
  localStorage.setItem(bucketKey(ANON), doc());
  await render();
  const notice = [...container.querySelectorAll('[role="note"]')].map((n) => n.textContent).join(" ");
  expect(notice).toContain("saved in an older format");
  expect(notice).toContain("more than the 1 MiB this device keeps");
  expect(notice).toContain("Download a backup");
});

test("signed in, the page shows only that account's alts; another account or a sign-out shows that owner's instead", async () => {
  seed(ANON, [], [alt({ name: "Signed out alt" })]);
  seed(A, [], [alt({ id: id(501), name: "A's alt", notes: "A's notes" })]);
  seed(B, [], [alt({ id: id(502), name: "B's alt" })]);
  who = { id: A_ID, name: "Thrall#1234" };
  await render(<><AccountControls /><AltPlanner /></>);
  expect(item("A's alt")).toBeDefined();
  expect(text()).not.toContain("Signed out alt");
  who = { id: B_ID, name: "Jaina#5678" };
  await comeBack();
  expect(item("B's alt")).toBeDefined();
  expect(text()).not.toContain("A's alt");
  who = { id: A_ID, name: "Thrall#1234" };
  await comeBack();
  let release = () => {};
  gate = new Promise<void>((r) => { release = r; });
  await click(button(/^Sign out$/));
  expect(text()).toContain("Checking who is signed in");
  expect(text()).not.toContain("A's notes");
  await act(async () => release());
  await settle();
  expect(item("Signed out alt")).toBeDefined();
  expect(text()).not.toContain("A's alt");
});

test("an account switch while a file's preview is open drops it: nothing is added under either account", async () => {
  who = { id: A_ID, name: "Thrall#1234" };
  await render();
  await readSaveFile();
  expect(filePreview()).not.toBeNull();
  who = { id: B_ID, name: "Jaina#5678" };
  await comeBack();
  expect(filePreview()).toBeNull();
  expect(button(/^Add to this device$/)).toBeUndefined();
  expect(stored(A)).toBeNull();
  expect(stored(B)).toBeNull();
});

test("a file still being read when the account changes is not previewed for the next one", async () => {
  who = { id: A_ID, name: "Thrall#1234" };
  await render();
  let release = () => {};
  const read = new Promise<void>((r) => { release = r; });
  const file = new File([SV], "Everloot.lua");
  Object.defineProperty(file, "text", { value: async () => { await read; return SV; } });
  await chooseFile("Choose Everloot.lua", file);
  who = { id: B_ID, name: "Jaina#5678" };
  await comeBack();
  await act(async () => release());
  await settle();
  expect(filePreview()).toBeNull();
  expect(stored(B)).toBeNull();
});

test("a backup restores every alt detail after a preview that names the alts", async () => {
  const original = [
    alt({ planIds: [id(1)], notes: "Bank alt", professions: ["Alchemy"], provenance: { source: "addon-file", fileRecordAt: "2026-10-21T18:00:00.000Z", fileDetails: ["classSlug", "level", "faction"] } }),
    alt({ id: id(501), name: "Jaina", realm: null, classSlug: "mage", faction: null, level: null }),
  ];
  seed(ANON, [plan()], original);
  await render();
  const d = watchDownload();
  await click(button(/^Download backup$/));
  const backup = await d.blobs[0].text();
  localStorage.clear();
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  await chooseFile("Choose a backup file", new File([backup], "everloot-plans-2026-10-26.json", { type: "application/json" }));
  const preview = container.querySelector('[aria-label="What the restore would do"]')!;
  expect(preview.textContent).toContain("Adds Thrall (Moon Guard).");
  expect(preview.textContent).toContain("Adds Jaina.");
  expect(stored(ANON)).toBeNull();
  await click(button(/^Restore$/, preview));
  expect(stored(ANON)?.alts).toEqual(original);
  expect(stored(ANON)?.plans).toEqual([plan()]);
});

test("the file reader says up front what today's addon files give, before a file is chosen", async () => {
  await render();
  const reader = container.querySelector("#alts-file")!.closest("section")!;
  const line = "Today's addon files give each character's name and realm, from its gold records. Class, level and faction come once the addon records them.";
  expect(reader.textContent).toContain(line);
  // Ahead of the picker.
  expect(reader.textContent!.indexOf(line)).toBeLessThan(reader.textContent!.indexOf("Choose Everloot.lua"));
});

test("each file picker shows the site's focus ring while the hidden input inside it has focus", async () => {
  await render();
  for (const label of ["Choose Everloot.lua", "Choose a backup file"]) {
    const control = container.querySelector(`input[type="file"][aria-label="${label}"]`)?.closest("label");
    expect(control?.className.split(" "), label).toEqual(expect.arrayContaining(["focus-within:outline", "focus-within:outline-2", "focus-within:outline-offset-2", "focus-within:outline-accent"]));
  }
});

test("the page is left out of search and is a protected page, so no ads or analytics load beside the alts", async () => {
  const { metadata } = await import("./page");
  expect(metadata.robots).toEqual({ index: false, follow: false });
  expect(isProtectedPath("/tools/alts")).toBe(true);
});
