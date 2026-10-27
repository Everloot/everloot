// @vitest-environment jsdom
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
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Lets the account lookup and the reads and writes that follow it finish. */
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
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
    expect(posts[0].body).toEqual({ name: "Jaina", classSlug: "mage", realm: "", note: "Frost for raids" });
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
    const before = device();
    await render();
    await open();
    await choose("Save Frost to your account", { Frost: "private" });
    await choose("Save Fire to your account", { Fire: "private" });
    await click(saveButton());
    // The order was sent, not dropped to get the save through, and nothing after the refusal was tried.
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ order: PLANNED });
    expect(alerts()).toContain("Saving spend orders isn't available yet, so no plans were saved to your account. They stay on this device as they were, spend orders included.");
    expect(device()).toEqual(before);
  });

  test("a save the site refuses for another account stops the transfer, binds nothing and checks the account again", async () => {
    seed(ANON, [FROST, FIRE]);
    const before = device();
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
    expect(device()).toEqual(before);
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

  test("the account's own copy is kept: an older copy left here finishes moving without a second save, and one changed here since is refused with why", async () => {
    const accountFrost = { ...FROST, name: "Frost, renamed", updatedAt: "2026-10-22T12:00:00.000Z", boundTo: { userId: A_ID, at: AT } };
    const accountFire = { ...FIRE, boundTo: { userId: A_ID, at: AT } };
    const changedFire = { ...FIRE, notes: "Changed here later", updatedAt: "2026-10-23T12:00:00.000Z" };
    seed(ANON, [FROST, changedFire]);
    seed(A, [accountFrost, accountFire]);
    await render();
    await open();
    expect(text()).toContain("Frost is in your account already");
    expect(text()).toContain("Fire is in your account already, saved Oct 21, 2026, and was changed here after that. Saving it again would make a second build, so it is left as it is.");
    expect((field("Save Fire to your account") as HTMLInputElement).disabled).toBe(true);
    await click(field("Save Frost to your account"));
    await click(saveButton());
    expect(posts).toEqual([]);
    expect(stored(A)!.plans).toEqual([accountFrost, accountFire]);
    expect(stored(ANON)!.plans).toEqual([changedFire]);
  });
});

describe("binding a transfer on this device", () => {
  const sent = (owner: Owner, ...plans: LocalPlan[]) => ({ owner, planIds: plans.map((p) => p.id) });
  const saved = (owner: Owner, ...plans: LocalPlan[]) => ({ ok: true as const, userId: owner.kind === "account" ? owner.userId : "", planIds: plans.map((p) => p.id) });
  const NOW = new Date("2026-10-27T12:00:00.000Z");

  test("a plan the account's bucket already holds bound to it keeps the account's copy", () => {
    const accountCopy = { ...FROST, name: "Renamed on the account side", updatedAt: "2026-10-22T12:00:00.000Z", boundTo: { userId: A_ID, at: AT } };
    seed(ANON, [FROST]);
    seed(A, [accountCopy]);
    expect(bindTransferred(localStorage, sent(A, FROST), saved(A, FROST), NOW)).toEqual({ ok: true, bound: 1 });
    expect(stored(A)!.plans).toEqual([accountCopy]);
    expect(stored(ANON)!.plans).toEqual([]);
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
  afterEach(() => { delete (navigator as { locks?: unknown }).locks; });

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

  test("the record of where plans went keeps the newest 1000, under its own key, and no backup holds it", async () => {
    const { TRANSFERS_KEPT, exportBackup, readTransfers, readWorkspace, transferKey } = await import("@/lib/player-workspace");
    const receipts = Array.from({ length: TRANSFERS_KEPT }, (_, i) => ({ planId: id(5000 + i), userId: A_ID, key: `k${String(i).padStart(20, "0")}`, state: "saved", content: "00000000", at: AT }));
    localStorage.setItem("everloot:transfers", JSON.stringify({ format: "everloot.transfers", version: 1, receipts, characters: [] }));
    const next = transferKey(localStorage, A, FROST.id);
    if (!next.ok) throw new Error("A key should be stored");
    const read = readTransfers(localStorage);
    if (!read.ok) throw new Error("The record should read");
    expect(read.transfers.receipts).toHaveLength(TRANSFERS_KEPT);
    expect(read.transfers.receipts[0].planId).toBe(id(5001));
    expect(read.transfers.receipts.at(-1)).toMatchObject({ planId: FROST.id, userId: A_ID, key: next.key, state: "sending" });
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
      const before = device();
      await act(async () => root.render(<></>));
      await render();
      await open();
      await choose("Save Frost to your account", { Frost: "private" });
      await click(saveButton());
      expect(alerts()).toContain("Saving spend orders isn't available yet, so no plans were saved to your account. They stay on this device as they were, spend orders included.");
      // A refusal before anything was written lets its key go: nothing records the plan as sent.
      expect(device()).toEqual(before);
    }
  });
});
