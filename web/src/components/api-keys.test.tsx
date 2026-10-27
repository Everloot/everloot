// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NO_LIVE_KEY } from "@/lib/api-key-policy";
import ApiKeys, { KEYS_CHANGED_EVENT, KeysRefresh, RemoveAccess } from "./ApiKeys";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

let container: HTMLDivElement;
let root: Root;
/** Hears every "the keys changed" the page is told. */
const heard = vi.fn();
const DAY = 86_400_000;
const KEY = {
  id: "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11", hint: "beef", label: "bot", purpose: "Drop rates", scopes: ["read:public"],
  created_at: "2026-10-19T00:00:00Z", last_used_at: null, revoked_at: null, expires_at: new Date(Date.now() + 10 * DAY - 60_000).toISOString(),
};
const TOKEN = `evl_${"c".repeat(64)}`;
type Call = { url: string; method: string; body: Record<string, unknown> | null };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  heard.mockClear();
  router.refresh.mockClear();
  window.addEventListener(KEYS_CHANGED_EVENT, heard);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.querySelectorAll("#after").forEach((target) => target.remove());
  window.removeEventListener(KEYS_CHANGED_EVENT, heard);
  vi.unstubAllGlobals();
});

const buttonsNamed = (label: string) => Array.from(container.querySelectorAll("button")).filter((b) => b.textContent === label || b.getAttribute("aria-label") === label);
const buttonNamed = (label: string) => buttonsNamed(label)[0];
const click = async (label: string) => act(async () => buttonNamed(label)!.click());
const labelled = <T extends HTMLElement>(text: string) => {
  const label = Array.from(container.querySelectorAll("label")).find((l) => l.textContent?.startsWith(text))!;
  return (label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector("input")) as T;
};
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The keys API, mocked: GET answers `list`, POST makes a key, DELETE succeeds. Every call is kept. */
function api(list: object, made: object = { ok: true, id: "x", token: TOKEN, hint: "cccc", expires_at: "2027-01-18T00:00:00.000Z" }) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (init?.method === "POST") return Response.json(made, { status: 201 });
    if (init?.method === "DELETE") return Response.json({ ok: true });
    return Response.json(list);
  });
  return calls;
}
const ready = (over: object = {}) => ({ ok: true, keys: [KEY], limit: 5, ownScope: true, records: true, scopes: ["read:public", "read:own"], ...over });

test("signed out, it offers the Battle.net sign-in", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ ok: false, error: "Sign in with Battle.net to manage keys." }, { status: 401 }));
  await act(async () => root.render(<ApiKeys />));
  expect(container.querySelector('a[href="/sign-in"]')?.textContent).toBe("Sign in");
});

test("with the guard off, it says keys are not switched on", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ ok: false, error: "API keys are not switched on yet." }, { status: 503 }));
  await act(async () => root.render(<ApiKeys />));
  expect(container.textContent).toContain("Keys are not switched on yet");
});

test("the list shows each key's name, purpose, prefix, permissions, dates and days left", async () => {
  api(ready({ keys: [{ ...KEY, scopes: ["read:own", "read:public"], last_used_at: "2026-10-20T08:00:00Z" }] }));
  await act(async () => root.render(<ApiKeys />));
  const item = container.querySelector('ul[aria-label="Your API keys"] li')!.textContent!;
  for (const part of ["bot", "Active", "Drop rates", "evl_…beef", "Read my saved builds", "Read public data", "2026-10-19", "in 10 days", "2026-10-20"]) {
    expect(item).toContain(part);
  }
  expect(container.textContent).toContain("1 of 5 active keys");
});

test("an expired key says so, does not count as active, and offers Roll and Delete instead of Revoke", async () => {
  api(ready({ keys: [{ ...KEY, expires_at: "2026-10-01T00:00:00Z" }] }));
  await act(async () => root.render(<ApiKeys />));
  expect(container.textContent).toContain("Expired 2026-10-01");
  expect(container.textContent).toContain("0 of 5 active keys");
  expect(buttonNamed("Revoke bot")).toBeUndefined();
  expect(buttonNamed("Roll bot")).toBeDefined();
  expect(buttonNamed("Delete bot")).toBeDefined();
});

test("the create form needs a name and a purpose, and says which is missing", async () => {
  const calls = api(ready());
  await act(async () => root.render(<ApiKeys />));
  await click("Create API key");
  await click("Create key");
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  const name = labelled<HTMLInputElement>("Name");
  expect(name.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(name.getAttribute("aria-describedby")!)?.textContent).toBe("Give the key a name.");
  expect(document.activeElement).toBe(name);
  expect(container.textContent).toContain("Say what the key is for.");
});

test("a custom date must be after today", async () => {
  const calls = api(ready());
  await act(async () => root.render(<ApiKeys />));
  await click("Create API key");
  await act(async () => { type(labelled("Name"), "Sheet"); type(labelled("What it"), "Guild sheet"); });
  await act(async () => labelled<HTMLInputElement>("Custom date").click());
  await act(async () => type(labelled("Last day the key works"), "2020-01-01"));
  await click("Create key");
  expect(container.textContent).toContain("Pick a date after today.");
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
});

test("creating a key sends name, purpose, permissions and 90 days by default, then shows the key once with a copy button", async () => {
  const calls = api(ready());
  await act(async () => root.render(<ApiKeys />));
  await click("Create API key");
  expect(labelled<HTMLInputElement>("90 days").checked).toBe(true);
  expect(container.textContent).toContain("(recommended)");
  const always = labelled<HTMLInputElement>("Read public data");
  expect([always.checked, always.disabled]).toEqual([true, true]);
  await act(async () => {
    type(labelled("Name"), "Sheet");
    type(labelled("What it"), "Drop rates for my guild");
  });
  await act(async () => labelled<HTMLInputElement>("Read my saved builds").click());
  await act(async () => labelled<HTMLInputElement>("1 year").click());
  await click("Create key");
  expect(calls.find((c) => c.method === "POST")).toEqual({
    url: "/api/keys", method: "POST",
    body: { label: "Sheet", purpose: "Drop rates for my guild", scopes: ["read:own"], expiresInDays: 365 },
  });
  expect(container.textContent).toContain(TOKEN);
  expect(container.textContent).toContain("It won't be shown again.");
  expect(container.textContent).toContain("expires on 2027-01-18");
  // The copy button keeps all its labels in the DOM and shows one: "Copy key" first.
  const copy = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Copy key"))!;
  const written: string[] = [];
  vi.stubGlobal("navigator", { clipboard: { writeText: async (text: string) => void written.push(text) } });
  await act(async () => copy.click());
  expect(written).toEqual([TOKEN]);
  // Done hides it for good: the list never has the key itself.
  await click("Done");
  expect(container.textContent).not.toContain(TOKEN);
});

test("revoking asks first; Cancel leaves the key alone", async () => {
  const calls = api(ready());
  await act(async () => root.render(<ApiKeys />));
  await click("Revoke bot");
  expect(container.textContent).toContain("Anything using evl_…beef stops working at once.");
  await click("Cancel");
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  await click("Revoke bot");
  await click("Revoke key");
  expect(calls.some((c) => c.method === "DELETE" && c.url === `/api/keys?id=${KEY.id}`)).toBe(true);
});

test("Revoke and Roll move focus to the confirm button; Cancel returns it to the button that opened the box", async () => {
  api(ready());
  await act(async () => root.render(<ApiKeys />));
  for (const [opener, confirm] of [["Revoke bot", "Revoke key"], ["Roll bot", "Roll key"]]) {
    buttonNamed(opener)!.focus();
    await click(opener);
    expect(document.activeElement).toBe(buttonNamed(confirm));
    await click("Cancel");
    expect(buttonNamed(confirm)).toBeUndefined();
    expect(document.activeElement).toBe(buttonNamed(opener));
  }
});

test("after a revoke, focus stays on the key's row once its buttons are gone", async () => {
  let revoked: string | null = null;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") { revoked = "2026-10-20T00:00:00Z"; return Response.json({ ok: true }); }
    return Response.json(ready({ keys: [{ ...KEY, revoked_at: revoked }] }));
  });
  await act(async () => root.render(<ApiKeys />));
  buttonNamed("Revoke bot")!.focus();
  await click("Revoke bot");
  await click("Revoke key");
  const row = container.querySelector<HTMLElement>(`li[data-key="${KEY.id}"]`)!;
  expect(row.textContent).toContain("Revoked 2026-10-20");
  expect(buttonNamed("Revoke bot")).toBeUndefined();
  expect(document.activeElement).toBe(row);
});

test("rolling asks first, then shows the new secret once", async () => {
  const calls = api(ready(), { ok: true, id: "y", token: TOKEN, hint: "cccc", expires_at: "2027-01-01T00:00:00.000Z" });
  await act(async () => root.render(<ApiKeys />));
  await click("Roll bot");
  expect(container.textContent).toContain("same name, permissions and lifetime");
  await click("Roll key");
  expect(calls.find((c) => c.method === "POST")?.url).toBe(`/api/keys?roll=${KEY.id}`);
  expect(container.textContent).toContain("New secret for bot");
  expect(container.textContent).toContain(TOKEN);
  expect(container.textContent).toContain("The old secret has stopped working.");
});

test("before the expiry migration: no purpose or expiry fields, no Roll, and the older call", async () => {
  const calls = api(ready({ records: false, keys: [{ ...KEY, purpose: undefined, expires_at: null }] }));
  await act(async () => root.render(<ApiKeys />));
  expect(container.textContent).toContain("Never");
  expect(buttonNamed("Roll bot")).toBeUndefined();
  await click("Create API key");
  expect(container.textContent).not.toContain("What it's for");
  expect(container.textContent).not.toContain("Expires after");
  await act(async () => type(labelled("Name"), "Desktop"));
  await act(async () => labelled<HTMLInputElement>("Read my saved builds").click());
  await click("Create key");
  expect(calls.find((c) => c.method === "POST")?.body).toEqual({ label: "Desktop", builds: true });
});

test("without saved builds there is no such permission", async () => {
  api(ready({ ownScope: false, scopes: ["read:public"], keys: [] }));
  await act(async () => root.render(<ApiKeys />));
  await click("Create API key");
  expect(container.textContent).not.toContain("Read my saved builds");
});

test("at the limit, Create is off and says why", async () => {
  api(ready({ limit: 1 }));
  await act(async () => root.render(<ApiKeys />));
  expect(buttonNamed("Create API key")!.disabled).toBe(true);
  expect(container.textContent).toContain("Revoke one to make another.");
});

test("a revoked key offers Delete, which erases it", async () => {
  const calls = api(ready({ keys: [{ ...KEY, revoked_at: "2026-10-19T01:00:00Z" }] }));
  await act(async () => root.render(<ApiKeys />));
  expect(buttonNamed("Revoke bot")).toBeUndefined();
  expect(buttonNamed("Roll bot")).toBeUndefined();
  await click("Delete bot");
  expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([`/api/keys?id=${KEY.id}&erase=1`]);
});

test("a change made in the list is announced, so the rest of the page can read the keys again", async () => {
  api(ready());
  await act(async () => root.render(<ApiKeys />));
  await click("Revoke bot");
  await click("Revoke key");
  expect(heard).toHaveBeenCalledTimes(1);
});

test("the list reads the keys again when something else on the page changes them", async () => {
  let revoked: string | null = null;
  const reads = vi.fn();
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (!init?.method) reads();
    return Response.json(ready({ keys: [{ ...KEY, revoked_at: revoked }] }));
  });
  await act(async () => root.render(<ApiKeys />));
  expect(buttonNamed("Revoke bot")).toBeDefined();
  revoked = "2026-10-20T00:00:00Z";
  await act(async () => { window.dispatchEvent(new Event(KEYS_CHANGED_EVENT)); });
  expect(reads).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Revoked 2026-10-20");
  expect(buttonNamed("Revoke bot")).toBeUndefined();
});

/** Where focus goes once Remove access has revoked the key and its card is about to leave the page. afterEach removes it. */
function focusTarget() {
  const target = document.createElement("h3");
  target.id = "after";
  target.tabIndex = -1;
  document.body.append(target);
  return target;
}

test("Remove access asks the list's own question first; Cancel sends nothing and returns focus to it", async () => {
  const calls = api(ready());
  await act(async () => root.render(<RemoveAccess id={KEY.id} name="bot" hint="beef" focusAfter="after" />));
  buttonNamed("Remove access for bot (evl_…beef)")!.focus();
  await click("Remove access for bot (evl_…beef)");
  expect(container.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Confirm revoke bot");
  expect(container.textContent).toContain("Revoke bot? Anything using evl_…beef stops working at once.");
  expect(document.activeElement).toBe(buttonNamed("Revoke key"));
  await click("Cancel");
  expect(calls).toEqual([]);
  expect(document.activeElement).toBe(buttonNamed("Remove access for bot (evl_…beef)"));
});

test("Remove access revokes with the list's own request, moves focus on and tells the page its keys changed", async () => {
  const calls = api(ready());
  const target = focusTarget();
  await act(async () => root.render(<><RemoveAccess id={KEY.id} name="bot" hint="beef" focusAfter="after" /><KeysRefresh /></>));
  await click("Remove access for bot (evl_…beef)");
  await click("Revoke key");
  expect(calls).toEqual([{ url: `/api/keys?id=${KEY.id}`, method: "DELETE", body: null }]);
  expect(heard).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(target);
  expect(Array.from(container.querySelectorAll('[role="status"]'), (s) => s.textContent)).toEqual(["Access removed for bot (evl_…beef)."]);
});

test("a refused Remove access says why, keeps the question open and announces nothing", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ ok: false, error: "Keys are temporarily unavailable." }, { status: 503 }));
  await act(async () => root.render(<RemoveAccess id={KEY.id} name="bot" hint="beef" focusAfter="after" />));
  await click("Remove access for bot (evl_…beef)");
  await click("Revoke key");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Keys are temporarily unavailable.");
  expect(buttonNamed("Revoke key")).toBeDefined();
  expect(heard).not.toHaveBeenCalled();
});

/** The keys API with one key: DELETE revokes it (404 once it is revoked), GET reads it as it now is. */
function oneKey({ hold = false } = {}) {
  let revoked: string | null = null;
  let release = () => {};
  const deletes: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method !== "DELETE") return Response.json(ready({ keys: [{ ...KEY, revoked_at: revoked }] }));
    deletes.push(url);
    if (hold) await new Promise<void>((resolve) => { release = resolve; });
    if (revoked) return Response.json({ ok: false, error: NO_LIVE_KEY }, { status: 404 });
    revoked = "2026-10-27T00:00:00Z";
    return Response.json({ ok: true });
  });
  return { deletes, release: () => release() };
}
const both = <><ApiKeys /><RemoveAccess id={KEY.id} name="bot" hint="beef" focusAfter="after" /></>;
const row = () => container.querySelector<HTMLElement>(`li[data-key="${KEY.id}"]`)!;

test("a question left open in the list closes once Remove access revokes its key, and focus stays where Remove access put it", async () => {
  const { deletes } = oneKey();
  const target = focusTarget();
  await act(async () => root.render(both));
  await click("Revoke bot");
  await click("Remove access for bot (evl_…beef)");
  const [, card] = buttonsNamed("Revoke key");
  await act(async () => card.click());
  expect(row().textContent).toContain("Revoked 2026-10-27");
  expect(Array.from(row().querySelectorAll("button"), (b) => b.textContent)).toEqual(["Delete"]);
  expect(deletes).toHaveLength(1);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(document.activeElement).toBe(target);
});

test("the list and Remove access revoking one key at the same time send one request, and neither asks to retry", async () => {
  const { deletes, release } = oneKey({ hold: true });
  await act(async () => root.render(both));
  await click("Revoke bot");
  await click("Remove access for bot (evl_…beef)");
  const [list, card] = buttonsNamed("Revoke key");
  await act(async () => { card.click(); list.click(); });
  await act(async () => release());
  expect(deletes).toEqual([`/api/keys?id=${KEY.id}`]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(buttonsNamed("Revoke key")).toEqual([]);
  expect(row().textContent).toContain("Revoked 2026-10-27");
});

test("Remove access asks with the card's pill buttons, and the list's question keeps the list's own buttons", async () => {
  api(ready());
  await act(async () => root.render(both));
  await click("Revoke bot");
  await click("Remove access for bot (evl_…beef)");
  const classes = (b: HTMLButtonElement) => b.className.split(" ");
  const [listRevoke, cardRevoke] = buttonsNamed("Revoke key");
  const [listCancel, cardCancel] = buttonsNamed("Cancel");
  expect(classes(cardRevoke)).toEqual(expect.arrayContaining(["btn", "btn-primary"]));
  expect(classes(cardCancel)).toContain("btn");
  expect(classes(cardCancel)).not.toContain("btn-primary");
  for (const b of [listRevoke, listCancel]) {
    expect(classes(b)).toContain("rounded-lg");
    expect(classes(b)).not.toContain("btn");
  }
});

test("revoking a key that is already revoked (404) reads the keys again instead of asking to retry", async () => {
  let reads = 0;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return Response.json({ ok: false, error: NO_LIVE_KEY }, { status: 404 });
    reads += 1;
    return Response.json(ready({ keys: [{ ...KEY, revoked_at: reads > 1 ? "2026-10-27T00:00:00Z" : null }] }));
  });
  await act(async () => root.render(<ApiKeys />));
  await click("Revoke bot");
  await click("Revoke key");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(reads).toBe(2);
  expect(buttonNamed("Revoke key")).toBeUndefined();
  expect(row().textContent).toContain("Revoked 2026-10-27");
});

test("Remove access on a key that is already revoked (404) has the page read its keys again instead of asking to retry", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ ok: false, error: NO_LIVE_KEY }, { status: 404 }));
  await act(async () => root.render(<RemoveAccess id={KEY.id} name="bot" hint="beef" focusAfter="after" />));
  await click("Remove access for bot (evl_…beef)");
  await click("Revoke key");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(buttonNamed("Revoke key")).toBeUndefined();
  expect(heard).toHaveBeenCalledTimes(1);
});

test("on the account page, a change to the keys reads the server's parts again", async () => {
  await act(async () => root.render(<KeysRefresh />));
  expect(router.refresh).not.toHaveBeenCalled();
  await act(async () => { window.dispatchEvent(new Event(KEYS_CHANGED_EVENT)); });
  expect(router.refresh).toHaveBeenCalledTimes(1);
});

const card = <><RemoveAccess id={KEY.id} name="bot" hint="beef" focusAfter="after" /><KeysRefresh /></>;
const said = () => container.querySelector('[role="status"]')?.textContent;

test("a 404 that is the route's own no-live-key answer reads the keys again and says so plainly, never that access was removed", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ ok: false, error: NO_LIVE_KEY }, { status: 404 }));
  await act(async () => root.render(card));
  await click("Remove access for bot (evl_…beef)");
  await click("Revoke key");
  expect(said()).toBe("bot (evl_…beef) is no longer on this account's list.");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(router.refresh).toHaveBeenCalledTimes(1);
});

test.each([
  ["a routing page", () => new Response("<html>Not found</html>", { status: 404, headers: { "content-type": "text/html" } }), "That did not work. Try again."],
  ["another message", () => Response.json({ ok: false, error: "Not found" }, { status: 404 }), "Not found"],
  ["no ok field", () => Response.json({ error: NO_LIVE_KEY }, { status: 404 }), NO_LIVE_KEY],
])("a 404 the route did not send (%s) stays an error: nothing is said, the question stays open and nothing is read again", async (_kind, answer, error) => {
  vi.stubGlobal("fetch", async () => answer());
  await act(async () => root.render(card));
  await click("Remove access for bot (evl_…beef)");
  await click("Revoke key");
  expect(said()).toBe("");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(error);
  expect(buttonNamed("Revoke key")).toBeDefined();
  expect(router.refresh).not.toHaveBeenCalled();
});

test("in the list too, a 404 the route did not send is an error and the question stays open", async () => {
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => init?.method === "DELETE"
    ? new Response("<html>Not found</html>", { status: 404, headers: { "content-type": "text/html" } })
    : Response.json(ready()));
  await act(async () => root.render(<ApiKeys />));
  await click("Revoke bot");
  await click("Revoke key");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("That did not work. Try again.");
  expect(buttonNamed("Revoke key")).toBeDefined();
  expect(heard).not.toHaveBeenCalled();
});

// Probes from the second review, kept as regression tests: refusals let go of the shared request, focus is not taken
// back from where the user moved it, and an open Roll question closes once its key is revoked elsewhere.
test("a refused revoke lets go of its key, so a retry sends a new request and can succeed", async () => {
  let deletes = 0;
  vi.stubGlobal("fetch", async () => (++deletes === 1
    ? Response.json({ ok: false, error: "Keys are temporarily unavailable." }, { status: 503 })
    : Response.json({ ok: true })));
  await act(async () => root.render(card));
  await click("Remove access for bot (evl_…beef)");
  await click("Revoke key");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Keys are temporarily unavailable.");
  expect(router.refresh).not.toHaveBeenCalled();
  await click("Revoke key");
  expect(deletes).toBe(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(router.refresh).toHaveBeenCalledTimes(1);
  expect(said()).toBe("Access removed for bot (evl_…beef).");
});

test("removing a second key with the same name is said again: each line names the key by its last four characters", async () => {
  const OTHER = "1b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
  const deletes: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => { deletes.push(url); return Response.json({ ok: true }); });
  await act(async () => root.render(
    <>
      <RemoveAccess key="first" id={KEY.id} name="Desktop App key" hint="beef" focusAfter="after" />
      <RemoveAccess key="second" id={OTHER} name="Desktop App key" hint="d00d" focusAfter="after" />
      <KeysRefresh />
    </>,
  ));
  const status = container.querySelector('[role="status"]')!;
  await click("Remove access for Desktop App key (evl_…beef)");
  await click("Revoke key");
  expect(status.textContent).toBe("Access removed for Desktop App key (evl_…beef).");
  const updates = vi.fn();
  const observer = new MutationObserver(updates);
  observer.observe(status, { childList: true, characterData: true, subtree: true });
  try {
    await click("Remove access for Desktop App key (evl_…d00d)");
    await click("Revoke key");
    await Promise.resolve();
    expect(deletes).toEqual([`/api/keys?id=${KEY.id}`, `/api/keys?id=${OTHER}`]);
    expect(status.textContent).toBe("Access removed for Desktop App key (evl_…d00d).");
    expect(updates).toHaveBeenCalled();
  } finally {
    observer.disconnect();
  }
});

test("a shared revoke that fails is let go for both controls, and a later retry from the card succeeds", async () => {
  let deletes = 0;
  let revoked: string | null = null;
  let release = () => {};
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method !== "DELETE") return Response.json(ready({ keys: [{ ...KEY, revoked_at: revoked }] }));
    if (++deletes === 1) {
      await new Promise<void>((resolve) => { release = resolve; });
      return Response.json({ ok: false, error: "Keys are temporarily unavailable." }, { status: 503 });
    }
    revoked = "2026-10-27T00:00:00Z";
    return Response.json({ ok: true });
  });
  await act(async () => root.render(<>{both}<KeysRefresh /></>));
  await click("Revoke bot");
  await click("Remove access for bot (evl_…beef)");
  const [list, inCard] = buttonsNamed("Revoke key");
  await act(async () => { inCard.click(); list.click(); });
  expect(deletes).toBe(1);
  await act(async () => release());
  expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
  await act(async () => buttonsNamed("Revoke key")[1]!.click());
  expect(deletes).toBe(2);
  expect(buttonsNamed("Revoke key")).toHaveLength(0);
  expect(router.refresh).toHaveBeenCalledTimes(1);
});

test("finishing Remove access leaves focus where the user moved it meanwhile", async () => {
  let release = () => {};
  vi.stubGlobal("fetch", async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    return Response.json({ ok: true });
  });
  focusTarget();
  await act(async () => root.render(<>{card}<button id="other">Other</button></>));
  await click("Remove access for bot (evl_…beef)");
  await click("Revoke key");
  const other = document.getElementById("other")!;
  other.focus();
  await act(async () => release());
  expect(document.activeElement).toBe(other);
});

test("a revoke that succeeds elsewhere clears the error the list kept from its own failed try", async () => {
  let deletes = 0;
  let revoked: string | null = null;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method !== "DELETE") return Response.json(ready({ keys: [{ ...KEY, revoked_at: revoked }] }));
    if (++deletes === 1) return Response.json({ ok: false, error: "Keys are temporarily unavailable." }, { status: 503 });
    revoked = "2026-10-27T00:00:00Z";
    return Response.json({ ok: true });
  });
  await act(async () => root.render(<>{both}<KeysRefresh /></>));
  await click("Revoke bot");
  await click("Revoke key");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Keys are temporarily unavailable.");
  await click("Remove access for bot (evl_…beef)");
  await act(async () => buttonsNamed("Revoke key")[1]!.click());
  expect(deletes).toBe(2);
  expect(row().textContent).toContain("Revoked 2026-10-27");
  expect(said()).toBe("Access removed for bot (evl_…beef).");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

const OTHER = { ...KEY, id: "1b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22", label: "other", hint: "d00d" };
const otherRow = () => container.querySelector<HTMLElement>(`li[data-key="${OTHER.id}"]`)!;

/** Two keys: revoking KEY is refused with a 503, revoking OTHER works. Counts the list's reads. */
function twoKeys() {
  let otherRevoked: string | null = null;
  const reads = { count: 0 };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method !== "DELETE") {
      reads.count++;
      return Response.json(ready({ keys: [KEY, { ...OTHER, revoked_at: otherRevoked }] }));
    }
    if (url.includes(KEY.id)) return Response.json({ ok: false, error: "Keys are temporarily unavailable." }, { status: 503 });
    otherRevoked = "2026-10-27T00:00:00Z";
    return Response.json({ ok: true });
  });
  return reads;
}

test("a failed revoke keeps its error and its open question while another key's removal from its card succeeds", async () => {
  const reads = twoKeys();
  await act(async () => root.render(<><ApiKeys /><RemoveAccess id={OTHER.id} name={OTHER.label} hint={OTHER.hint} focusAfter="after" /><KeysRefresh /></>));
  await click("Revoke bot");
  await click("Revoke key");
  expect(row().querySelector('[role="alert"]')?.textContent).toBe("Keys are temporarily unavailable.");
  await click("Remove access for other (evl_…d00d)");
  await act(async () => buttonsNamed("Revoke key")[1]!.click());
  expect(reads.count).toBe(2);
  expect(said()).toBe("Access removed for other (evl_…d00d).");
  expect(otherRow().textContent).toContain("Revoked 2026-10-27");
  expect(row().textContent).toContain("Active");
  expect(row().querySelector('[role="group"]')).not.toBeNull();
  expect(row().querySelector('[role="alert"]')?.textContent).toBe("Keys are temporarily unavailable.");
});

test("a failed revoke keeps its error while the list revokes another key", async () => {
  twoKeys();
  await act(async () => root.render(<ApiKeys />));
  await click("Revoke bot");
  await click("Revoke key");
  await click("Revoke other");
  await click("Revoke key");
  expect(otherRow().textContent).toContain("Revoked 2026-10-27");
  expect(otherRow().querySelector('[role="alert"]')).toBeNull();
  expect(row().querySelector('[role="alert"]')?.textContent).toBe("Keys are temporarily unavailable.");
});

test("a failed revoke's error goes when its own retry from the list succeeds", async () => {
  let deletes = 0;
  let revoked: string | null = null;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method !== "DELETE") return Response.json(ready({ keys: [{ ...KEY, revoked_at: revoked }] }));
    if (++deletes === 1) return Response.json({ ok: false, error: "Keys are temporarily unavailable." }, { status: 503 });
    revoked = "2026-10-27T00:00:00Z";
    return Response.json({ ok: true });
  });
  await act(async () => root.render(<ApiKeys />));
  await click("Revoke bot");
  await click("Revoke key");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Keys are temporarily unavailable.");
  await click("Revoke key");
  expect(deletes).toBe(2);
  expect(row().textContent).toContain("Revoked 2026-10-27");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("a 404 after an account switch reads the new account's keys and never says access was removed", async () => {
  let switched = false;
  let reads = 0;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      switched = true;
      return Response.json({ ok: false, error: NO_LIVE_KEY }, { status: 404 });
    }
    reads++;
    return Response.json(ready({ keys: switched ? [] : [KEY] }));
  });
  await act(async () => root.render(<><ApiKeys />{card}</>));
  await click("Remove access for bot (evl_…beef)");
  await click("Revoke key");
  expect(reads).toBe(2);
  expect(router.refresh).toHaveBeenCalledTimes(1);
  expect(said()).toBe("bot (evl_…beef) is no longer on this account's list.");
  expect(container.querySelector(`li[data-key="${KEY.id}"]`)).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("two keys with one name get Remove access buttons with distinct names, each ending in the key's last four characters", async () => {
  await act(async () => root.render(
    <>
      <RemoveAccess key="first" id={KEY.id} name="Desktop App key" hint="beef" focusAfter="after" />
      <RemoveAccess key="second" id={OTHER.id} name="Desktop App key" hint="d00d" focusAfter="after" />
    </>,
  ));
  const names = Array.from(container.querySelectorAll("button"), (b) => b.getAttribute("aria-label"));
  expect(names).toEqual(["Remove access for Desktop App key (evl_…beef)", "Remove access for Desktop App key (evl_…d00d)"]);
  // The visible label stays inside the name, so speech input can still say "Remove access".
  for (const b of container.querySelectorAll("button")) expect(b.getAttribute("aria-label")).toContain(b.textContent!);
});

test("an open Roll question closes once the key is revoked elsewhere, and focus moves to the key's row", async () => {
  let revoked: string | null = null;
  vi.stubGlobal("fetch", async () => Response.json(ready({ keys: [{ ...KEY, revoked_at: revoked }] })));
  await act(async () => root.render(<ApiKeys />));
  await click("Roll bot");
  expect(document.activeElement).toBe(buttonNamed("Roll key"));
  revoked = "2026-10-27T00:00:00Z";
  await act(async () => { window.dispatchEvent(new Event(KEYS_CHANGED_EVENT)); });
  expect(container.querySelector('[role="group"]')).toBeNull();
  expect(document.activeElement).toBe(row());
});
