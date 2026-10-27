// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ACCOUNT_CHANGED_EVENT } from "@/components/AccountControls";
import {
  bindTransferred, boundElsewhere, bucketKey, settleTransferred,
  type LocalAlt, type LocalPlan, type LocalWatch, type Owner, type PlayerWorkspace,
} from "@/lib/player-workspace";
import { ORDERS_UNAVAILABLE } from "@/lib/saved-builds";
import TransferPlans from "./TransferPlans";
import { V3_BUCKET_TEXT } from "@/lib/player-workspace.fixture";

// Saving the plans this browser keeps signed out to the account signed in now, as a player meets it: this browser's
// localStorage, and the site's /api/auth/me, /api/me/builds and /api/me/characters, answered for the session as it is
// when each request is made. Codes and tokens are the share-code doc's (docs/2026-10-17-talent-share-code.md): MAGE's
// five points index as A, B and C, so O1p-AABCC is a player's order for them.

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
const serverId = (n: number) => `5e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AT = "2026-10-21T09:00:00.000Z";
/** A transfer key as the site takes it. */
const KEY = expect.stringMatching(/^[A-Za-z0-9_-]{16,64}$/);

const plan = (over: Partial<LocalPlan> = {}): LocalPlan => ({
  id: id(1), name: "Frost", classSlug: "mage", code: MAGE, code2: null, order: PLANNED, order2: null,
  notes: "", updatedAt: "2026-10-20T12:00:00.000Z", boundTo: null, ...over,
});
const FROST = plan();
const FIRE = plan({ id: id(2), name: "Fire", code2: MAGE_SMALL, order: "O1g-AABCC", order2: "O1p-A", notes: "For raids" });
const BEAR = plan({ id: id(3), name: "Bear", classSlug: "druid", code: DRUID, order: null });
const alt = (over: Partial<LocalAlt> = {}): LocalAlt => ({
  id: id(500), name: "Jaina", realm: null, classSlug: "mage", faction: null, level: null, professions: [], notes: "",
  planIds: [], provenance: { source: "manual", fileRecordAt: null, fileDetails: [] }, updatedAt: "2026-10-20T12:00:00.000Z", ...over,
});
const doc = (owner: Owner, plans: LocalPlan[], alts: LocalAlt[] = [], watches: LocalWatch[] = []): PlayerWorkspace =>
  ({ format: "everloot.player-workspace", version: 2, owner, plans, alts, watches });
const seed = (owner: Owner, plans: LocalPlan[], alts: LocalAlt[] = [], watches: LocalWatch[] = []) =>
  localStorage.setItem(bucketKey(owner), JSON.stringify(doc(owner, plans, alts, watches)));
const stored = (owner: Owner) => JSON.parse(localStorage.getItem(bucketKey(owner)) ?? "null") as PlayerWorkspace | null;
const names = (owner: Owner) => (stored(owner)?.plans ?? []).map((p) => p.name);
const bound = (p: LocalPlan, userId = A_ID) => ({ ...p, boundTo: { userId, at: expect.any(String) } });
/** Everything this browser keeps, to show that nothing changed. */
const device = () => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));
/** The plan buckets alone: what a refusal must leave as it was, while the record of sends may note the attempt. */
const buckets = () => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("everloot:workspace:")).map((k) => [k, localStorage.getItem(k)]));
/** The record of sends, as stored. */
const journal = () => JSON.parse(localStorage.getItem("everloot:transfers") ?? "null") as { receipts: Array<Record<string, unknown>>; characters: Array<Record<string, unknown>> } | null;

/** Web Locks as a browser gives them: one holder at a time per name, in the order asked. */
function installLocks() {
  let queue: Promise<unknown> = Promise.resolve();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: (_: string, task: () => unknown) => {
    const next = queue.then(task);
    queue = next.catch(() => undefined);
    return next;
  } } });
}

// The site, as far as the transfer talks to it.

interface Character { id: string; name: string; classSlug: string; realm: string | null; note: string | null }
/** Who the session cookie belongs to now (null: signed out). */
let who: string | null;
/** Each account's characters and builds, as GET /api/me/builds lists them. */
let accounts: Record<string, { characters: Character[]; builds: object[] }>;
/** Every POST that reached the site: what it sent, the account it was sent as and the one it named. */
let posts: Array<{ url: string; body: Record<string, unknown>; as: string | null; owner: string | null }>;
/** Every request, as "GET /api/auth/me", with the account a request named, if any. */
let requests: Array<{ request: string; owner: string | null }>;
/** The database has no spend-order migration: a save that names an order is refused. */
let ordersMissing: boolean;
/** That refusal as a site from before its code was added gives it: the message alone. */
let ordersMessageOnly: boolean;
/** Each account's builds by the transfer key they were made with: a save naming that key again gets that build back. */
let keyed: Record<string, Record<string, Record<string, unknown>>>;
/** A build save the site refuses, by the build's name. */
let refuse: Record<string, Response>;
/** The site's answer to the next read of the account's builds, in place of the list. */
let readAnswer: Response | null;
/** Requests whose next answer waits until released. It is still the answer for when it was asked. */
let held: Map<string, Promise<void>>;
let made: number;

const expectedOwner = (init?: RequestInit) => new Headers(init?.headers).get("x-everloot-expected-owner");

function answer(url: string, init?: RequestInit): Response {
  const method = init?.method ?? "GET";
  if (url === "/api/auth/me") return Response.json({ user: who && { id: who, name: who === A_ID ? "Thrall#1234" : "Jaina#5678", entitlements: [] } });
  const body = method === "POST" ? JSON.parse(String(init!.body)) as Record<string, unknown> : {};
  if (method === "POST") posts.push({ url, body, as: who, owner: expectedOwner(init) });
  if (!who) return Response.json({ error: "Sign in to save builds.", signIn: "/sign-in?returnTo=%2Fme" }, { status: 401 });
  const named = expectedOwner(init);
  if (named !== null && named !== who) {
    return Response.json({ error: "This was meant for another account than the one signed in now. Nothing was saved.", code: "account_mismatch" }, { status: 409 });
  }
  const mine = accounts[who] ??= { characters: [], builds: [] };
  if (method === "GET" && url === "/api/me/builds" && readAnswer) { const read = readAnswer; readAnswer = null; return read; }
  if (method === "GET" && url === "/api/me/builds") return Response.json(mine);
  if (method === "POST" && url === "/api/me/characters") {
    const character = { id: serverId(++made), name: String(body.name), classSlug: String(body.classSlug), realm: (body.realm as string) || null, note: (body.note as string) || null };
    mine.characters.push(character);
    return Response.json({ character }, { status: 201 });
  }
  if (method === "POST" && url === "/api/me/builds") {
    if (ordersMissing && ("order" in body || "order2" in body)) {
      return Response.json(ordersMessageOnly ? { error: ORDERS_UNAVAILABLE } : { error: ORDERS_UNAVAILABLE, code: "orders_unavailable" }, { status: 409 });
    }
    // The transfer key, as the route takes it: on a new build only, and a key used before is answered as an update is,
    // a 200 with the build it made and nothing more.
    const key = body.transferKey;
    if (key !== undefined) {
      if (body.id !== undefined || typeof key !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(key)) return Response.json({ error: "That transfer key is not valid." }, { status: 400 });
      const earlier = (keyed[who] ??= {})[key];
      if (earlier) return Response.json({ build: earlier });
    }
    const refused = refuse[String(body.name)];
    if (refused) return refused;
    const { transferKey: _, ...fields } = body;
    const build = { id: serverId(++made), slug: `Slug${String(made).padStart(4, "0")}`, ...fields, link: body.shared ? "https://everloot.app/b/x" : null };
    mine.builds.unshift(build);
    if (typeof key === "string") keyed[who][key] = build;
    return Response.json({ build }, { status: 201 });
  }
  throw new Error(`Unexpected request ${method} ${url}`);
}

function hold(request: string): () => void {
  let release = () => {};
  held.set(request, new Promise<void>((r) => { release = r; }));
  return () => release();
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/tools/builds");
  localStorage.clear();
  who = A_ID;
  accounts = { [A_ID]: { characters: [], builds: [] }, [B_ID]: { characters: [], builds: [] } };
  posts = [];
  requests = [];
  ordersMissing = false;
  ordersMessageOnly = false;
  keyed = {};
  refuse = {};
  readAnswer = null;
  held = new Map();
  made = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = `${init?.method ?? "GET"} ${String(input)}`;
    requests.push({ request, owner: expectedOwner(init) });
    const response = answer(String(input), init);
    const wait = held.get(request);
    if (wait) { held.delete(request); await wait; }
    return response;
  }));
  installLocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (navigator as { locks?: unknown }).locks;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Lets the account lookup and the reads and writes that follow it finish. */
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
/** Lets everything run that waits on no timer, with fake timers standing still, until `ready`. */
async function pump(ready: () => boolean, what: string) {
  for (let i = 0; i < 200 && !ready(); i++) await act(async () => { await new Promise((r) => setImmediate(r)); });
  if (!ready()) throw new Error(`Timed out waiting for ${what}`);
}
async function render() {
  await act(async () => root.render(<TransferPlans />));
  await settle();
}
const text = () => container.textContent ?? "";
const button = (label: RegExp) => [...container.querySelectorAll("button")].find((b) => label.test(b.textContent?.trim() ?? ""));
async function click(el: Element | undefined | null) {
  if (!el) throw new Error("Nothing to click");
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
  await settle();
}
/** The field a label names, by the start of the label's text. */
const field = (label: string) =>
  [...container.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select") ?? null;
async function set(control: HTMLInputElement | HTMLSelectElement | null, value: string) {
  if (!control) throw new Error("No field");
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")!.set!;
  await act(async () => { setter.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
  await settle();
}
const alerts = () => [...container.querySelectorAll('[role="alert"]')].map((a) => a.textContent).join(" ");
const summary = () => container.querySelector('[aria-label="What saving does"]')?.textContent ?? "";
const saveButton = () => button(/^Save to your account$/) as HTMLButtonElement | undefined;
const comeBack = async () => { await act(async () => { window.dispatchEvent(new Event("focus")); }); await settle(); };
const accountReads = () => requests.filter((r) => r.request !== "GET /api/auth/me");

test.each(["source", "destination"])("v3 %s stops before transfer registry access and account requests", async (side) => {
  seed(ANON, [FROST]);
  const owner = side === "source" ? ANON : A;
  localStorage.setItem(bucketKey(owner), JSON.stringify({ ...JSON.parse(V3_BUCKET_TEXT), owner }));
  const before = device();
  const getItem = Storage.prototype.getItem;
  const reads = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
    if (key === "everloot:transfers") throw new Error("Registry must not be read");
    return getItem.call(this, key);
  });
  await render();
  expect(text()).toContain("This workspace uses version 3");
  expect(button(/^Choose plans to save to your account$/)).toBeUndefined();
  expect(accountReads()).toEqual([]);
  expect(reads.mock.calls.some(([key]) => key === "everloot:transfers")).toBe(false);
  expect(device()).toEqual(before);
});

test.each(["source", "destination"])("a %s changed to v3 while identity waits prevents account reads and registry access", async (side) => {
  seed(ANON, [FROST]);
  await render();
  const release = hold("GET /api/auth/me");
  await open();
  const owner = side === "source" ? ANON : A;
  localStorage.setItem(bucketKey(owner), JSON.stringify({ ...JSON.parse(V3_BUCKET_TEXT), owner }));
  const before = device();
  const getItem = Storage.prototype.getItem;
  const reads = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
    if (key === "everloot:transfers") throw new Error("Registry must not be read");
    return getItem.call(this, key);
  });
  release();
  await settle();
  expect(alerts()).toContain("This workspace uses version 3");
  expect(accountReads()).toEqual([]);
  expect(reads.mock.calls.some(([key]) => key === "everloot:transfers")).toBe(false);
  expect(device()).toEqual(before);
});

test.each(["source", "destination"])("a %s changed to v3 during a build response preserves cursors and pending receipts", async (side) => {
  seed(ANON, [FROST]);
  await render();
  await open();
  await choose("Save Frost to your account", { Frost: "private" });
  const release = hold("POST /api/me/builds");
  await click(saveButton());
  await vi.waitFor(() => expect(posts).toHaveLength(1));
  expect(posts).toHaveLength(1);
  const key = posts[0].body.transferKey;
  expect(key).toEqual(KEY);
  expect(journal()?.receipts).toEqual([expect.objectContaining({ key, state: "sending" })]);
  const owner = side === "source" ? ANON : A;
  localStorage.setItem(bucketKey(owner), JSON.stringify({ ...JSON.parse(V3_BUCKET_TEXT), owner }));
  const before = device();
  await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: bucketKey(owner) })); });
  release();
  await vi.waitFor(() => expect(alerts()).toContain("this browser could not record that"));
  expect(alerts()).toContain("a plan your account has may still show here signed out");
  expect(document.activeElement?.textContent).toContain("this browser could not record that");
  expect(text()).toContain("This workspace uses version 3");
  expect(text()).not.toContain("Nothing was changed");
  expect(accounts[A_ID].builds).toHaveLength(1);
  expect(journal()?.receipts).toEqual([expect.objectContaining({ key, state: "sending" })]);
  expect(device()).toEqual(before);
  expect(posts).toHaveLength(1);
});

test.each(["source", "destination"])("a %s changed to v3 during a character response keeps the created-character outcome visible", async (side) => {
  const jaina = alt({ planIds: [FROST.id] });
  seed(ANON, [FROST], [jaina]);
  await render();
  await open();
  await choose("Save Frost to your account", { Frost: "private" });
  await set(field("Character for Frost"), `alt:${jaina.id}`);
  const release = hold("POST /api/me/characters");
  await click(saveButton());
  await vi.waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].url).toBe("/api/me/characters");
  expect(journal()?.characters).toEqual([expect.objectContaining({ altId: jaina.id, characterId: null })]);
  const owner = side === "source" ? ANON : A;
  localStorage.setItem(bucketKey(owner), JSON.stringify({ ...JSON.parse(V3_BUCKET_TEXT), owner }));
  const before = device();
  await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: bucketKey(owner) })); });
  release();
  await vi.waitFor(() => expect(alerts()).toContain("Made the character Jaina on your account first, with no builds yet"));
  expect(alerts()).toContain("trying again files plans under it, not under a new one");
  expect(document.activeElement?.textContent).toContain("Made the character Jaina");
  expect(text()).toContain("This workspace uses version 3");
  expect(text()).not.toContain("Nothing was changed");
  expect(accounts[A_ID].characters).toHaveLength(1);
  expect(accounts[A_ID].builds).toHaveLength(0);
  expect(device()).toEqual(before);
  expect(posts).toHaveLength(1);
});

async function open() {
  await click(button(/^Choose plans to save to your account$/));
}
/** Chooses a group of plans (its checkbox) and each plan's sharing. */
async function choose(label: string, sharing: Record<string, "private" | "shared" | "shared-name">) {
  await click(field(label));
  for (const [name, value] of Object.entries(sharing)) await set(field(`Sharing for ${name}`), value);
}

describe("offering the transfer", () => {
  test("Plans on this device offers it only while saved builds are on, and then says plans can be uploaded", async () => {
    seed(ANON, [FROST]);
    const { default: Page } = await import("@/app/tools/builds/page");
    vi.stubEnv("EVERLOOT_SAVED_BUILDS", "");
    await act(async () => root.render(<Page />));
    await settle();
    expect(text()).toContain("No account needed, and nothing is uploaded.");
    expect(text()).not.toContain("saved while signed out, so");
    expect(accountReads()).toEqual([]);
    await act(async () => root.unmount());
    root = createRoot(container);
    vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
    await act(async () => root.render(<Page />));
    await settle();
    expect(text()).toContain("No account needed, and nothing is uploaded unless you save plans to your account.");
    expect(text()).toContain("1 plan on this device was saved while signed out, so it is not in your account.");
    expect(accountReads()).toEqual([]);
  });

  test("nothing shows signed out, or with no plans kept signed out", async () => {
    seed(ANON, [FROST]);
    who = null;
    await render();
    expect(text()).toBe("");
    who = A_ID;
    localStorage.clear();
    await comeBack();
    expect(text()).toBe("");
    expect(accountReads()).toEqual([]);
  });

  test("signed in, the plans kept signed out are offered, and the account is asked nothing until the player opens the transfer", async () => {
    seed(ANON, [FROST, FIRE]);
    seed(A, [plan({ id: id(9), name: "Already here" })]);
    await render();
    expect(text()).toContain("2 plans on this device were saved while signed out, so they are not in your account.");
    expect(text()).toContain("Nothing is sent until you do.");
    expect(accountReads()).toEqual([]);
    expect(posts).toEqual([]);
    await open();
    // The account is read for the account this tab confirmed, and only that one.
    expect(accountReads()).toEqual([{ request: "GET /api/me/builds", owner: A_ID }]);
    expect(posts).toEqual([]);
  });

  test("a read of the account refused for another account says so, checks the account again and can be opened again", async () => {
    seed(ANON, [FROST]);
    await render();
    readAnswer = Response.json({ error: "This was meant for another account than the one signed in now. Nothing was saved.", code: "account_mismatch" }, { status: 409 });
    const asked = requests.filter((r) => r.request === "GET /api/auth/me").length;
    await open();
    expect(text()).toContain("The account signed in here changed, so nothing was sent.");
    expect(text()).not.toContain("Reading your account");
    expect(requests.filter((r) => r.request === "GET /api/auth/me").length).toBeGreaterThan(asked);
    await open();
    expect(text()).toContain("Saving to your account, Thrall#1234, the one signed in here now.");
    expect(text()).not.toContain("nothing was sent");
  });
});

describe("the preview", () => {
  test("names the account it saves to, says what the calculator and Chat start with, and sends nothing until each chosen plan's sharing is chosen", async () => {
    accounts[A_ID].builds = [{ id: serverId(90) }, { id: serverId(91) }];
    seed(ANON, [FROST]);
    await render();
    await open();
    expect(text()).toContain("Saving to your account, Thrall#1234, the one signed in here now. It has 2 of 200 builds and 0 of 30 characters.");
    expect(text()).toContain("Save in the talent calculator starts a build with its share link on, so anyone with the link can open it, and your name hidden. Builds made in Chat start private.");
    expect(text()).toContain("Nothing is picked for you here");
    await click(field("Save Frost to your account"));
    // No sharing is chosen for the player: the choice starts empty and Save waits for it.
    expect((field("Sharing for Frost") as HTMLSelectElement).value).toBe("");
    expect(saveButton()?.disabled).toBe(true);
    expect(text()).toContain("Choose private or a share link for Frost.");
    await set(field("Sharing for Frost"), "private");
    expect(saveButton()?.disabled).toBe(false);
    expect(summary()).toContain("Saves Frost to your account as a private build, with no character.");
    await set(field("Sharing for Frost"), "shared");
    expect(summary()).toContain("Saves Frost to your account with its share link on and your name hidden, with no character.");
    expect(posts).toEqual([]);
  });

  test("Cancel leaves everything on this device as it was and sends nothing", async () => {
    seed(ANON, [FROST, FIRE], [alt({ planIds: [FIRE.id] })]);
    const before = device();
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await click(button(/^Cancel$/));
    expect(device()).toEqual(before);
    expect(posts).toEqual([]);
    expect(button(/^Choose plans to save to your account$/)).toBeTruthy();
  });

  test("a plan whose spend order cannot be read here is refused, not saved without it", async () => {
    seed(ANON, [plan({ order: "O2p-AABCC" }), FIRE]);
    await render();
    await open();
    expect(text()).toContain("Frost: set 1's spend order was made by a newer version of Everloot, and your account would lose it, so it is not saved.");
    expect((field("Save Frost to your account") as HTMLInputElement).disabled).toBe(true);
    await choose("Save Fire to your account", { Fire: "private" });
    await click(saveButton());
    expect(posts.map((p) => p.body.name)).toEqual(["Fire"]);
    expect(names(ANON)).toEqual(["Frost"]);
  });
});

describe("saving", () => {
  test("each chosen plan is saved with its spend orders and the sharing chosen, then kept with the account's plans on this device, bound to it", async () => {
    seed(ANON, [FROST, FIRE, BEAR]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await choose("Save Fire to your account", { Fire: "shared" });
    await click(saveButton());
    expect(posts.map((p) => [p.url, p.owner, p.as])).toEqual([["/api/me/builds", A_ID, A_ID], ["/api/me/builds", A_ID, A_ID]]);
    // Only the plan's own fields, its orders as they were kept here, and the sharing the player chose: no addon file,
    // no alt details, nothing that names this browser's plans.
    expect(posts[0].body).toEqual({
      name: "Frost", notes: "", characterId: null, code: MAGE, code2: null, shared: false, showName: false, order: PLANNED, order2: null, transferKey: KEY,
    });
    expect(posts[1].body).toEqual({
      name: "Fire", notes: "For raids", characterId: null, code: MAGE, code2: MAGE_SMALL, shared: true, showName: false, order: "O1g-AABCC", order2: "O1p-A", transferKey: KEY,
    });
    // One key per plan and account, kept apart from the plans.
    expect(posts[0].body.transferKey).not.toBe(posts[1].body.transferKey);
    expect(names(ANON)).toEqual(["Bear"]);
    expect(stored(A)!.plans).toEqual([bound(FROST), bound(FIRE)]);
    expect(text()).toContain("Saved 2 plans to your account.");
    // Nothing else was asked of the site: no profile, no file, no other account.
    expect(new Set(requests.map((r) => r.request))).toEqual(new Set(["GET /api/auth/me", "GET /api/me/builds", "POST /api/me/builds"]));
    // The one plan left is still offered.
    expect(text()).toContain("1 plan on this device was saved while signed out, so it is not in your account.");
  });

  test("the name shows on a shared link only when the player asks for it", async () => {
    seed(ANON, [FROST]);
    await render();
    await open();
    expect(text()).toContain("A shared link never shows a Battle.net name, so with a Battle.net sign-in it shows no name either way.");
    await choose("Save Frost to your account", { Frost: "shared-name" });
    expect([...(field("Sharing for Frost") as HTMLSelectElement).options].map((o) => o.textContent)).toContain("Share link on, with my name if it can be shown");
    expect(summary()).toContain("Saves Frost to your account with its share link on, and your name if it can be shown");
    await click(saveButton());
    expect(posts[0].body).toMatchObject({ shared: true, showName: true });
  });

  test("an alt goes with its plans: what does not fit a character on the account is shown before saving and filled in by the player, nothing is cut, and the alt keeps every detail on this device", async () => {
    const longName = "Jainaproudmooreofthekirintorx";
    const longRealm = "The Realm Of A Very Long Name, Truly Long";
    const notes = `Frost for raids.\n${"x".repeat(280)}`;
    const jaina = alt({ name: longName, realm: longRealm, level: 24, faction: "alliance", professions: ["Enchanting", "Tailoring"], notes, planIds: [FROST.id, FIRE.id] });
    const watch: LocalWatch = { id: id(700), planId: FIRE.id, addedAt: "2026-10-20T12:00:00.000Z" };
    seed(ANON, [FROST, FIRE], [jaina], [watch]);
    await render();
    await open();
    expect(text()).toContain(`${longName} uses these, so they go together, and ${longName} moves with them`);
    await choose("Save Frost and Fire to your account", { Frost: "private", Fire: "private" });
    await set(field("Character for Frost"), `alt:${jaina.id}`);
    await set(field("Character for Fire"), `alt:${jaina.id}`);
    expect(text()).toContain(`New character on your account, from your alt ${longName}`);
    expect(text()).toContain(`${longName}'s name here has 29 characters; a character name on your account has up to 24. Type the name to use there.`);
    expect(text()).toContain("The realm here has 41 characters; a realm on your account has up to 32. Type it shorter, or leave it out.");
    expect(text()).toContain(`${longName}'s notes here have 297 characters over 2 lines; a note on your account is one line of up to 140. Write one, or leave it empty: the notes stay with ${longName} on this device, in full.`);
    expect(text()).toContain(`Not kept on your account: Level 24 · Alliance · Enchanting, Tailoring. They stay with ${longName} on this device.`);
    // Nothing is cut to fit: the fields that do not fit start empty, and Save waits for a name.
    expect((field("Character name") as HTMLInputElement).value).toBe("");
    expect((field("Realm") as HTMLInputElement).value).toBe("");
    expect((field("Note") as HTMLInputElement).value).toBe("");
    expect(saveButton()?.disabled).toBe(true);
    expect(text()).toContain("Give the character a name of 1 to 24 characters.");
    await set(field("Character name"), "Jaina");
    await set(field("Note"), "Frost for raids");
    expect(summary()).toContain("Makes the character Jaina (Mage) on your account.");
    expect(summary()).toContain(`Moves 2 plans, 1 alt and 1 watch from the signed-out plans to this account's on this device.`);
    await click(saveButton());
    // One character for both plans, then the builds filed under it.
    expect(posts.map((p) => p.url)).toEqual(["/api/me/characters", "/api/me/builds", "/api/me/builds"]);
    // The character as the account keeps it, and as this browser recorded it before asking for it.
    expect(posts[0].body).toEqual({ name: "Jaina", classSlug: "mage", realm: null, note: "Frost for raids" });
    expect(journal()!.characters).toEqual([{ altId: jaina.id, userId: A_ID, characterId: serverId(1), label: posts[0].body, at: expect.any(String) }]);
    expect(posts[1].body.characterId).toBe(serverId(1));
    expect(posts[2].body.characterId).toBe(serverId(1));
    expect(posts.every((p) => p.owner === A_ID)).toBe(true);
    expect(JSON.stringify(posts)).not.toContain("x".repeat(141));
    // The alt, its plans and its watch now live with the account's plans on this device; the alt is unchanged.
    expect(stored(ANON)).toMatchObject({ plans: [], alts: [], watches: [] });
    expect(stored(A)).toMatchObject({ plans: [bound(FROST), bound(FIRE)], alts: [jaina], watches: [watch] });
  });

  test("an alt is offered as a character only for plans of its own class", async () => {
    seed(ANON, [FROST], [alt({ classSlug: "druid", planIds: [FROST.id] }), alt({ id: id(501), name: "Unknown", classSlug: null, planIds: [FROST.id] })]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    const options = [...(field("Character for Frost") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(["No character"]);
  });

  test("the account's existing characters of the plan's class can be chosen", async () => {
    accounts[A_ID].characters = [
      { id: serverId(80), name: "Sylvanas", classSlug: "mage", realm: "Moon Guard", note: null },
      { id: serverId(81), name: "Malfurion", classSlug: "druid", realm: null, note: null },
    ];
    seed(ANON, [FROST]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    expect([...(field("Character for Frost") as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["No character", "Sylvanas (Moon Guard)"]);
    await set(field("Character for Frost"), serverId(80));
    expect(summary()).toContain("Saves Frost to your account as a private build, under Sylvanas.");
    await click(saveButton());
    expect(posts.map((p) => p.body.characterId)).toEqual([serverId(80)]);
  });
});

describe("the account's limits", () => {
  test("are checked before anything is sent: builds, characters and the room on this device", async () => {
    accounts[A_ID].builds = Array.from({ length: 199 }, (_, i) => ({ id: serverId(100 + i) }));
    accounts[A_ID].characters = Array.from({ length: 30 }, (_, i) => ({ id: serverId(400 + i), name: `C${i}`, classSlug: "mage", realm: null, note: null }));
    seed(ANON, [FROST, FIRE], [alt({ planIds: [FROST.id] })]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await choose("Save Fire to your account", { Fire: "private" });
    expect(text()).toContain("Your account has room for 1 more build, and 2 are chosen.");
    expect(saveButton()?.disabled).toBe(true);
    await click(field("Save Fire to your account"));
    expect(text()).not.toContain("room for 1 more build");
    await set(field("Character for Frost"), `alt:${id(500)}`);
    expect(text()).toContain("Your account has 30 characters, as many as it can have, and this would make 1 more.");
    expect(saveButton()?.disabled).toBe(true);
    await click(button(/^Cancel$/));
    expect(posts).toEqual([]);
  });

  test("a plan this device has no room for under the account is refused before anything is sent", async () => {
    seed(A, Array.from({ length: 200 }, (_, i) => plan({ id: id(1000 + i), name: `Plan ${i}` })));
    seed(ANON, [FROST]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    expect(text()).toContain("This account's plans on this device have no room for these: a device keeps 200 plans and 60 alts, all within a 1 MiB backup.");
    expect(saveButton()?.disabled).toBe(true);
  });
});

describe("refusals and account changes", () => {
  test("without the spend-order migration the transfer says so and leaves every plan on this device as it was, orders and all", async () => {
    ordersMissing = true;
    seed(ANON, [FROST, FIRE]);
    const before = buckets();
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await choose("Save Fire to your account", { Fire: "private" });
    await click(saveButton());
    // The order was sent, not dropped to get the save through, and nothing after the refusal was tried.
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ order: PLANNED });
    expect(alerts()).toContain("Saving spend orders isn't available yet, so no plans were saved to your account. They stay on this device as they were, spend orders included.");
    expect(buckets()).toEqual(before);
    // The key was sent, so it is kept, marked refused and why: trying again sends the same one.
    expect(journal()!.receipts).toEqual([{ planId: FROST.id, userId: A_ID, key: posts[0].body.transferKey, state: "failed", reason: "orders_unavailable", content: null, at: expect.any(String) }]);
  });

  test("a save the site refuses for another account stops the transfer, binds nothing and checks the account again", async () => {
    seed(ANON, [FROST, FIRE]);
    const before = buckets();
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await choose("Save Fire to your account", { Fire: "private" });
    const asked = requests.filter((r) => r.request === "GET /api/auth/me").length;
    // The check just before sending is answered for A; another tab signs in to B before the save goes out.
    const release = hold("GET /api/auth/me");
    await click(saveButton());
    who = B_ID;
    release();
    await settle();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ as: B_ID, owner: A_ID });
    expect(accounts[B_ID].builds).toEqual([]);
    expect(buckets()).toEqual(before);
    expect(journal()!.receipts).toMatchObject([{ planId: FROST.id, key: posts[0].body.transferKey, state: "failed", reason: "account_mismatch" }]);
    expect(requests.filter((r) => r.request === "GET /api/auth/me").length).toBeGreaterThan(asked);
    expect(text()).toContain("The account signed in here changed, so the transfer stopped.");
  });

  test("an account switch part way through stops it: nothing more is sent, the answer on its way binds only to the account it was sent for, and the next account's plans are untouched", async () => {
    seed(ANON, [FROST, FIRE]);
    seed(B, [plan({ id: id(9), name: "B's own" })]);
    const theirs = localStorage.getItem(bucketKey(B));
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await choose("Save Fire to your account", { Fire: "private" });
    const release = hold("POST /api/me/builds");
    await click(saveButton());
    expect(posts).toHaveLength(1);
    // Signed in to B in another tab; this tab notices when it comes back.
    who = B_ID;
    await comeBack();
    release();
    await settle();
    expect(posts).toHaveLength(1);
    expect(accounts[A_ID].builds).toHaveLength(1);
    expect(accounts[B_ID].builds).toEqual([]);
    expect(stored(A)!.plans).toEqual([bound(FROST)]);
    expect(names(ANON)).toEqual(["Fire"]);
    expect(localStorage.getItem(bucketKey(B))).toBe(theirs);
    expect(text()).toContain("The account signed in here changed, so the transfer stopped.");
    // B is offered what is still signed out, from the start, with nothing chosen for it.
    expect(text()).toContain("1 plan on this device was saved while signed out");
    expect(button(/^Choose plans to save to your account$/)).toBeTruthy();
  });

  test("a sign-out in this tab part way through stops the transfer before the next save", async () => {
    seed(ANON, [FROST, FIRE]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await choose("Save Fire to your account", { Fire: "private" });
    const release = hold("POST /api/me/builds");
    await click(saveButton());
    who = null;
    await act(async () => { window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT)); });
    release();
    await settle();
    expect(posts).toHaveLength(1);
    expect(stored(A)!.plans).toEqual([bound(FROST)]);
    expect(names(ANON)).toEqual(["Fire"]);
  });
});

describe("trying again", () => {
  test("after a failure part way through, a plan already saved is not saved twice", async () => {
    refuse = { Fire: Response.json({ error: "Saved builds are unavailable right now. Try again in a minute." }, { status: 503 }) };
    seed(ANON, [FROST, FIRE]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await choose("Save Fire to your account", { Fire: "private" });
    await click(saveButton());
    expect(posts.map((p) => p.body.name)).toEqual(["Frost", "Fire"]);
    expect(alerts()).toContain("Saved Frost to your account. Fire may not have been saved: Saved builds are unavailable right now. Try again in a minute.");
    expect(alerts()).toContain("Trying again does not save Frost and Fire twice.");
    expect(stored(A)!.plans).toEqual([bound(FROST)]);
    expect(names(ANON)).toEqual(["Fire"]);
    refuse = {};
    await open();
    await choose("Save Fire to your account", { Fire: "private" });
    await click(saveButton());
    expect(posts.map((p) => p.body.name)).toEqual(["Frost", "Fire", "Fire"]);
    expect(names(A)).toEqual(["Frost", "Fire"]);
    expect(names(ANON)).toEqual([]);
  });

  test("an alt's plans saved before a failure stay here too, so its alt keeps them, and are not saved again when the rest are", async () => {
    refuse = { Fire: Response.json({ error: "You saved 300 times in the last day. Try again tomorrow." }, { status: 429 }) };
    const jaina = alt({ planIds: [FROST.id, FIRE.id] });
    seed(ANON, [FROST, FIRE], [jaina]);
    await render();
    await open();
    await choose("Save Frost and Fire to your account", { Frost: "private", Fire: "shared" });
    await click(saveButton());
    expect(posts.map((p) => p.body.name)).toEqual(["Frost", "Fire"]);
    // Frost is the account's now, and stays signed out as well until the alt that uses it can follow.
    expect(stored(A)!.plans).toEqual([bound(FROST)]);
    expect(stored(ANON)).toMatchObject({ plans: [FROST, FIRE], alts: [jaina] });
    refuse = {};
    await open();
    expect(text()).toContain("Frost is in your account already");
    await choose("Save Frost and Fire to your account", { Fire: "shared" });
    expect(summary()).toContain("Frost is in your account already: saving finishes moving it here, without a second save.");
    await click(saveButton());
    expect(posts.map((p) => p.body.name)).toEqual(["Frost", "Fire", "Fire"]);
    expect(stored(A)).toMatchObject({ plans: [bound(FROST), bound(FIRE)], alts: [jaina] });
    expect(stored(ANON)).toMatchObject({ plans: [], alts: [] });
  });

  test("a plan the account has already, after the alt's last new plan, goes with the group without a false alarm", async () => {
    // Fire was left here when an earlier transfer could not take it out of the signed-out plans; Frost is new.
    const jaina = alt({ planIds: [FROST.id, FIRE.id] });
    const accountFire = { ...FIRE, boundTo: { userId: A_ID, at: AT } };
    seed(ANON, [FROST, FIRE], [jaina]);
    seed(A, [accountFire]);
    await render();
    await open();
    await choose("Save Frost and Fire to your account", { Frost: "private" });
    await click(saveButton());
    expect(posts.map((p) => p.body.name)).toEqual(["Frost"]);
    expect(alerts()).toBe("");
    expect(text()).toContain("Saved 1 plan to your account.");
    expect(stored(A)).toMatchObject({ plans: [accountFire, bound(FROST)], alts: [jaina] });
    expect(stored(ANON)).toMatchObject({ plans: [], alts: [] });
  });

  test("a plan another tab saved to this account after the preview is not sent again, and one deleted there is not sent at all", async () => {
    seed(ANON, [FROST, FIRE, BEAR]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await choose("Save Fire to your account", { Fire: "private" });
    await choose("Save Bear to your account", { Bear: "private" });
    // Meanwhile another tab saved Frost to this account (its copy here left behind), and deleted Bear.
    seed(A, [{ ...FROST, boundTo: { userId: A_ID, at: AT } }]);
    seed(ANON, [FROST, FIRE]);
    await click(saveButton());
    expect(posts.map((p) => p.body.name)).toEqual(["Fire"]);
    expect(stored(A)!.plans).toEqual([{ ...FROST, boundTo: { userId: A_ID, at: AT } }, bound(FIRE)]);
    expect(names(ANON)).toEqual([]);
    expect(alerts()).toContain("Saved Fire to your account. Bear changed on this device after the preview, so it was not sent.");
  });

  test("a plan already saved from this browser to another account is refused, with why, and never sent to this one", async () => {
    // Frost went to A, and a copy stayed signed out (a write that failed, or an older backup restored).
    seed(ANON, [FROST, FIRE]);
    seed(A, [{ ...FROST, boundTo: { userId: A_ID, at: AT } }]);
    const theirs = localStorage.getItem(bucketKey(A));
    who = B_ID;
    await render();
    expect(text()).toContain("1 plan on this device was saved while signed out, so it is not in your account.");
    expect(text()).toContain("1 more kept here is another account's, saved to it from this browser, so it is not shown.");
    await open();
    expect(text()).not.toContain("Frost");
    expect(field("Save Frost to your account")).toBeNull();
    await choose("Save Fire to your account", { Fire: "private" });
    await click(saveButton());
    expect(posts.map((p) => [p.body.name, p.owner])).toEqual([["Fire", B_ID]]);
    expect(localStorage.getItem(bucketKey(A))).toBe(theirs);
    expect(names(ANON)).toEqual(["Frost"]);
  });

  test("the account's own copy is kept, and a copy here that differs from it is refused with why, whichever is newer", async () => {
    const accountFrost = { ...FROST, name: "Frost, renamed", updatedAt: "2026-10-22T12:00:00.000Z", boundTo: { userId: A_ID, at: AT } };
    const accountFire = { ...FIRE, boundTo: { userId: A_ID, at: AT } };
    const changedFire = { ...FIRE, notes: "Changed here later", updatedAt: "2026-10-23T12:00:00.000Z" };
    seed(ANON, [FROST, changedFire]);
    seed(A, [accountFrost, accountFire]);
    await render();
    await open();
    expect(text()).toContain("Frost is in your account already, saved Oct 21, 2026, and the copy here differs from it. Saving it again would make a second build, so it is left as it is.");
    expect(text()).toContain("Fire is in your account already, saved Oct 21, 2026, and the copy here differs from it. Saving it again would make a second build, so it is left as it is.");
    expect((field("Save Frost to your account") as HTMLInputElement).disabled).toBe(true);
    expect((field("Save Fire to your account") as HTMLInputElement).disabled).toBe(true);
    expect(posts).toEqual([]);
    expect(stored(A)!.plans).toEqual([accountFrost, accountFire]);
    expect(stored(ANON)!.plans).toEqual([FROST, changedFire]);
  });
});

describe("binding a transfer on this device", () => {
  const sent = (owner: Owner, ...plans: LocalPlan[]) => ({ owner, planIds: plans.map((p) => p.id) });
  const saved = (owner: Owner, ...plans: LocalPlan[]) => ({ ok: true as const, userId: owner.kind === "account" ? owner.userId : "", planIds: plans.map((p) => p.id) });
  const NOW = new Date("2026-10-27T12:00:00.000Z");

  test("a plan the account's bucket already holds bound to it keeps the account's copy, and the copy here, the one sent, goes", () => {
    const accountCopy = { ...FROST, name: "Renamed on the account side", updatedAt: "2026-10-22T12:00:00.000Z", boundTo: { userId: A_ID, at: AT } };
    seed(ANON, [FROST]);
    seed(A, [accountCopy]);
    expect(bindTransferred(localStorage, sent(A, FROST), saved(A, FROST), NOW)).toEqual({ ok: true, bound: 1 });
    expect(stored(A)!.plans).toEqual([accountCopy]);
    expect(stored(ANON)!.plans).toEqual([]);
  });

  test("a copy here that the account saved is not refused as a second build when the account's copy here was renamed since: it goes", async () => {
    const { contentDigest, receiptSaved, transferKey } = await import("@/lib/player-workspace");
    const accountCopy = { ...FROST, name: "Renamed on the account side", updatedAt: "2026-10-22T12:00:00.000Z", boundTo: { userId: A_ID, at: AT } };
    seed(ANON, [FROST]);
    seed(A, [accountCopy]);
    const key = transferKey(localStorage, A, FROST.id);
    if (!key.ok) throw new Error(key.message);
    expect(receiptSaved(localStorage, A, FROST.id, key.key, await contentDigest(FROST)).ok).toBe(true);
    await render();
    await open();
    expect(text()).toContain("Frost is in your account already (saved");
    expect(text()).not.toContain("differs from it");
    await click(field("Save Frost to your account"));
    await click(saveButton());
    expect(posts).toEqual([]);
    expect(stored(A)!.plans).toEqual([accountCopy]);
    expect(stored(ANON)!.plans).toEqual([]);
  });

  test("a receipt alone moves and hides nothing: a plan leaves the signed-out ones only once the account's copy is on this device", async () => {
    const { contentDigest, hiddenFrom, readWorkspace, receiptSaved, transferKey } = await import("@/lib/player-workspace");
    seed(ANON, [FROST]);
    const key = transferKey(localStorage, A, FROST.id);
    if (!key.ok) throw new Error(key.message);
    expect(receiptSaved(localStorage, A, FROST.id, key.key, await contentDigest(FROST)).ok).toBe(true);
    // The site said it has Frost, but this device holds no copy for the account: Frost stays, and nobody is kept from it.
    expect(settleTransferred(localStorage, A, [FROST.id])).toEqual({ ok: true, moved: 0 });
    expect(stored(ANON)!.plans).toEqual([FROST]);
    expect(stored(A)).toBeNull();
    const read = readWorkspace(localStorage, ANON);
    if (!read.ok) throw new Error(read.message);
    expect(hiddenFrom(localStorage, ANON, read.workspace).size).toBe(0);
    expect(hiddenFrom(localStorage, B, read.workspace).size).toBe(0);
    // The transfer finishes moving it as any plan the account has: the account's copy on this device first, then out.
    await render();
    await open();
    await click(field("Save Frost to your account"));
    await click(saveButton());
    expect(posts).toEqual([]);
    expect(stored(A)!.plans).toEqual([bound(FROST)]);
    expect(stored(ANON)!.plans).toEqual([]);
  });

  test("an alt goes with its plans only when the account's copy of it has the same content, whatever either one's date", () => {
    const boundFrost = { ...FROST, boundTo: { userId: A_ID, at: AT } };
    // Edited here while the clock said Oct 27; the account's copy is a restored backup's, dated Nov 1. Neither date
    // decides: they differ, so the one here stays, and Frost with it.
    const jaina = alt({ planIds: [FROST.id], notes: "Edited here", updatedAt: "2026-10-27T12:00:00.000Z" });
    seed(ANON, [FROST], [jaina]);
    seed(A, [boundFrost], [{ ...jaina, notes: "", updatedAt: "2026-11-01T12:00:00.000Z" }]);
    expect(settleTransferred(localStorage, A, [FROST.id])).toEqual({ ok: true, moved: 0 });
    expect(stored(ANON)).toMatchObject({ plans: [FROST], alts: [jaina] });
    // The same Jaina with only another date is the same alt: it goes, and the account keeps its own copy.
    const accountJaina = { ...jaina, updatedAt: "2026-11-01T12:00:00.000Z" };
    seed(A, [boundFrost], [accountJaina]);
    expect(settleTransferred(localStorage, A, [FROST.id])).toEqual({ ok: true, moved: 1 });
    expect(stored(ANON)).toMatchObject({ plans: [], alts: [] });
    expect(stored(A)).toMatchObject({ plans: [boundFrost], alts: [accountJaina] });
  });

  test("a plan an alt uses stays signed out as well until every plan of the alt is the account's; then the alt, its plans and their watches move whole", () => {
    const jaina = alt({ planIds: [FROST.id, FIRE.id] });
    const watch: LocalWatch = { id: id(700), planId: FROST.id, addedAt: "2026-10-20T12:00:00.000Z" };
    seed(ANON, [FROST, FIRE, BEAR], [jaina], [watch]);
    expect(bindTransferred(localStorage, sent(A, FROST), saved(A, FROST), NOW)).toEqual({ ok: true, bound: 1 });
    expect(stored(A)).toMatchObject({ plans: [{ ...FROST, boundTo: { userId: A_ID, at: NOW.toISOString() } }], alts: [], watches: [] });
    expect(stored(ANON)).toMatchObject({ plans: [FROST, FIRE, BEAR], alts: [jaina], watches: [watch] });
    expect(bindTransferred(localStorage, sent(A, FIRE), saved(A, FIRE), NOW)).toEqual({ ok: true, bound: 1 });
    expect(stored(A)).toMatchObject({ plans: [{ ...FROST, boundTo: { userId: A_ID, at: NOW.toISOString() } }, { ...FIRE, boundTo: { userId: A_ID, at: NOW.toISOString() } }], alts: [jaina], watches: [watch] });
    expect(stored(ANON)).toMatchObject({ plans: [BEAR], alts: [], watches: [] });
  });

  test("settling moves what the account already holds, and nothing it does not", () => {
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST, FIRE], [jaina]);
    seed(A, [{ ...FROST, boundTo: { userId: A_ID, at: AT } }]);
    expect(settleTransferred(localStorage, A, [FROST.id, FIRE.id])).toEqual({ ok: true, moved: 1 });
    expect(stored(A)).toMatchObject({ plans: [{ ...FROST, boundTo: { userId: A_ID, at: AT } }], alts: [jaina] });
    expect(stored(ANON)).toMatchObject({ plans: [FIRE], alts: [] });
    expect(settleTransferred(localStorage, A, [FROST.id, FIRE.id])).toEqual({ ok: true, moved: 0 });
  });

  test("a plan bound to another account on this browser is found, and the account's own bucket is not counted", () => {
    seed(A, [{ ...FROST, boundTo: { userId: A_ID, at: AT } }]);
    seed(B, [{ ...FIRE, boundTo: { userId: B_ID, at: AT } }]);
    expect(boundElsewhere(localStorage, A, [FROST.id, FIRE.id, BEAR.id])).toEqual(new Set([FIRE.id]));
    expect(boundElsewhere(localStorage, B, [FROST.id, FIRE.id])).toEqual(new Set([FROST.id]));
    expect(boundElsewhere(null, A, [FROST.id])).toEqual(new Set());
  });
});

describe("writes from more than one tab", () => {
  /** A Web Locks stand-in: one holder at a time per name, in turn, with every request and any overlap recorded. */
  function fakeLocks() {
    const names: string[] = [];
    let held = 0;
    let overlapped = false;
    let queue: Promise<unknown> = Promise.resolve();
    const request = (name: string, callback: () => unknown) => {
      names.push(name);
      const run = queue.then(async () => {
        held++;
        if (held > 1) overlapped = true;
        try { return await callback(); } finally { held--; }
      });
      queue = run.catch(() => undefined);
      return run;
    };
    Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
    return { names, overlapped: () => overlapped };
  }

  test("a plan another tab saves between the two binding writes is kept", () => {
    seed(ANON, [FROST]);
    const nativeSet = Storage.prototype.setItem;
    let addBetweenWrites = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      nativeSet.call(this, key, value);
      if (key === bucketKey(A) && addBetweenWrites) {
        addBetweenWrites = false;
        nativeSet.call(this, bucketKey(ANON), JSON.stringify(doc(ANON, [FROST, FIRE])));
      }
    });
    const result = bindTransferred(localStorage, { owner: A, planIds: [FROST.id] }, { ok: true, userId: A_ID, planIds: [FROST.id] });
    expect(result.ok).toBe(true);
    expect(names(ANON)).toEqual(["Fire"]);
    expect(stored(A)!.plans).toEqual([bound(FROST)]);
  });

  test("a write whose bucket another tab changed after it was read writes nothing over that change, and says so", async () => {
    const { savePlan } = await import("@/lib/player-workspace");
    seed(ANON, [FROST]);
    const theirs = JSON.stringify(doc(ANON, [FROST, FIRE]));
    let first = true;
    // Another tab saves Fire just after this write has read the bucket.
    const storage = {
      getItem: (key: string) => {
        const value = localStorage.getItem(key);
        if (key === bucketKey(ANON) && first) { first = false; localStorage.setItem(key, theirs); }
        return value;
      },
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
      removeItem: (key: string) => localStorage.removeItem(key),
    };
    const result = savePlan(storage, ANON, { name: "Arcane", notes: "", classSlug: "mage", codes: [MAGE, null], orders: [PLANNED, null] });
    expect(result).toMatchObject({ ok: false, error: "conflict", message: "The plans on this device changed in another tab while this was being saved, so nothing was saved. Try again." });
    expect(localStorage.getItem(bucketKey(ANON))).toBe(theirs);
  });

  test("every write on Plans on this device, and every binding a transfer makes, holds the one workspace lock, one at a time", async () => {
    const lock = fakeLocks();
    seed(ANON, [FROST, FIRE]);
    who = null;
    const { default: DevicePlans } = await import("@/components/workspace/DevicePlans");
    await act(async () => root.render(<DevicePlans />));
    await settle();
    const item = [...container.querySelectorAll("li")].find((li) => li.querySelector("h3")?.textContent === "Fire")!;
    await click([...item.querySelectorAll("button")].find((b) => b.textContent === "Make a copy"));
    expect(names(ANON)).toEqual(["Frost", "Fire", "Fire (copy)"]);
    expect(lock.names).toEqual(["everloot:player-workspace"]);
    await act(async () => root.unmount());
    root = createRoot(container);
    who = A_ID;
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await click(saveButton());
    expect(posts.map((p) => p.body.name)).toEqual(["Frost"]);
    expect(lock.names.length).toBeGreaterThan(1);
    expect(new Set(lock.names)).toEqual(new Set(["everloot:player-workspace"]));
    expect(lock.overlapped()).toBe(false);
  });
});

describe("who the plans go to", () => {
  test("the preview names the account by the name it signed in with", async () => {
    seed(ANON, [FROST]);
    await render();
    await open();
    expect(text()).toMatch(/Thrall|0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11/);
  });

  test("the account is checked again just before sending, and another one there stops it with nothing sent", async () => {
    seed(ANON, [FROST]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    // Another tab signed in to B; this one has not noticed yet.
    who = B_ID;
    await click(saveButton());
    expect(posts).toEqual([]);
    expect(text()).toContain("The account signed in here changed, so nothing was sent.");
    expect(names(ANON)).toEqual(["Frost"]);
  });

  test("Cancel returns keyboard focus to the opener", async () => {
    seed(ANON, [FROST]);
    await render();
    await open();
    expect(document.activeElement).toBe(field("Save Frost to your account"));
    await click(button(/^Cancel$/));
    expect(document.activeElement).toBe(button(/^Choose plans to save to your account$/));
  });

  test("when a transfer ends, focus moves to what it says", async () => {
    seed(ANON, [FROST, FIRE]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await click(saveButton());
    expect(document.activeElement?.textContent).toBe("Saved 1 plan to your account.");
  });
});

describe("what was sent is what is bound", () => {
  test("a plan edited while its POST is pending stays unsaved and is not bound as the sent version", async () => {
    seed(ANON, [FROST]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    const release = hold("POST /api/me/builds");
    await click(saveButton());
    const changed = { ...FROST, notes: "Edited in another tab while the POST is pending", updatedAt: "2026-10-27T12:00:00.000Z" };
    seed(ANON, [changed]);
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: bucketKey(ANON) })); });
    release();
    await settle();
    expect({
      sentNotes: posts[0].body.notes,
      boundNotes: stored(A)?.plans[0]?.notes,
      remainingNotes: stored(ANON)?.plans[0]?.notes,
    }).toEqual({ sentNotes: "", boundNotes: "", remainingNotes: changed.notes });
    expect(text()).toContain("Frost changed here while it was being sent: your account has it as it was when you pressed Save, and the changed copy stays here, signed out.");
  });

  test("a plan changed while its character is being made is checked again, its build is not sent, and the character made is said and used again", async () => {
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST], [jaina]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await set(field("Character for Frost"), `alt:${jaina.id}`);
    const release = hold("POST /api/me/characters");
    await click(saveButton());
    const changed = { ...FROST, notes: "Changed before the build request", updatedAt: "2026-10-27T12:00:00.000Z" };
    seed(ANON, [changed], [jaina]);
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: bucketKey(ANON) })); });
    release();
    await settle();
    expect(posts.map((p) => p.url)).toEqual(["/api/me/characters"]);
    expect(alerts()).toContain("Frost changed on this device after the preview, so it was not sent.");
    expect(alerts()).toContain("Made the character Jaina on your account first, with no builds yet: trying again files plans under it, not under a new one.");
    // Trying again offers the character made, not another one from the alt.
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    expect([...(field("Character for Frost") as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["No character", "Jaina"]);
    await set(field("Character for Frost"), serverId(1));
    await click(saveButton());
    expect(posts.map((p) => p.url)).toEqual(["/api/me/characters", "/api/me/builds"]);
    expect(posts[1].body).toMatchObject({ notes: "Changed before the build request", characterId: serverId(1) });
    expect(accounts[A_ID].characters).toHaveLength(1);
  });

  test("when the site answers a resend with a build that differs from the plan here, the plan stays here and says so", async () => {
    const { transferKey } = await import("@/lib/player-workspace");
    const sent = transferKey(localStorage, A, FROST.id);
    if (!sent.ok) throw new Error("A key should be stored");
    // The site made Frost from that key before; the copy here has changed since.
    const earlier = { id: serverId(50), slug: "Earlier1", name: "Frost", notes: "", characterId: null, code: MAGE, code2: null, shared: false, showName: false, order: PLANNED, order2: null, link: null };
    keyed[A_ID] = { [sent.key]: earlier };
    accounts[A_ID].builds = [earlier];
    seed(ANON, [{ ...FROST, notes: "Changed since it was sent", updatedAt: "2026-10-27T12:00:00.000Z" }]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await click(saveButton());
    expect(posts.map((p) => p.body.transferKey)).toEqual([sent.key]);
    expect(accounts[A_ID].builds).toHaveLength(1);
    expect(stored(A)).toBeNull();
    expect(names(ANON)).toEqual(["Frost"]);
    expect(text()).toContain("Frost was saved to your account before, and the copy here differs from it now, so the copy here stays, signed out.");
    await open();
    expect(text()).toContain("Frost is in your account already, saved");
    expect((field("Save Frost to your account") as HTMLInputElement).disabled).toBe(true);
  });
});

describe("one build per plan and account", () => {
  test("two independent transfers awaiting confirmation do not create the same build twice", async () => {
    seed(ANON, [FROST]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    const release = hold("POST /api/me/builds");
    await click(saveButton());
    const firstRoot = root;
    const firstContainer = container;
    const secondContainer = document.createElement("div");
    document.body.append(secondContainer);
    const secondRoot = createRoot(secondContainer);
    try {
      container = secondContainer;
      root = secondRoot;
      await render();
      await open();
      await choose("Save Frost to your account", { Frost: "private" });
      await click(saveButton());
    } finally {
      await act(async () => secondRoot.unmount());
      secondContainer.remove();
      root = firstRoot;
      container = firstContainer;
      release();
      await settle();
    }
    expect(accounts[A_ID].builds).toHaveLength(1);
    expect(posts).toHaveLength(2);
    expect(posts[1].body.transferKey).toBe(posts[0].body.transferKey);
    expect(stored(A)!.plans).toEqual([bound(FROST)]);
  });

  test("a committed save with a lost response is deduplicated on retry", async () => {
    seed(ANON, [FROST]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    const workingFetch = globalThis.fetch;
    let loseNextBuildResponse = true;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await workingFetch(input, init);
      if (String(input) === "/api/me/builds" && init?.method === "POST" && loseNextBuildResponse) {
        loseNextBuildResponse = false;
        throw new TypeError("The connection dropped after the server committed");
      }
      return response;
    });
    await click(saveButton());
    expect(accounts[A_ID].builds).toHaveLength(1);
    expect(alerts()).toContain("Your account could not be reached while Frost was being saved, so it may or may not be in your account. Trying again does not save it twice.");
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await click(saveButton());
    expect(accounts[A_ID].builds).toHaveLength(1);
    expect(posts[1].body.transferKey).toBe(posts[0].body.transferKey);
    expect(stored(A)!.plans).toEqual([bound(FROST)]);
    expect(names(ANON)).toEqual([]);
  });

  test("deleting the local transferred copy does not forget the source's destination", async () => {
    const workspace = await import("@/lib/player-workspace");
    const backup = JSON.stringify(doc(ANON, [FROST]));
    seed(ANON, [FROST]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await click(saveButton());
    expect(workspace.deletePlan(localStorage, A, FROST.id).ok).toBe(true);
    const read = workspace.readWorkspace(localStorage, ANON);
    if (!read.ok) throw new Error("Fixture should read");
    const preview = workspace.previewImport(backup, read.workspace, workspace.sentPlans(localStorage));
    if (!preview.ok) throw new Error("Fixture should preview");
    expect(preview.preview.warnings).toContain("Frost was sent to an account from this browser before, so only that account can take it from here.");
    expect(workspace.applyImport(localStorage, ANON, preview.preview).ok).toBe(true);
    who = B_ID;
    await comeBack();
    await open();
    expect((field("Save Frost to your account") as HTMLInputElement).disabled).toBe(true);
    expect(text()).toContain("Frost was sent to another account from this browser, so it is not saved to this one as well.");
  });

  test("the record of where plans went is kept under its own key, and no backup holds it", async () => {
    const { exportBackup, readWorkspace, transferKey } = await import("@/lib/player-workspace");
    const next = transferKey(localStorage, A, FROST.id);
    if (!next.ok) throw new Error("A key should be stored");
    expect(journal()!.receipts).toMatchObject([{ planId: FROST.id, userId: A_ID, key: next.key, state: "sending" }]);
    seed(ANON, [FROST]);
    const bucket = readWorkspace(localStorage, ANON);
    const exported = bucket.ok ? exportBackup(bucket.workspace) : null;
    expect(exported?.ok && exported.text).not.toContain(next.key);
  });
});

describe("what an account has is shown to no one else", () => {
  test("a successful plan in a partly failed alt group is hidden from the signed-out library, the alt planner, backups and another account", async () => {
    refuse = { Fire: Response.json({ error: "Temporarily unavailable" }, { status: 503 }) };
    const jaina = alt({ planIds: [FROST.id, FIRE.id] });
    seed(ANON, [FROST, FIRE], [jaina]);
    await render();
    await open();
    await choose("Save Frost and Fire to your account", { Frost: "private", Fire: "private" });
    await click(saveButton());
    expect(stored(A)?.plans[0].boundTo?.userId).toBe(A_ID);
    who = null;
    const { default: DevicePlans } = await import("@/components/workspace/DevicePlans");
    await act(async () => root.render(<DevicePlans />));
    await settle();
    expect(text()).not.toContain("Frost");
    // What was not saved stays, signed out.
    expect(text()).toContain("Fire");
    const { default: AltPlanner } = await import("@/app/tools/alts/AltPlanner");
    await act(async () => root.render(<AltPlanner />));
    await settle();
    expect(text()).toContain("Jaina");
    expect(text()).toContain("Fire");
    expect(text()).not.toContain("Frost");
    const workspace = await import("@/lib/player-workspace");
    const read = workspace.readWorkspace(localStorage, ANON);
    if (!read.ok) throw new Error("Fixture should read");
    const exported = workspace.exportBackup(read.workspace, new Date(), workspace.hiddenFrom(localStorage, ANON, read.workspace));
    if (!exported.ok) throw new Error("A backup should be made");
    expect(exported.text).not.toContain(FROST.id);
    expect(JSON.parse(exported.text).alts[0].planIds).toEqual([FIRE.id]);
    // The plan itself is still stored here, for its alt, until Fire is saved too.
    expect(stored(ANON)!.plans.map((p) => p.name)).toEqual(["Frost", "Fire"]);
    const { default: LocalPlanSave } = await import("@/components/workspace/LocalPlanSave");
    await act(async () => root.render(<LocalPlanSave classSlug="mage" codes={[MAGE, null]} orders={[PLANNED, null]} defaultName="Mage plan" onMessage={() => {}} />));
    await settle();
    await click(button(/^Save on this device$/));
    expect([...(container.querySelector("select") as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["A new plan", "Replace Fire"]);
    await act(async () => root.render(<></>));
    who = B_ID;
    await act(async () => root.render(<TransferPlans />));
    await settle();
    await open();
    expect(text()).not.toContain("Frost");
    expect(text()).toContain("Jaina also uses a plan that is another account's now, so this stays here.");
    expect((field("Save Fire to your account") as HTMLInputElement).disabled).toBe(true);
  });
});

describe("the missing spend-order migration", () => {
  test("is known by its code, and by its message alone from a site without the code", async () => {
    ordersMissing = true;
    for (const messageOnly of [false, true]) {
      ordersMessageOnly = messageOnly;
      localStorage.clear();
      seed(ANON, [FROST]);
      const before = buckets();
      await act(async () => root.render(<></>));
      await render();
      await open();
      await choose("Save Frost to your account", { Frost: "private" });
      await click(saveButton());
      expect(alerts()).toContain("Saving spend orders isn't available yet, so no plans were saved to your account. They stay on this device as they were, spend orders included.");
      expect(buckets()).toEqual(before);
      expect(journal()!.receipts).toMatchObject([{ planId: FROST.id, state: "failed", reason: "orders_unavailable" }]);
    }
  });
});

describe("one lock for every writer", () => {
  /** Web Locks that record each name asked for and whether two holders ever overlapped. */
  function recordLocks() {
    const names: string[] = [];
    let held = 0;
    let overlapped = false;
    let queue: Promise<unknown> = Promise.resolve();
    const request = (name: string, task: () => unknown) => {
      names.push(name);
      const run = queue.then(async () => {
        held++;
        if (held > 1) overlapped = true;
        try { return await task(); } finally { held--; }
      });
      queue = run.catch(() => undefined);
      return run;
    };
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
    return { names, overlapped: () => overlapped };
  }

  /** The site's source with comments and the text of strings blanked out, so only code is left, at the same offsets. */
  function codeOnly(source: string): string {
    const out = source.split("");
    const blank = (from: number, to: number) => { for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "; };
    const stack: string[] = [];
    let i = 0;
    while (i < source.length) {
      const c = source[i];
      const top = stack[stack.length - 1];
      if (top === "`") {
        if (c === "\\") { blank(i, i + 2); i += 2; continue; }
        if (c === "`") { stack.pop(); i++; continue; }
        if (c === "$" && source[i + 1] === "{") { stack.push("${"); i += 2; continue; }
        blank(i, i + 1);
        i++;
        continue;
      }
      if (c === "/" && source[i + 1] === "/") { const end = source.indexOf("\n", i); const stop = end < 0 ? source.length : end; blank(i, stop); i = stop; continue; }
      if (c === "/" && source[i + 1] === "*") { const end = source.indexOf("*/", i + 2); const stop = end < 0 ? source.length : end + 2; blank(i, stop); i = stop; continue; }
      if (c === "\"" || c === "'") {
        let j = i + 1;
        while (j < source.length && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
        blank(i + 1, j);
        i = j + 1;
        continue;
      }
      if (c === "`") { stack.push("`"); i++; continue; }
      if (c === "{" && stack.length > 0) { stack.push("{"); i++; continue; }
      if (c === "}" && (top === "{" || top === "${")) { stack.pop(); i++; continue; }
      i++;
    }
    return out.join("");
  }

  /** The functions that write the plan buckets or the record of sends, by the module that exports them. */
  const WRITERS: Record<string, string[]> = {
    "@/lib/player-workspace": [
      "savePlan", "editPlan", "copyPlan", "deletePlan", "applyImport", "update", "bindTransferred", "settleTransferred",
      "transferKey", "receiptSaved", "receiptFailed", "rememberCharacter", "characterRefused",
    ],
    "@/lib/alt-workspace": ["saveAlt", "deleteAlt", "changeAlts"],
    "@/lib/alt-import": ["applyAltImport"],
  };
  /** The modules that are the writing itself: they run inside the lock their callers take. */
  const LAYER = ["lib/player-workspace.ts", "lib/alt-workspace.ts", "lib/alt-import.ts"];

  // What these scans read is the source as written, by name, so some forms pass them unseen. That is accepted: they
  // guard against a plain unlocked write or nested lock, and prove nothing about these forms:
  // - a writer imported under another name (`import { savePlan as keep }`) or through `import * as`;
  // - a writer reached through a dynamic import (`await import(...)`);
  // - a writer, or a function that takes the lock, passed around and called through a variable or a property;
  // - a function that takes the lock declared in one module and called inside a lock in another.

  /** The site's source files, tests aside, each with its code alone (codeOnly). */
  function sources() {
    const src = resolve(import.meta.dirname, "../..");
    return (readdirSync(src, { recursive: true }) as string[])
      .map((entry) => ({ entry, file: relative(src, join(src, entry)).replace(/\\/g, "/") }))
      .filter(({ file }) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .map(({ entry, file }) => {
        const source = readFileSync(join(src, entry), "utf8");
        return { file, source, code: codeOnly(source) };
      });
  }

  /** Each withWorkspaceLock(…) call in this code, from its name to its closing parenthesis. */
  function lockSpans(code: string): Array<[number, number]> {
    const spans: Array<[number, number]> = [];
    for (const m of code.matchAll(/\bwithWorkspaceLock\s*\(/g)) {
      let depth = 0;
      for (let k = m.index! + m[0].length - 1; k < code.length; k++) {
        if (code[k] === "(") depth++;
        else if (code[k] === ")" && --depth === 0) { spans.push([m.index!, k]); break; }
      }
    }
    return spans;
  }

  /** Every call of a writer in the site's source outside the writing layer, and those not inside withWorkspaceLock(…). */
  function scan() {
    const calls: Array<{ file: string; name: string; locked: boolean }> = [];
    for (const { file, source, code } of sources()) {
      if (LAYER.includes(file)) continue;
      const names = new Set<string>();
      for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
        const writers = WRITERS[m[2]];
        if (!writers) continue;
        for (const part of m[1].split(",")) {
          const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
          if (writers.includes(name)) names.add(name);
        }
      }
      const spans = lockSpans(code);
      const inside = (at: number) => spans.some(([from, to]) => from < at && at < to);
      for (const name of names) {
        for (const m of code.matchAll(new RegExp(`(?<![\\w.])${name}\\s*\\(`, "g"))) calls.push({ file, name, locked: inside(m.index!) });
      }
      // A bucket cleared by hand is a write too.
      for (const m of code.matchAll(/\.removeItem\s*\(\s*bucketKey\s*\(/g)) calls.push({ file, name: "removeItem(bucketKey(…))", locked: inside(m.index!) });
    }
    return calls;
  }

  /** Where the declaration at `from` ends: at its first `;` outside brackets, at the end of the line its block closes
   *  on, or where the block around it closes. */
  function declarationEnd(code: string, from: number): number {
    let depth = 0;
    let closed = false;
    for (let k = from; k < code.length; k++) {
      const c = code[k];
      if (c === "(" || c === "[" || c === "{") { depth++; closed = false; continue; }
      if (c === ")" || c === "]" || c === "}") {
        if (--depth < 0) return k;
        closed = depth === 0 && c === "}";
        continue;
      }
      if (depth === 0 && (c === ";" || (c === "\n" && closed))) return k;
      if (c !== " " && c !== "\t" && c !== "\r") closed = false;
    }
    return code.length;
  }

  /**
   * In each file that takes the lock: what takes it (withWorkspaceLock, and each function or value declared there whose
   * declaration does), and each call of one of them made inside a lock already held, which would wait on itself.
   */
  function nesting() {
    const takers: Record<string, string[]> = {};
    const nested: Array<{ file: string; name: string }> = [];
    for (const { file, code } of sources()) {
      const spans = lockSpans(code);
      if (spans.length === 0) continue;
      const names = new Set(["withWorkspaceLock"]);
      for (const m of code.matchAll(/\b(?:const|let|function)\s+([A-Za-z_]\w*)/g)) {
        const end = declarationEnd(code, m.index!);
        if (spans.some(([from]) => from > m.index! && from < end)) names.add(m[1]);
      }
      takers[file] = [...names].sort();
      for (const [from, to] of spans) {
        for (const name of names) {
          const calls = code.slice(from + 1, to).match(new RegExp(`(?<![\\w.])${name}\\s*\\(`, "g")) ?? [];
          nested.push(...calls.map(() => ({ file, name })));
        }
      }
    }
    return { takers, nested };
  }

  test("without Web Locks a transfer is refused before anything is allocated or sent", async () => {
    delete (navigator as { locks?: unknown }).locks;
    seed(ANON, [FROST]);
    const before = device();
    await render();
    await open();
    expect(alerts()).toContain("This browser can't move plans safely; try a current browser.");
    expect(accountReads()).toEqual([]);
    expect(posts).toEqual([]);
    expect(device()).toEqual(before);
    expect(button(/^Save to your account$/)).toBeUndefined();
  });

  test("every writer of the plan buckets and the record of sends holds the workspace lock", () => {
    const calls = scan();
    expect(calls.filter((c) => !c.locked)).toEqual([]);
    // The scan finds the writers where they are: Plans on this device, the transfer, Save on this device, the alt
    // planner and the Everloot.lua import.
    expect([...new Set(calls.map((c) => c.file))].sort()).toEqual([
      "app/tools/alts/AltPlanner.tsx", "app/tools/alts/ReadSaveFile.tsx", "components/workspace/DevicePlans.tsx",
      "components/workspace/LocalPlanSave.tsx", "components/workspace/TransferPlans.tsx",
    ]);
    expect(calls.length).toBeGreaterThanOrEqual(15);
  });

  test("Save on this device and the alt planner write under that lock, one at a time", async () => {
    const lock = recordLocks();
    who = null;
    const { default: LocalPlanSave } = await import("./LocalPlanSave");
    await act(async () => root.render(<LocalPlanSave classSlug="mage" codes={[MAGE, null]} orders={[PLANNED, null]} defaultName="Mage plan" onMessage={() => {}} />));
    await settle();
    await click(button(/^Save on this device$/));
    await click(button(/^Save plan$/));
    expect(names(ANON)).toEqual(["Mage plan"]);
    expect(lock.names).toEqual(["everloot:player-workspace"]);
    const { default: AltPlanner } = await import("@/app/tools/alts/AltPlanner");
    await act(async () => root.render(<AltPlanner />));
    await settle();
    await set(field("Name") as HTMLInputElement, "Thrall");
    await click(button(/^Add alt$/));
    expect(stored(ANON)!.alts.map((a) => a.name)).toEqual(["Thrall"]);
    expect(lock.names).toEqual(["everloot:player-workspace", "everloot:player-workspace"]);
    expect(lock.overlapped()).toBe(false);
  });

  test("a task holding the lock that asks for it again fails at once rather than wait on itself, and the lock is free after", async () => {
    const { withWorkspaceLock } = await import("@/lib/player-workspace");
    // Web Locks are not re-entrant: in a browser, and with the stand-in here, this call would wait for good.
    await expect(withWorkspaceLock(() => withWorkspaceLock(() => "inside"))).rejects.toThrow("already holds it");
    await expect(withWorkspaceLock(async () => withWorkspaceLock(() => "inside"))).rejects.toThrow("already holds it");
    await expect(withWorkspaceLock(() => "next")).resolves.toBe("next");
    // Without Web Locks nothing would wait, so nothing would hide the mistake: it fails the same way.
    delete (navigator as { locks?: unknown }).locks;
    await expect(withWorkspaceLock(() => withWorkspaceLock(() => "inside"))).rejects.toThrow("already holds it");
  });

  test("no task holding the lock asks for it again: nothing in the site takes it inside a lock, and the library never takes it", () => {
    const { takers, nested } = nesting();
    expect(nested).toEqual([]);
    // The scan knows the transfer's helpers that take the lock, so a call of one inside a lock would be found.
    expect(takers["components/workspace/TransferPlans.tsx"]).toEqual(expect.arrayContaining(["characterFor", "step", "withWorkspaceLock"]));
    const layer = sources().filter((s) => LAYER.includes(s.file)).map((s) => [s.file, lockSpans(s.code).length]);
    expect(layer.sort()).toEqual([...LAYER].sort().map((file) => [file, 0]));
  });
});

describe("records that are never dropped", () => {
  const FULL = "This browser keeps a record of every plan it sends to an account, and the record is full, so no new plan can be sent from here. Plans sent before can still be tried again.";
  /** Fills the record of sends up to its limit with saved plans of A's. */
  async function fill(count: number) {
    const record = journal() ?? { format: "everloot.transfers", version: 1, receipts: [] as Array<Record<string, unknown>>, characters: [] };
    record.receipts.push(...Array.from({ length: count }, (_, i) => ({ planId: id(5000 + i), userId: A_ID, key: `k${String(i).padStart(20, "0")}`, state: "saved", reason: null, content: "00000000", at: AT })));
    localStorage.setItem("everloot:transfers", JSON.stringify(record));
  }

  test("at capacity an unresolved key stays for its retry, and a new plan is refused rather than any record dropped", async () => {
    const { TRANSFERS_KEPT, transferKey } = await import("@/lib/player-workspace");
    const original = transferKey(localStorage, A, FROST.id);
    if (!original.ok) throw new Error(original.message);
    await fill(TRANSFERS_KEPT - 1);
    expect(transferKey(localStorage, A, id(99999))).toMatchObject({ ok: false, message: FULL });
    expect(transferKey(localStorage, A, FROST.id)).toMatchObject({ ok: true, key: original.key });
    expect(journal()!.receipts).toHaveLength(TRANSFERS_KEPT);
    expect(journal()!.receipts[0]).toMatchObject({ planId: FROST.id, key: original.key, state: "sending" });
  });

  test("at capacity a destination is kept after its copy here is deleted and a backup restored, and another account is refused it", async () => {
    const { TRANSFERS_KEPT, contentDigest, receiptSaved, transferKey } = await import("@/lib/player-workspace");
    const original = transferKey(localStorage, A, FROST.id);
    if (!original.ok) throw new Error(original.message);
    expect(receiptSaved(localStorage, A, FROST.id, original.key, await contentDigest(FROST)).ok).toBe(true);
    await fill(TRANSFERS_KEPT - 1);
    expect(transferKey(localStorage, A, id(99999))).toMatchObject({ ok: false, message: FULL });
    seed(ANON, [FROST]);
    expect(transferKey(localStorage, B, FROST.id)).toMatchObject({ ok: false, error: "other-owner" });
    expect(journal()!.receipts[0]).toMatchObject({ planId: FROST.id, userId: A_ID, state: "saved" });
  });

  test("at capacity the panel says why a new plan is not sent, and sends nothing", async () => {
    const { TRANSFERS_KEPT } = await import("@/lib/player-workspace");
    await fill(TRANSFERS_KEPT);
    seed(ANON, [FROST]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await click(saveButton());
    expect(alerts()).toContain(FULL);
    expect(posts).toEqual([]);
    expect(journal()!.receipts).toHaveLength(TRANSFERS_KEPT);
  });

  test("a definite refusal marks the key failed and keeps it, so the retry, or another sender, sends the same key", async () => {
    const { receiptFailed, transferKey } = await import("@/lib/player-workspace");
    const first = transferKey(localStorage, A, FROST.id);
    const second = transferKey(localStorage, A, FROST.id);
    if (!first.ok || !second.ok) throw new Error("Expected two allocated receipts");
    expect(second.key).toBe(first.key);
    // Sender 2 reached the server and lost its answer. Sender 1 gets an owner-mismatch 409.
    expect(receiptFailed(localStorage, A, FROST.id, first.key, "account_mismatch").ok).toBe(true);
    expect(journal()!.receipts).toEqual([{ planId: FROST.id, userId: A_ID, key: first.key, state: "failed", reason: "account_mismatch", content: null, at: expect.any(String) }]);
    const retry = transferKey(localStorage, A, FROST.id);
    expect(retry).toMatchObject({ ok: true, key: second.key });
    expect(journal()!.receipts[0]).toMatchObject({ state: "sending", reason: null });
  });

  test("overlapping UI sends retain the key after the first sender's 409 and the second sender's lost success", async () => {
    installLocks();
    seed(ANON, [FROST]);
    let releaseFirst = () => {};
    const firstAnswer = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const workingFetch = globalThis.fetch;
    let buildAttempts = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/me/builds" && init?.method === "POST") {
        buildAttempts++;
        if (buildAttempts === 1) {
          // Another tab switched to B just for this request, then back to A.
          who = B_ID;
          const response = await workingFetch(input, init);
          who = A_ID;
          await firstAnswer;
          return response;
        }
        const response = await workingFetch(input, init);
        if (buildAttempts === 2) throw new TypeError("Lost second sender's committed response");
        return response;
      }
      return workingFetch(input, init);
    });
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await click(saveButton());
    const firstRoot = root;
    const firstContainer = container;
    const secondContainer = document.createElement("div");
    document.body.append(secondContainer);
    const secondRoot = createRoot(secondContainer);
    try {
      root = secondRoot;
      container = secondContainer;
      await render();
      await open();
      await choose("Save Frost to your account", { Frost: "private" });
      await click(saveButton());
      expect(accounts[A_ID].builds).toHaveLength(1);
      expect(posts[0].body.transferKey).toBe(posts[1].body.transferKey);
    } finally {
      await act(async () => secondRoot.unmount());
      secondContainer.remove();
      root = firstRoot;
      container = firstContainer;
      releaseFirst();
      await settle();
    }
    await act(async () => root.render(<></>));
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await click(saveButton());
    expect(accounts[A_ID].builds).toHaveLength(1);
  });
});

describe("content decides, never dates", () => {
  test("a clock moving backwards cannot discard a changed source copy when binding the sent snapshot", async () => {
    const { editPlan, hiddenFrom, readWorkspace } = await import("@/lib/player-workspace");
    // A restored backup's plan dated Nov 1, edited here while the clock says Oct 27.
    const sent = { ...FROST, updatedAt: "2026-11-01T12:00:00.000Z" };
    seed(ANON, [sent]);
    const edit = editPlan(localStorage, ANON, sent.id, { name: sent.name, notes: "Unsent edit on this device" }, new Date("2026-10-27T12:00:00.000Z"));
    expect(edit.ok).toBe(true);
    const result = bindTransferred(localStorage, { owner: A, planIds: [sent.id], plans: [sent] }, { ok: true, userId: A_ID, planIds: [sent.id] });
    expect(result.ok).toBe(true);
    expect(stored(ANON)?.plans[0]?.notes).toBe("Unsent edit on this device");
    // Not the account's either: the edit is shown signed out, unsaved.
    const read = readWorkspace(localStorage, ANON);
    if (!read.ok) throw new Error(read.message);
    expect(hiddenFrom(localStorage, ANON, read.workspace).has(sent.id)).toBe(false);
  });
});

describe("one character per alt and account", () => {
  test("a lost character response reuses the already-created character on retry", async () => {
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST], [jaina]);
    const workingFetch = globalThis.fetch;
    let loseCharacter = true;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await workingFetch(input, init);
      if (String(input) === "/api/me/characters" && init?.method === "POST" && loseCharacter) {
        loseCharacter = false;
        throw new TypeError("Lost character response after commit");
      }
      return response;
    });
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await set(field("Character for Frost"), `alt:${jaina.id}`);
    await click(saveButton());
    expect(accounts[A_ID].characters).toHaveLength(1);
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await set(field("Character for Frost"), `alt:${jaina.id}`);
    await click(saveButton());
    // The retry reads a digest before saving; wait for its outcome, not five turns.
    await vi.waitFor(async () => {
      await settle();
      expect(text()).toContain("Saved 1 plan to your account.");
    }, { timeout: 5_000 });
    expect(accounts[A_ID].characters).toHaveLength(1);
    expect(posts.at(-1)!.body).toMatchObject({ name: "Frost", characterId: accounts[A_ID].characters[0].id });
  });

  test("two previews of the same alt do not create two characters during overlapping sends", async () => {
    installLocks();
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST], [jaina]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await set(field("Character for Frost"), `alt:${jaina.id}`);
    const firstRoot = root;
    const firstContainer = container;
    const secondContainer = document.createElement("div");
    document.body.append(secondContainer);
    const secondRoot = createRoot(secondContainer);
    let release = () => {};
    try {
      root = secondRoot;
      container = secondContainer;
      await render();
      await open();
      await choose("Save Frost to your account", { Frost: "private" });
      await set(field("Character for Frost"), `alt:${jaina.id}`);
      root = firstRoot;
      container = firstContainer;
      release = hold("POST /api/me/characters");
      await click(saveButton());
      root = secondRoot;
      container = secondContainer;
      await click(saveButton());
    } finally {
      await act(async () => secondRoot.unmount());
      secondContainer.remove();
      root = firstRoot;
      container = firstContainer;
      release();
      await settle();
    }
    expect(accounts[A_ID].characters).toHaveLength(1);
  });

  test("a character on the account that matches the one this transfer would make is used, not made again", async () => {
    accounts[A_ID].characters = [{ id: serverId(80), name: "Jaina", classSlug: "mage", realm: null, note: null }];
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST], [jaina]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await set(field("Character for Frost"), `alt:${jaina.id}`);
    await click(saveButton());
    expect(posts.map((p) => p.url)).toEqual(["/api/me/builds"]);
    expect(posts[0].body.characterId).toBe(serverId(80));
    expect(accounts[A_ID].characters).toHaveLength(1);
  });
});

describe("focus with nothing to choose", () => {
  test("a panel that cannot open keeps the focus on its Cancel, as its opener goes, whether or not it can be tried again", async () => {
    delete (navigator as { locks?: unknown }).locks;
    seed(ANON, [FROST]);
    await render();
    button(/^Choose plans to save to your account$/)!.focus();
    await open();
    expect(alerts()).toContain("This browser can't move plans safely; try a current browser.");
    expect(document.activeElement).toBe(button(/^Cancel$/));
    // Cancel gives it back to the opener; an account that cannot be read takes it to Cancel again.
    await click(button(/^Cancel$/));
    expect(document.activeElement).toBe(button(/^Choose plans to save to your account$/));
    installLocks();
    readAnswer = Response.json({ error: "Unavailable" }, { status: 503 });
    await open();
    expect(alerts()).toContain("Your account could not be read, so nothing was sent.");
    expect(document.activeElement).toBe(button(/^Cancel$/));
  });

  test("an all-refused preview still gives keyboard focus somewhere in the panel, and each refusal describes its control", async () => {
    seed(ANON, [{ ...FROST, notes: "Changed", updatedAt: "2026-10-27T12:00:00.000Z" }]);
    seed(A, [{ ...FROST, boundTo: { userId: A_ID, at: AT } }]);
    await render();
    button(/^Choose plans to save to your account$/)!.focus();
    await open();
    const box = field("Save Frost to your account") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(button(/^Cancel$/));
    const described = (box.getAttribute("aria-describedby") ?? "").split(" ").map((ref) => document.getElementById(ref)?.textContent ?? "").join(" ");
    expect(described).toContain("Frost is in your account already, saved Oct 21, 2026, and the copy here differs from it.");
  });
});

describe("a request with no answer", () => {
  /** The site, but the first request `which` picks reaches it and its answer never comes back: only giving up on it
   *  ends the wait. */
  function silence(which: (url: string, init?: RequestInit) => boolean) {
    const site = globalThis.fetch;
    let silent = true;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (silent && which(String(input), init)) {
        silent = false;
        await site(input, init);
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
      }
      return site(input, init);
    });
  }

  test("a build save with no answer in 20 seconds may or may not have landed: its key stays, and trying again saves it once", async () => {
    seed(ANON, [FROST]);
    silence((url, init) => url === "/api/me/builds" && init?.method === "POST");
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () => { saveButton()!.click(); });
      await pump(() => posts.length === 1, "the save");
      await act(async () => { await vi.advanceTimersByTimeAsync(19_999); });
      expect(saveButton()!.getAttribute("aria-busy")).toBe("true");
      expect(alerts()).not.toContain("did not answer");
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      await pump(() => alerts().includes("did not answer"), "giving up");
    } finally {
      vi.useRealTimers();
    }
    expect(alerts()).toContain("Your account did not answer within 20 seconds while Frost was being saved, so it may or may not be in your account. Trying again does not save it twice.");
    // Neither a success nor a refusal: the key stays as it was sent, and the plan stays here.
    expect(journal()!.receipts).toMatchObject([{ planId: FROST.id, key: posts[0].body.transferKey, state: "sending" }]);
    expect(stored(ANON)!.plans).toEqual([FROST]);
    expect(stored(A)).toBeNull();
    // The site made it: trying again sends the same key, and the site answers with that build.
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await click(saveButton());
    expect(posts.map((p) => p.body.transferKey)).toEqual([posts[0].body.transferKey, posts[0].body.transferKey]);
    expect(accounts[A_ID].builds).toHaveLength(1);
    expect(text()).toContain("Saved 1 plan to your account.");
  });

  test("an answer that stops coming part way is no answer either: past 20 seconds the save is never taken as made", async () => {
    seed(ANON, [FROST]);
    const site = globalThis.fetch;
    let stall = true;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await site(input, init);
      if (!stall || String(input) !== "/api/me/builds" || init?.method !== "POST") return response;
      stall = false;
      // The site made the build and its answer began, a 201, but the rest of it never comes.
      const body = new ReadableStream({ start(stream) { init.signal?.addEventListener("abort", () => stream.error(new DOMException("Aborted", "AbortError"))); } });
      return new Response(body, { status: response.status, headers: { "content-type": "application/json" } });
    });
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () => { saveButton()!.click(); });
      await pump(() => posts.length === 1, "the save");
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      await pump(() => alerts().includes("did not answer"), "giving up");
    } finally {
      vi.useRealTimers();
    }
    expect(alerts()).toContain("Your account did not answer within 20 seconds while Frost was being saved, so it may or may not be in your account.");
    expect(journal()!.receipts).toMatchObject([{ planId: FROST.id, key: posts[0].body.transferKey, state: "sending" }]);
    expect(stored(ANON)!.plans).toEqual([FROST]);
    expect(stored(A)).toBeNull();
  });

  test("a character request with no answer in 20 seconds gives the lock back, may or may not have made it, and the next try finds it", async () => {
    const { withWorkspaceLock } = await import("@/lib/player-workspace");
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST], [jaina]);
    silence((url, init) => url === "/api/me/characters" && init?.method === "POST");
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await set(field("Character for Frost"), `alt:${jaina.id}`);
    let after = false;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () => { saveButton()!.click(); });
      await pump(() => posts.length === 1, "the character request");
      // Another change to the plans here waits for the lock the request holds, and gets it once the request is given up.
      const next = withWorkspaceLock(() => { after = true; });
      await act(async () => { await vi.advanceTimersByTimeAsync(19_999); });
      expect(after).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      await pump(() => after, "the lock");
      await next;
      await pump(() => alerts().includes("did not answer"), "giving up");
    } finally {
      vi.useRealTimers();
    }
    expect(alerts()).toContain("Your account did not answer within 20 seconds while the character Jaina was being made for Frost, so it may or may not have been made. Frost was not sent.");
    expect(accounts[A_ID].characters).toHaveLength(1);
    expect(journal()!.characters).toMatchObject([{ altId: jaina.id, userId: A_ID, characterId: null, label: { name: "Jaina" } }]);
    // The next try reads the account's characters again, finds Jaina by its label, and files Frost under it.
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await set(field("Character for Frost"), `alt:${jaina.id}`);
    await click(saveButton());
    expect(accounts[A_ID].characters).toHaveLength(1);
    expect(posts.map((p) => p.url)).toEqual(["/api/me/characters", "/api/me/builds"]);
    expect(posts[1].body.characterId).toBe(accounts[A_ID].characters[0].id);
  });

  test("a read of the account's characters with no answer in 20 seconds gives the lock back, and nothing is made or sent", async () => {
    const { withWorkspaceLock } = await import("@/lib/player-workspace");
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST], [jaina]);
    let reads = 0;
    // The panel's own read as it opens is answered; the transfer's read of the characters is not.
    silence((url, init) => url === "/api/me/builds" && (init?.method ?? "GET") === "GET" && ++reads === 2);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await set(field("Character for Frost"), `alt:${jaina.id}`);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () => { saveButton()!.click(); });
      await pump(() => reads === 2, "the read");
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      await pump(() => alerts().includes("could not be read"), "giving up");
    } finally {
      vi.useRealTimers();
    }
    expect(alerts()).toContain("Your account's characters could not be read, so Frost was not sent.");
    expect(posts).toEqual([]);
    expect(accounts[A_ID].characters).toEqual([]);
    expect(journal()).toBeNull();
    await expect(withWorkspaceLock(() => "free")).resolves.toBe("free");
  });
});

describe("content compared exactly", () => {
  // Two notes that the 32-bit fingerprint receipts once kept cannot tell apart, for this Frost.
  const SENT_NOTE = "For raids 1thyt39 8hcfmp";
  const OTHER_NOTE = "For raids 5gxikf gj9jb";

  test("content is compared exactly: key order aside, an empty note and a missing one alike, a missing order as none", async () => {
    const { planContent } = await import("@/lib/player-workspace");
    const p = { ...FROST, order: null };
    const reversed = Object.fromEntries(Object.entries(p).reverse()) as unknown as LocalPlan;
    expect(planContent(reversed)).toBe(planContent(p));
    expect(planContent({ name: p.name, notes: null, code: p.code, code2: null })).toBe(planContent(p));
    expect(planContent({ ...p, notes: "Unsent note" })).not.toBe(planContent(p));
  });

  test("two notes the old 32-bit fingerprint cannot tell apart are told apart: the edit here is never removed as the copy sent", async () => {
    const { editPlan, legacyFingerprint, planContent } = await import("@/lib/player-workspace");
    const sent = { ...FROST, notes: SENT_NOTE };
    expect(legacyFingerprint({ ...sent, notes: OTHER_NOTE })).toBe(legacyFingerprint(sent));
    expect(planContent({ ...sent, notes: OTHER_NOTE })).not.toBe(planContent(sent));
    seed(ANON, [sent]);
    expect(editPlan(localStorage, ANON, sent.id, { name: sent.name, notes: OTHER_NOTE }).ok).toBe(true);
    expect(bindTransferred(localStorage, { owner: A, planIds: [sent.id], plans: [sent] }, { ok: true, userId: A_ID, planIds: [sent.id] }).ok).toBe(true);
    expect(stored(ANON)!.plans.map((p) => p.notes)).toEqual([OTHER_NOTE]);
    expect(stored(A)!.plans.map((p) => p.notes)).toEqual([SENT_NOTE]);
  });

  test("a receipt keeps a SHA-256 fingerprint of what the site saved", async () => {
    const { contentDigest } = await import("@/lib/player-workspace");
    seed(ANON, [FROST]);
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await click(saveButton());
    expect(journal()!.receipts).toMatchObject([{ planId: FROST.id, state: "saved", content: await contentDigest(FROST) }]);
    expect(journal()!.receipts[0].content).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("a receipt's old 32-bit fingerprint never stands for the content: the plan is asked for again by its key, and the edit here stays", async () => {
    const { legacyFingerprint, transferKey } = await import("@/lib/player-workspace");
    const sent = { ...FROST, notes: SENT_NOTE };
    const edited = { ...sent, notes: OTHER_NOTE };
    seed(ANON, [edited]);
    // An earlier version saved Frost with the first note, under this key, and kept the fingerprint the edit here shares.
    const key = transferKey(localStorage, A, FROST.id);
    if (!key.ok) throw new Error(key.message);
    const record = journal()!;
    record.receipts[0] = { ...record.receipts[0], state: "saved", content: legacyFingerprint(sent) };
    localStorage.setItem("everloot:transfers", JSON.stringify(record));
    const build = { id: serverId(90), slug: "Slug0090", name: sent.name, notes: SENT_NOTE, code: sent.code, code2: null, order: sent.order, order2: null, shared: false, showName: false, characterId: null, link: null };
    keyed[A_ID] = { [key.key]: build };
    accounts[A_ID].builds = [build];
    await render();
    await open();
    expect(text()).not.toContain("Frost is in your account already");
    await choose("Save Frost to your account", { Frost: "private" });
    await click(saveButton());
    // Sent again by its key, the site answers with what it has, and that differs from the copy here, which stays.
    expect(posts.map((p) => p.body.transferKey)).toEqual([key.key]);
    expect(accounts[A_ID].builds).toHaveLength(1);
    expect(text()).toContain("Frost was saved to your account before, and the copy here differs from it now, so the copy here stays, signed out.");
    expect(stored(ANON)!.plans).toEqual([edited]);
    expect(stored(A)).toBeNull();
  });

  test("a group whose plan the account saved, and renamed here since, moves whole in one transfer with the plan still to send", async () => {
    const { contentDigest, receiptSaved, transferKey } = await import("@/lib/player-workspace");
    const jaina = alt({ planIds: [FROST.id, FIRE.id] });
    const renamed = { ...FROST, name: "Renamed on the account side", boundTo: { userId: A_ID, at: AT } };
    seed(ANON, [FROST, FIRE], [jaina]);
    seed(A, [renamed]);
    const key = transferKey(localStorage, A, FROST.id);
    if (!key.ok) throw new Error(key.message);
    expect(receiptSaved(localStorage, A, FROST.id, key.key, await contentDigest(FROST)).ok).toBe(true);
    await render();
    await open();
    expect(text()).toContain("Frost is in your account already (saved");
    await choose("Save Frost and Fire to your account", { Fire: "private" });
    await click(saveButton());
    expect(posts.map((p) => p.body.name)).toEqual(["Fire"]);
    expect(stored(ANON)).toMatchObject({ plans: [], alts: [] });
    expect(stored(A)).toMatchObject({ plans: [renamed, bound(FIRE)], alts: [jaina] });
  });
});

describe("a character asked for and not heard back on", () => {
  /** Frost chosen, private, under a new character from `jaina`. */
  async function prepare(jaina: LocalAlt) {
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await set(field("Character for Frost"), `alt:${jaina.id}`);
  }
  /** The site, but the first character request's answer is lost on its way back: the site makes that character only
   *  when `late` is called, if ever. */
  function lost() {
    const site = globalThis.fetch;
    const state = { asked: false, late: () => {} };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (state.asked || String(input) !== "/api/me/characters" || init?.method !== "POST") return site(input, init);
      state.asked = true;
      state.late = () => { void site(input, init); };
      throw new TypeError("The connection dropped before the answer came");
    });
    return state;
  }
  /** The page's two clocks, faked and standing still until moved: the wall clock (Date), which `vi.setSystemTime`
   *  corrects as a computer's clock is corrected, and the monotonic one (performance), which only time passing moves,
   *  as `vi.advanceTimersByTime` moves both. */
  const fakeClocks = () => vi.useFakeTimers({ toFake: ["Date", "performance"] });
  const WAIT = "The last attempt may still finish; try again in a couple of minutes.";

  test("a retry looks for the character by the label the last try asked with, before any change made to it since", async () => {
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST], [jaina]);
    const site = globalThis.fetch;
    let lose = true;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await site(input, init);
      if (String(input) === "/api/me/characters" && lose) { lose = false; throw new TypeError("Lost after the character was made"); }
      return response;
    });
    await render();
    await prepare(jaina);
    await click(saveButton());
    expect(accounts[A_ID].characters).toEqual([expect.objectContaining({ name: "Jaina", note: null })]);
    await prepare(jaina);
    expect(text()).toContain("Your last try asked your account for the character Jaina and did not hear back.");
    await set(field("Note (optional)"), "Frost for raids");
    await click(saveButton());
    // The retry lists the account, reads a digest and then saves: wait for its outcome, not a fixed number of turns.
    await vi.waitFor(async () => {
      await settle();
      expect(text()).toContain("Frost was filed under Jaina, the character your last try made on your account, which stays as that try made it: the changes made here were not used.");
    }, { timeout: 5_000 });
    expect(accounts[A_ID].characters).toHaveLength(1);
    expect(posts.at(-1)!.body).toMatchObject({ name: "Frost", characterId: accounts[A_ID].characters[0].id });
    expect(journal()!.characters).toMatchObject([{ altId: jaina.id, characterId: accounts[A_ID].characters[0].id, label: { name: "Jaina", note: null } }]);
  });

  test("inside two minutes of a try that got no answer, a retry that does not find its character makes none; once the site makes it, it is used", async () => {
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST], [jaina]);
    fakeClocks();
    try {
      const request = lost();
      await render();
      await prepare(jaina);
      await click(saveButton());
      expect(alerts()).toContain("so it may or may not have been made.");
      vi.advanceTimersByTime(60_000);
      await prepare(jaina);
      await click(saveButton());
      expect(alerts()).toContain(`The character Jaina was asked for on your account for Frost and is not there yet. ${WAIT}`);
      expect(posts).toEqual([]);
      // The site makes it after all, late.
      request.late();
      expect(accounts[A_ID].characters).toHaveLength(1);
      await prepare(jaina);
      await click(saveButton());
      expect(accounts[A_ID].characters).toHaveLength(1);
      expect(posts.map((p) => p.url)).toEqual(["/api/me/characters", "/api/me/builds"]);
      expect(posts[1].body.characterId).toBe(accounts[A_ID].characters[0].id);
      expect(text()).toContain("Saved 1 plan to your account.");
    } finally {
      vi.useRealTimers();
    }
  });

  test("past two minutes, a retry reads the account once more and makes the character only while it is still not there", async () => {
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST], [jaina]);
    fakeClocks();
    try {
      // Taken and never made: the site never handles it.
      lost();
      await render();
      await prepare(jaina);
      await click(saveButton());
      vi.advanceTimersByTime(119_000);
      await prepare(jaina);
      await click(saveButton());
      expect(alerts()).toContain(WAIT);
      expect(posts).toEqual([]);
      vi.advanceTimersByTime(2_000);
      await prepare(jaina);
      await click(saveButton());
      expect(accounts[A_ID].characters).toHaveLength(1);
      expect(posts.map((p) => p.url)).toEqual(["/api/me/characters", "/api/me/builds"]);
      expect(text()).toContain("Saved 1 plan to your account.");
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([["back", -180_000], ["forward", 180_000]])("a wall clock put %s three minutes after a request got no answer does not end its wait: one character", async (_, correction) => {
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST], [jaina]);
    fakeClocks();
    try {
      const request = lost();
      await render();
      await prepare(jaina);
      await click(saveButton());
      expect(alerts()).toContain("so it may or may not have been made.");
      // The computer's clock is corrected at once; no time passes on the page's own clock.
      vi.setSystemTime(Date.now() + correction);
      await prepare(jaina);
      await click(saveButton());
      expect(alerts()).toContain(WAIT);
      expect(posts).toEqual([]);
      // The first request is made after all, and is the one used.
      request.late();
      await prepare(jaina);
      await click(saveButton());
      expect(accounts[A_ID].characters).toHaveLength(1);
      expect(posts.map((p) => p.url)).toEqual(["/api/me/characters", "/api/me/builds"]);
      expect(posts[1].body.characterId).toBe(accounts[A_ID].characters[0].id);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a request with no answer stored at a time still to come, read back after a reload, is waited out from when the page meets it: one character", async () => {
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST], [jaina]);
    fakeClocks();
    try {
      // Left by an earlier page that never heard back, at a time three minutes ahead of the clock now, since put back.
      const label = { name: "Jaina", classSlug: "mage", realm: null, note: null };
      localStorage.setItem("everloot:transfers", JSON.stringify({ format: "everloot.transfers", version: 1, receipts: [],
        characters: [{ altId: jaina.id, userId: A_ID, characterId: null, label, at: new Date(Date.now() + 180_000).toISOString() }] }));
      await render();
      await prepare(jaina);
      expect(text()).toContain("Your last try asked your account for the character Jaina and did not hear back.");
      await click(saveButton());
      expect(alerts()).toContain(WAIT);
      vi.advanceTimersByTime(119_000);
      await prepare(jaina);
      await click(saveButton());
      expect(alerts()).toContain(WAIT);
      expect(posts).toEqual([]);
      // That earlier request is made after all: it is used, and it is the only one.
      accounts[A_ID].characters.push({ id: serverId(77), ...label });
      await prepare(jaina);
      await click(saveButton());
      expect(accounts[A_ID].characters).toHaveLength(1);
      expect(posts.map((p) => p.url)).toEqual(["/api/me/builds"]);
      expect(posts[0].body.characterId).toBe(serverId(77));
    } finally {
      vi.useRealTimers();
    }
  });

  test("a request with no answer stored long before, read back after a reload, is looked for on the account first, and used when there", async () => {
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST], [jaina]);
    const label = { name: "Jaina", classSlug: "mage", realm: null, note: null };
    localStorage.setItem("everloot:transfers", JSON.stringify({ format: "everloot.transfers", version: 1, receipts: [],
      characters: [{ altId: jaina.id, userId: A_ID, characterId: null, label, at: new Date(Date.now() - 600_000).toISOString() }] }));
    accounts[A_ID].characters.push({ id: serverId(78), ...label });
    await render();
    await prepare(jaina);
    await click(saveButton());
    expect(accounts[A_ID].characters).toHaveLength(1);
    expect(posts.map((p) => p.url)).toEqual(["/api/me/builds"]);
    expect(posts[0].body.characterId).toBe(serverId(78));
  });

  test("a request with no answer stored long before, read back after a reload, is made again only once the account read just now does not have it", async () => {
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST], [jaina]);
    const label = { name: "Jaina", classSlug: "mage", realm: null, note: null };
    localStorage.setItem("everloot:transfers", JSON.stringify({ format: "everloot.transfers", version: 1, receipts: [],
      characters: [{ altId: jaina.id, userId: A_ID, characterId: null, label, at: new Date(Date.now() - 600_000).toISOString() }] }));
    await render();
    await prepare(jaina);
    const reads = requests.filter((r) => r.request === "GET /api/me/builds").length;
    await click(saveButton());
    // The account was read again before the character was asked for, and it is made once.
    expect(requests.map((r) => r.request).slice(-4)).toEqual(["GET /api/auth/me", "GET /api/me/builds", "POST /api/me/characters", "POST /api/me/builds"]);
    expect(requests.filter((r) => r.request === "GET /api/me/builds").length).toBe(reads + 1);
    expect(accounts[A_ID].characters).toHaveLength(1);
    expect(text()).toContain("Saved 1 plan to your account.");
  });

  test("a character request the site refused outright made nothing, so the next try asks again at once", async () => {
    const jaina = alt({ planIds: [FROST.id] });
    seed(ANON, [FROST], [jaina]);
    const site = globalThis.fetch;
    let refuse = true;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!refuse || String(input) !== "/api/me/characters" || init?.method !== "POST") return site(input, init);
      refuse = false;
      return Response.json({ error: "That character is not valid." }, { status: 400 });
    });
    await render();
    await prepare(jaina);
    await click(saveButton());
    expect(alerts()).toContain("Frost was not saved: That character is not valid.");
    expect(journal()!.characters).toEqual([]);
    await prepare(jaina);
    await click(saveButton());
    expect(accounts[A_ID].characters).toHaveLength(1);
    expect(text()).toContain("Saved 1 plan to your account.");
  });
});
