// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ACCOUNT_CHANGED_EVENT } from "@/components/AccountControls";
import { fixture } from "@/lib/talents/fixture";
import { readPlanHash } from "@/lib/talents/import";
import { encodeBuild } from "@/lib/talents/share";
import TalentCalculator from "./TalentCalculator";

let container: HTMLDivElement;
let root: Root;
const ID = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const NEW_ID = "9b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e99";
const JAINA_ID = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
// Two accounts as the session cookie names them: A is the player, B another account signed in on this browser later.
const A = "7a000000-0000-4000-8000-00000000000a";
const B = "7b000000-0000-4000-8000-00000000000b";
const CODE = encodeBuild({ classSlug: "mage", specId: fixture.specId, build: fixture.build, ranks: { 11: { rank: 2 } } });
const saved = (over: object = {}) => ({
  id: ID, slug: "AbCd1234", name: "Fire", notes: "For raids", classSlug: "mage", characterId: null, code: CODE, code2: null,
  gameBuild: fixture.build, shared: true, active: false, link: "https://everloot.app/b/AbCd1234", updatedAt: "2026-10-20T12:00:00.000Z", showName: false, ...over,
});
type Build = ReturnType<typeof saved>;
const jaina = { id: JAINA_ID, name: "Jaina", classSlug: "mage", realm: null, note: null };

/** The account the session cookie belongs to now (null: signed out). */
let who: string | null;
/** EVERLOOT_SAVED_BUILDS off: the builds API answers 404. */
let off: boolean;
/** /api/auth/me fails while set. */
let authDown: boolean;
/** Each account's characters and builds, as GET /api/me/builds lists them. */
let accounts: Record<string, { characters: object[]; builds: Build[] }>;
/** Every POST that reached the site: the account it was sent as, and the one the page said it was for. */
let posts: Array<{ url: string; body: Record<string, unknown>; as: string | null; owner: string | null }> = [];
/** The account a write names, as the site reads it (x-everloot-expected-owner). */
const expectedOwner = (init?: RequestInit) => new Headers(init?.headers).get("x-everloot-expected-owner");
/** Requests ("GET /api/me/builds") whose next answer waits until released. It is still the answer for when it was asked. */
let held = new Map<string, Promise<void>>();

function hold(request: string): () => void {
  let release = () => {};
  held.set(request, new Promise<void>((r) => { release = r; }));
  return () => release();
}

/** The site's API, as far as the calculator talks to it, answered for the session as it is when asked. */
function answer(url: string, init?: RequestInit): Response {
  const method = init?.method ?? "GET";
  if (url === "/api/auth/me") {
    if (authDown) return Response.json({ error: "Authentication is temporarily unavailable" }, { status: 503 });
    return Response.json({ user: who && { id: who, name: who === A ? "Thrall#1234" : "Jaina#5678", entitlements: [] } });
  }
  const body = method === "POST" ? JSON.parse(String(init!.body)) as Record<string, unknown> : {};
  if (method === "POST") posts.push({ url, body, as: who, owner: expectedOwner(init) });
  if (off) return Response.json({ error: "Not found" }, { status: 404 });
  if (!who) return Response.json({ error: "Sign in to save builds.", signIn: "/sign-in?returnTo=%2Fme" }, { status: 401 });
  // As the site does: a write that names another account than the session's is refused before anything is written.
  const named = expectedOwner(init);
  if (named !== null && named !== who) {
    return Response.json({ error: "This was meant for another account than the one signed in now. Nothing was saved.", code: "account_mismatch" }, { status: 409 });
  }
  const mine = accounts[who] ??= { characters: [], builds: [] };
  if (method === "GET") return Response.json(mine);
  if (url === "/api/me/characters") {
    const character = { ...jaina, name: String(body.name) };
    mine.characters.push(character);
    return Response.json({ character }, { status: 201 });
  }
  if (body.id && !mine.builds.some((b) => b.id === body.id)) return Response.json({ error: "No build or character with that id on this account." }, { status: 404 });
  const shared = body.shared !== false;
  const build = saved({ id: body.id ?? NEW_ID, name: body.name, slug: "NewSlug1", shared, link: shared ? "https://everloot.app/b/NewSlug1" : null });
  mine.builds = [build, ...mine.builds.filter((b) => b.id !== build.id)];
  return Response.json({ build }, { status: body.id ? 200 : 201 });
}

/** Signed in as A with these builds, signed out, or with the switch off. */
function api(state: "in" | "out" | "off", builds = [saved()]) {
  posts = [];
  held = new Map();
  off = state === "off";
  authDown = false;
  who = state === "out" ? null : A;
  accounts = { [A]: { characters: [jaina], builds } };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const response = answer(url, init);
    const request = `${init?.method ?? "GET"} ${url}`;
    const wait = held.get(request);
    if (wait) { held.delete(request); await wait; }
    return response;
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/tools/talents/mage");
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** Lets the account check, the builds read and whatever they start finish. */
const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const render = async (props: { savedBuilds?: boolean; readOnly?: boolean; initialCodes?: (string | null)[] } = { savedBuilds: true }) => {
  await act(async () => root.render(<TalentCalculator catalog={fixture} {...props} />));
  await settle();
};
const button = (label: RegExp, scope: ParentNode = container) => [...scope.querySelectorAll("button")].find((b) => label.test(b.textContent ?? ""));
const click = async (el: Element) => {
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
  await settle();
};
const press = (target: Element, key: string, init: KeyboardEventInit = {}) =>
  act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
const status = () => container.querySelector('[role="status"]')!.textContent;
const node = (id: number) => container.querySelector<HTMLButtonElement>(`#talent-${id}`)!;
function type(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
  return act(async () => { setter.call(field, value); field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
const panel = () => container.querySelector<HTMLFormElement>('form[aria-label="Save build"]');
const prompt = () => container.querySelector<HTMLElement>('section[aria-label="Sign in to save builds"]');
/** My builds, in the build bar: the calculator has other <details> further down. */
const menu = () => container.querySelector<HTMLDetailsElement>('section[aria-label="Build"] details');
/** The build bar's Save: the first in the page, ahead of the panel's own submit button. */
const saveButton = () => button(/^Save$/)!;
/** Sign out in this tab's header: the session is gone, and the header says so with ACCOUNT_CHANGED_EVENT. */
const signOutHere = () => act(async () => { who = null; window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT)); });
/** The tab comes back to the front. Another tab may have signed in, out or into another account meanwhile. */
const comeBack = async () => { await act(async () => { window.dispatchEvent(new Event("focus")); }); await settle(); };

/** Signs in from the prompt's link as a browser does: the click keeps the build, Battle.net's callback lands on the
 *  link's returnTo with no #plan, and the calculator opens there afresh. */
async function signInFrom(link: HTMLAnchorElement, account: string) {
  link.addEventListener("click", (e) => e.preventDefault());
  await click(link);
  const returnTo = new URL(link.getAttribute("href")!, "https://everloot.app").searchParams.get("returnTo")!;
  await act(async () => root.unmount());
  root = createRoot(container);
  who = account;
  window.history.replaceState(null, "", returnTo);
  await render();
}

test("without the switch there is no Save button and no account lookup", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await render({});
  expect(button(/^Save$/)).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

test("when the API says the feature is off, Save disappears", async () => {
  api("off");
  await render();
  expect(button(/^Save$/)).toBeUndefined();
});

test("signed out, Save offers sign-in and remembers the build for the way back", async () => {
  api("out");
  await render();
  expect(button(/^Save$/)!.disabled).toBe(true);
  await click(node(11));
  await click(button(/^Save$/)!);
  const prompt = container.querySelector('section[aria-label="Sign in to save builds"]')!;
  expect(prompt.textContent).toContain("Sign in to save builds");
  const link = prompt.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("/sign-in?returnTo=%2Ftools%2Ftalents%2Fmage%3Fsave%3D1");
  link.addEventListener("click", (e) => e.preventDefault());
  await click(link);
  expect(JSON.parse(localStorage.getItem("everloot:pending-save")!)).toMatchObject({ path: "/tools/talents/mage", hash: window.location.hash, at: expect.any(Number) });
  expect(window.location.hash).toMatch(/^#plan=EL1-mage-/);
});

test("back from sign-in, the build is restored and the save panel opens", async () => {
  api("in", []);
  localStorage.setItem("everloot:pending-save", JSON.stringify({ path: "/tools/talents/mage", hash: `#plan=${CODE}`, at: Date.now() }));
  window.history.replaceState(null, "", "/tools/talents/mage?save=1");
  await render();
  expect(node(11).textContent).toContain("2/5");
  expect(panel()).not.toBeNull();
  expect(window.location.search).toBe("");
  expect(localStorage.getItem("everloot:pending-save")).toBeNull();
});

test("signed out, Save, sign in and back: the same plan in both sets comes back, and it is what gets saved", async () => {
  api("out", []);
  await render();
  await click(node(11));
  await click(node(11));
  await click(button(/^Set 2$/)!);
  await click(node(51));
  const plan = readPlanHash(window.location.hash);
  expect(plan.first && plan.second).toBeTruthy();
  await click(saveButton());
  await signInFrom(prompt()!.querySelector("a")!, A);
  expect(window.location.search).toBe("");
  expect(readPlanHash(window.location.hash)).toEqual(plan);
  expect(node(11).textContent).toContain("2/5");
  expect(document.activeElement).toBe(panel()!.querySelector("input"));
  await click(button(/^Save build$/)!);
  expect(posts).toEqual([{ url: "/api/me/builds", as: A, owner: A, body: expect.objectContaining({ code: plan.first, code2: plan.second }) }]);
  expect(status()).toBe("Saved as a new build. Short link: https://everloot.app/b/NewSlug1");
});

test("signed out while editing a saved build, sign-in comes back to editing it, and Save updates that build", async () => {
  api("out");
  window.history.replaceState(null, "", `/tools/talents/mage?saved=${ID}#plan=${CODE}`);
  await render();
  await click(node(11));
  const plan = readPlanHash(window.location.hash);
  await click(saveButton());
  const link = prompt()!.querySelector("a")!;
  expect(link.getAttribute("href")).toBe(`/sign-in?returnTo=${encodeURIComponent(`/tools/talents/mage?saved=${ID}&save=1`)}`);
  await signInFrom(link, A);
  expect(container.textContent).toContain("Editing: Fire");
  expect(window.location.search).toBe(`?saved=${ID}`);
  expect(node(11).textContent).toContain("3/5");
  expect(panel()!.querySelector("input")!.value).toBe("Fire");
  await click(panel()!.querySelector('button[type="submit"]')!);
  expect(posts.map((p) => [p.url, p.body.id, p.body.code])).toEqual([["/api/me/builds", ID, plan.first]]);
  expect(status()).toBe("Saved. Short link: https://everloot.app/b/NewSlug1");
});

test("a session that ends while editing asks to sign in again, and the link comes back to the same build", async () => {
  api("in");
  window.history.replaceState(null, "", `/tools/talents/mage?saved=${ID}#plan=${CODE}`);
  await render();
  await click(saveButton());
  who = null;
  await click(panel()!.querySelector('button[type="submit"]')!);
  const link = prompt()!.querySelector("a")!;
  expect(link.getAttribute("href")).toBe(`/sign-in?returnTo=${encodeURIComponent(`/tools/talents/mage?saved=${ID}&save=1`)}`);
  expect(document.activeElement).toBe(link);
});

test("a new build is saved with its name, character, notes and codes, and the page then edits it", async () => {
  api("in", []);
  await render();
  await click(node(11));
  await click(button(/^Save$/)!);
  const form = panel()!;
  expect(form.querySelector<HTMLInputElement>("input")!.value).toBe("Left Mage 1/0");
  await type(form.querySelector("input")!, "My frost");
  await type(form.querySelector("select")!, "new");
  await type(form.querySelectorAll<HTMLInputElement>("input")[1], "Jaina");
  await type(form.querySelector("textarea")!, "Raid night");
  await click(button(/^Save build$/)!);
  expect(posts.map((p) => p.url)).toEqual(["/api/me/characters", "/api/me/builds"]);
  // Both writes name the account the page shows, so neither can land in another one.
  expect(posts.map((p) => p.owner)).toEqual([A, A]);
  expect(posts[0].body).toMatchObject({ name: "Jaina", classSlug: "mage" });
  expect(posts[1].body).toEqual({
    name: "My frost", notes: "Raid night", characterId: "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22",
    code: encodeBuild({ classSlug: "mage", specId: fixture.specId, build: fixture.build, ranks: { 11: { rank: 1 } } }), code2: null, shared: true, showName: false,
  });
  expect(status()).toBe("Saved as a new build. Short link: https://everloot.app/b/NewSlug1");
  expect(new URLSearchParams(window.location.search).get("saved")).toBe("9b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e99");
  expect(container.textContent).toContain("Editing: My frost");
});

test("opened from a saved build, Save updates it in place and Save as new makes a copy", async () => {
  api("in");
  window.history.replaceState(null, "", `/tools/talents/mage?saved=${ID}#plan=${CODE}`);
  await render();
  expect(container.textContent).toContain("Editing: Fire");
  await click(node(11));
  await click(button(/^Save$/)!);
  expect(panel()!.querySelector("input")!.value).toBe("Fire");
  expect(panel()!.querySelector("textarea")!.value).toBe("For raids");
  await click(panel()!.querySelector('button[type="submit"]')!);
  expect(posts[0].body).toMatchObject({ id: ID, name: "Fire" });
  expect(status()).toBe("Saved. Short link: https://everloot.app/b/NewSlug1");
  await click(button(/^Save$/)!);
  await click(button(/^Save as new$/)!);
  expect(posts[1].body.id).toBeUndefined();
  expect(status()).toContain("Saved as a new build");
});

test("unsharing a saved build turns its short link off", async () => {
  api("in");
  window.history.replaceState(null, "", `/tools/talents/mage?saved=${ID}#plan=${CODE}`);
  await render();
  await click(saveButton());
  const [share] = [...panel()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(share.checked).toBe(true);
  await act(async () => share.parentElement!.click());
  await click(panel()!.querySelector('button[type="submit"]')!);
  expect(posts[0].body).toMatchObject({ id: ID, shared: false });
  expect(status()).toBe("Saved. Its short link is off.");
});

test("a build deleted in another tab: Save says so, keeps the panel, and Save as new keeps the plan", async () => {
  api("in");
  window.history.replaceState(null, "", `/tools/talents/mage?saved=${ID}#plan=${CODE}`);
  await render();
  accounts[A].builds = [];
  await click(saveButton());
  await click(panel()!.querySelector('button[type="submit"]')!);
  expect(panel()!.querySelector('[role="alert"]')!.textContent).toBe("No build or character with that id on this account.");
  await click(button(/^Save as new$/)!);
  expect(posts.map((p) => p.body.id)).toEqual([ID, undefined]);
  expect(status()).toContain("Saved as a new build");
});

test("a new character is kept even if the build fails to save, so trying again does not make a second one", async () => {
  api("in", []);
  const real = globalThis.fetch;
  let failOnce = true;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === "/api/me/builds" && init?.method === "POST" && failOnce) {
      failOnce = false;
      posts.push({ url, body: JSON.parse(String(init.body)), as: who, owner: expectedOwner(init) });
      return Response.json({ error: "Saved builds are unavailable right now. Try again in a minute." }, { status: 503 });
    }
    return real(url, init);
  });
  await render();
  await click(node(11));
  await click(button(/^Save$/)!);
  await type(panel()!.querySelector("select")!, "new");
  await type(panel()!.querySelectorAll<HTMLInputElement>("input")[1], "Jaina");
  await click(button(/^Save build$/)!);
  expect(panel()!.querySelector('[role="alert"]')!.textContent).toContain("unavailable");
  expect(panel()!.querySelector("select")!.value).toBe("2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22");
  await click(button(/^Save build$/)!);
  expect(posts.map((p) => p.url)).toEqual(["/api/me/characters", "/api/me/builds", "/api/me/builds"]);
  expect(posts[2].body.characterId).toBe("2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22");
  expect(panel()).toBeNull();
});

test("the owner's name goes on the shared link only when chosen, and only while sharing is on", async () => {
  api("in", []);
  await render();
  await click(node(11));
  await click(button(/^Save$/)!);
  const [share, showName] = [...panel()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(showName.parentElement!.textContent).toContain("Show my name on the shared link");
  expect(showName.checked).toBe(false);
  await act(async () => share.parentElement!.click());
  expect(showName.disabled).toBe(true);
  await act(async () => share.parentElement!.click());
  await act(async () => showName.parentElement!.click());
  await click(button(/^Save build$/)!);
  expect(posts[0].body).toMatchObject({ shared: true, showName: true });
});

test("back from sign-in with no build to restore, the panel says to spend a point instead of offering a dead button", async () => {
  api("in", []);
  window.history.replaceState(null, "", "/tools/talents/mage?save=1");
  await render();
  expect(panel()!.textContent).toContain("Spend a point to save this build.");
  expect(button(/^Save build$/)!.disabled).toBe(true);
  await click(node(11));
  expect(button(/^Save build$/)!.disabled).toBe(false);
  expect(panel()!.textContent).not.toContain("Spend a point");
});

test("My builds lists this class's saved builds", async () => {
  api("in", [saved(), saved({ id: "5b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e55", name: "Warrior thing", classSlug: "warrior" })]);
  await render();
  expect(menu()!.textContent).toContain("Fire");
  expect(menu()!.textContent).not.toContain("Warrior thing");
  expect(menu()!.querySelector("a")!.getAttribute("href")).toBe(`/tools/talents/mage?saved=${ID}#plan=${CODE}`);
});

test("Save moves the focus to the build's name; Escape closes the panel and gives the focus back to Save", async () => {
  api("in", []);
  await render();
  await click(node(11));
  await click(saveButton());
  const name = panel()!.querySelector("input")!;
  expect(document.activeElement).toBe(name);
  await press(name, "Escape");
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(saveButton());
  expect(saveButton().getAttribute("aria-expanded")).toBe("false");
  // Escape on Save itself closes an open panel too.
  await click(saveButton());
  await press(saveButton(), "Escape");
  expect(panel()).toBeNull();
});

test("Cancel, and a finished save, give the focus back to Save", async () => {
  api("in", []);
  await render();
  await click(node(11));
  await click(saveButton());
  await click(button(/^Cancel$/)!);
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(saveButton());
  await click(saveButton());
  await click(button(/^Save build$/)!);
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(saveButton());
});

test("signed out, the sign-in prompt takes the focus and Escape closes it", async () => {
  api("out");
  await render();
  await click(node(11));
  await click(saveButton());
  const link = prompt()!.querySelector("a")!;
  expect(document.activeElement).toBe(link);
  await press(link, "Escape");
  expect(prompt()).toBeNull();
  expect(document.activeElement).toBe(saveButton());
});

test("keys typed in the panel stay in it: Ctrl+Z in the notes leaves the talents alone", async () => {
  api("in", []);
  await render();
  await click(node(11));
  await click(saveButton());
  await press(panel()!.querySelector("textarea")!, "z", { ctrlKey: true });
  expect(node(11).textContent).toContain("1/5");
  expect(panel()).not.toBeNull();
});

test("My builds closes on Escape, with the focus back on its button, and on a press anywhere else", async () => {
  api("in");
  await render();
  const list = menu()!;
  list.open = true;
  const first = list.querySelector("a")!;
  first.focus();
  await press(first, "Escape");
  expect(list.open).toBe(false);
  expect(document.activeElement).toBe(list.querySelector("summary"));
  list.open = true;
  await act(async () => { first.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
  expect(list.open).toBe(true);
  await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
  expect(list.open).toBe(false);
});

test("signed out here while the account's builds were still being read: they never show", async () => {
  api("in");
  const release = hold("GET /api/me/builds");
  await render();
  await signOutHere();
  await act(async () => release());
  await settle();
  expect(menu()).toBeNull();
  expect(container.textContent).not.toContain("Fire");
  await click(node(11));
  await click(saveButton());
  expect(prompt()).not.toBeNull();
});

test("signing out here with the panel open closes it at once and leaves nothing of the account on screen", async () => {
  api("in");
  window.history.replaceState(null, "", `/tools/talents/mage?saved=${ID}#plan=${CODE}`);
  await render();
  await click(saveButton());
  expect(panel()!.textContent).toContain("Jaina");
  // Until this tab knows who is signed in now, it shows no one's builds.
  const release = hold("GET /api/auth/me");
  await signOutHere();
  expect(panel()).toBeNull();
  expect(menu()).toBeNull();
  expect(container.textContent).not.toContain("Editing: Fire");
  expect(container.textContent).not.toContain("Jaina");
  expect(status()).toBe("The account signed in here changed, so nothing was saved. Press Save again.");
  await act(async () => release());
  await settle();
  await click(saveButton());
  expect(prompt()).not.toBeNull();
  expect(posts).toEqual([]);
});

test("a save answered after signing out here is not shown, and the address is left as it was", async () => {
  api("in");
  await render();
  await click(node(11));
  await click(saveButton());
  const release = hold("POST /api/me/builds");
  await click(button(/^Save build$/)!);
  await signOutHere();
  expect(status()).toBe("The account signed in here changed before the save finished. Sign in to that account again to see whether the build was saved.");
  await act(async () => release());
  await settle();
  expect(posts.map((p) => [p.url, p.as])).toEqual([["/api/me/builds", A]]);
  expect(status()).not.toContain("Saved");
  expect(window.location.search).toBe("");
  expect(container.textContent).not.toContain("Editing:");
  expect(menu()).toBeNull();
  expect(panel()).toBeNull();
});

test("a save answered right after the sign-out, before this tab checks the account again, is dropped too", async () => {
  api("in");
  await render();
  await click(node(11));
  await click(saveButton());
  const release = hold("POST /api/me/builds");
  await click(button(/^Save build$/)!);
  // The answer lands in the same moment as the header's sign-out, before React has run anything for it.
  await act(async () => {
    who = null;
    window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
    release();
    await new Promise((r) => setTimeout(r, 0));
  });
  await settle();
  expect(status()).toBe("The account signed in here changed before the save finished. Sign in to that account again to see whether the build was saved.");
  expect(window.location.search).toBe("");
  expect(container.textContent).not.toContain("Editing:");
});

test("signing out here once the new character is made stops before the build is sent", async () => {
  api("in");
  await render();
  await click(node(11));
  await click(saveButton());
  await type(panel()!.querySelector("select")!, "new");
  await type(panel()!.querySelectorAll<HTMLInputElement>("input")[1], "Jaina");
  const release = hold("POST /api/me/characters");
  await click(button(/^Save build$/)!);
  await signOutHere();
  await act(async () => release());
  await settle();
  expect(posts.map((p) => p.url)).toEqual(["/api/me/characters"]);
  expect(panel()).toBeNull();
});

test("another account found when the tab comes back closes the panel, saves nothing, and shows only that account's builds", async () => {
  api("in");
  accounts[B] = { characters: [], builds: [saved({ id: NEW_ID, name: "Their frost", slug: "TheirOne" })] };
  window.history.replaceState(null, "", `/tools/talents/mage?saved=${ID}#plan=${CODE}`);
  await render();
  await click(saveButton());
  who = B;
  await comeBack();
  expect(panel()).toBeNull();
  expect(status()).toBe("You are signed in to a different account now, so nothing was saved. Press Save again to save the build to this one.");
  expect(container.textContent).not.toContain("Editing: Fire");
  expect(menu()!.textContent).toContain("Their frost");
  expect(menu()!.textContent).not.toContain("Fire");
  await click(saveButton());
  expect(panel()!.textContent).not.toContain("Jaina");
  expect(posts).toEqual([]);
});

test("the old account's builds, answered after another account is found, never replace that account's", async () => {
  api("in");
  accounts[B] = { characters: [], builds: [saved({ id: NEW_ID, name: "Their frost", slug: "TheirOne" })] };
  const release = hold("GET /api/me/builds");
  await render();
  who = B;
  await comeBack();
  await act(async () => release());
  await settle();
  expect(menu()!.textContent).toContain("Their frost");
  expect(menu()!.textContent).not.toContain("Fire");
});

test("another tab signs in as B before this one checks again: Save is refused, nothing reaches B, and the draft stays with A", async () => {
  api("in", []);
  await render();
  await click(node(11));
  await click(saveButton());
  await type(panel()!.querySelector("input")!, "My frost");
  await type(panel()!.querySelector("textarea")!, "Raid night");
  // Another tab signs in as B. This tab comes back, and Save is pressed while its check of who is signed in is still out.
  who = B;
  const release = hold("GET /api/auth/me");
  await comeBack();
  await click(button(/^Save build$/)!);
  expect(posts).toEqual([{ url: "/api/me/builds", as: B, owner: A, body: expect.objectContaining({ name: "My frost" }) }]);
  expect(accounts[B]).toBeUndefined();
  const refusal = "The account signed in here changed, so nothing was saved. What you typed stays with the account you started with.";
  expect(panel()!.querySelector('[role="alert"]')!.textContent).toBe(refusal);
  expect(status()).toBe(refusal);
  expect(panel()!.querySelector("input")!.value).toBe("My frost");
  expect(panel()!.querySelector("textarea")!.value).toBe("Raid night");
  // The check answers B: A's panel and builds go, and what was typed is not offered to B.
  await act(async () => release());
  await settle();
  expect(panel()).toBeNull();
  expect(status()).toBe("You are signed in to a different account now, so nothing was saved. Press Save again to save the build to this one.");
  await click(saveButton());
  expect(panel()!.querySelector("textarea")!.value).toBe("");
  await click(button(/^Cancel$/)!);
  // Signed in as A here again, Save opens with A's draft, and it saves to A.
  who = A;
  await comeBack();
  await click(saveButton());
  expect(panel()!.querySelector("input")!.value).toBe("My frost");
  expect(panel()!.querySelector("textarea")!.value).toBe("Raid night");
  await click(button(/^Save build$/)!);
  expect(posts.at(-1)).toMatchObject({ url: "/api/me/builds", as: A, owner: A });
  expect(accounts[A].builds.map((b) => b.name)).toEqual(["My frost"]);
  expect(accounts[B]).toEqual({ characters: [], builds: [] });
});

test("a new character is not made under another account either, and no build follows the refusal", async () => {
  api("in", []);
  await render();
  await click(node(11));
  await click(saveButton());
  await type(panel()!.querySelector("select")!, "new");
  await type(panel()!.querySelectorAll<HTMLInputElement>("input")[1], "Jaina");
  who = B;
  hold("GET /api/auth/me");
  await comeBack();
  await click(button(/^Save build$/)!);
  expect(posts.map((p) => [p.url, p.as, p.owner])).toEqual([["/api/me/characters", B, A]]);
  expect(accounts[B]).toBeUndefined();
  expect(panel()!.querySelectorAll<HTMLInputElement>("input")[1].value).toBe("Jaina");
});

test("a signed-out answer that lands after the tab finds an account signed in does not hide that account's builds", async () => {
  api("out");
  const release = hold("GET /api/me/builds");
  await render();
  who = A;
  await comeBack();
  await act(async () => release());
  await settle();
  expect(menu()!.textContent).toContain("Fire");
  await click(node(11));
  await click(saveButton());
  expect(panel()).not.toBeNull();
});

const UNCHECKED = "Your account could not be checked, so Save is off for now. Reload the page to try again.";
const bar = () => container.querySelector<HTMLElement>('section[aria-label="Build"]')!;

test("when this tab cannot tell which account is signed in, it shows no builds and Save is off, saying why", async () => {
  api("in");
  authDown = true;
  await render();
  await click(node(11));
  expect(menu()).toBeNull();
  expect(saveButton().disabled).toBe(true);
  expect(bar().textContent).toContain(UNCHECKED);
  expect(saveButton().getAttribute("aria-describedby")).toBe(bar().querySelector("p#save-build-unchecked")!.id);
  authDown = false;
  await comeBack();
  expect(menu()!.textContent).toContain("Fire");
  expect(saveButton().disabled).toBe(false);
  expect(bar().textContent).not.toContain(UNCHECKED);
});

test("a failed check after a good one drops the account's builds and the open panel, and Save stays off until a check works", async () => {
  api("in");
  window.history.replaceState(null, "", `/tools/talents/mage?saved=${ID}#plan=${CODE}`);
  await render();
  expect(menu()!.textContent).toContain("Fire");
  await click(saveButton());
  await type(panel()!.querySelector("textarea")!, "Raid night");
  // Another tab signs in as B, and the check when this tab comes back fails: this tab can no longer say whose it is.
  who = B;
  accounts[B] = { characters: [], builds: [saved({ id: NEW_ID, name: "Their frost", slug: "TheirOne" })] };
  authDown = true;
  await comeBack();
  expect(panel()).toBeNull();
  expect(menu()).toBeNull();
  expect(bar().textContent).not.toContain("Editing: Fire");
  expect(container.textContent).not.toContain("Their frost");
  expect(status()).toBe("Your account could not be checked, so nothing was saved and Save is off for now. Reload the page to try again.");
  expect(saveButton().disabled).toBe(true);
  expect(bar().textContent).toContain(UNCHECKED);
  expect(posts).toEqual([]);
  authDown = false;
  await comeBack();
  expect(menu()!.textContent).toContain("Their frost");
  expect(saveButton().disabled).toBe(false);
});

test("read-only, the build shows as saved and points cannot change", async () => {
  vi.stubGlobal("fetch", vi.fn());
  window.history.replaceState(null, "", "/b/AbCd1234");
  await render({ readOnly: true, initialCodes: [CODE, null] });
  expect(node(11).textContent).toContain("2/5");
  await click(node(11));
  expect(node(11).textContent).toContain("2/5");
  expect(status()).toBe("This is a saved build. Open it in the calculator to change it.");
  expect(window.location.pathname).toBe("/b/AbCd1234");
  expect(window.location.hash).toBe("");
  expect(button(/Copy link|^Undo$|^Save$/)).toBeUndefined();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
