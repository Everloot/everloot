// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SavedBuild } from "@/lib/saved-builds";
import PrivateBuildForm from "./PrivateBuildForm";

const ME = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const BUILD_ID = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const build = (over: Partial<SavedBuild> = {}): SavedBuild => ({
  id: BUILD_ID, slug: "AbCd1234", name: "Fire", notes: null, classSlug: "mage", characterId: null, code: MAGE, code2: null,
  gameBuild: "1.60.1.70450", shared: true, active: false, link: "https://everloot.app/b/AbCd1234", updatedAt: "2026-10-20T12:00:00.000Z", showName: false, ...over,
});

let root: Root;
let host: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;
const onSaved = vi.fn();
const onCancel = vi.fn();

function render(props: { accountId?: string; build?: SavedBuild } = {}) {
  act(() => root.render(<PrivateBuildForm accountId={props.accountId ?? ME} build={props.build} onSaved={onSaved} onCancel={onCancel} />));
}
const input = (label: string) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
function type(label: string, value: string) {
  const el = input(label);
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
const text = () => host.textContent ?? "";
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const sentBody = (i = 0) => JSON.parse(String(fetcher.mock.calls[i][1].body));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  onSaved.mockReset();
  onCancel.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

test("a new build posts only its own fields for this account and hands back the saved build", async () => {
  fetcher.mockResolvedValue(Response.json({ accountId: ME, build: build({ shared: false, link: null }) }, { status: 201 }));
  render();
  expect(text()).toContain("private");
  type("Build name", " Fire ");
  type("Share code", MAGE);
  type("Notes (optional)", "Raids");
  await act(async () => { button("Save build").click(); });
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("/api/me/chat/builds");
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin" });
  expect(sentBody()).toEqual({ expectedAccountId: ME, build: { id: null, name: "Fire", notes: "Raids", code: MAGE, code2: null } });
  expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: BUILD_ID, shared: false }));
});

test("editing sends the id, keeps sharing out of the request and links to the calculator", async () => {
  fetcher.mockResolvedValue(Response.json({ accountId: ME, build: build({ name: "Frost" }) }));
  render({ build: build() });
  expect(input("Build name").value).toBe("Fire");
  expect(input("Share code").value).toBe(MAGE);
  expect(host.querySelector("a")!.getAttribute("href")).toBe(`/tools/talents/mage?saved=${BUILD_ID}#plan=${MAGE}`);
  expect(text()).not.toMatch(/share this|public/i);
  type("Build name", "Frost");
  await act(async () => { button("Save build").click(); });
  await flush();
  const body = sentBody();
  expect(body.build).toEqual({ id: BUILD_ID, name: "Frost", notes: null, code: MAGE, code2: null });
  expect(body.build).not.toHaveProperty("shared");
  expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: "Frost", shared: true }));
});

test("a code that is not a calculator share code is caught before anything is sent", async () => {
  render();
  type("Build name", "Fire");
  type("Share code", "not a code");
  await act(async () => { button("Save build").click(); });
  expect(fetcher).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/share code/i);
  type("Share code", MAGE);
  type("Second share code (optional)", "EL1-warrior-0-1.60-MTE6NQ");
  await act(async () => { button("Save build").click(); });
  expect(fetcher).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/second/i);
});

test("a second click while saving sends nothing more", async () => {
  let release!: (r: Response) => void;
  fetcher.mockReturnValue(new Promise<Response>((r) => { release = r; }));
  render();
  type("Build name", "Fire");
  type("Share code", MAGE);
  await act(async () => { button("Save build").click(); });
  expect(button("Saving…").disabled).toBe(true);
  await act(async () => { button("Saving…").click(); button("Saving…").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => { release(Response.json({ accountId: ME, build: build() }, { status: 201 })); });
  await flush();
  expect(onSaved).toHaveBeenCalledTimes(1);
});

test.each([
  [401, { error: "Sign in" }, /signed out/i],
  [400, { error: "That share code is not valid." }, /share code is not valid/],
  [409, { error: "You have 200 saved builds. Delete one to save another.", code: "build_limit" }, /200 saved builds/],
  [429, { error: "You saved 300 times in the last day. Try again tomorrow.", code: "daily_limit" }, /300 times/],
])("a definite %i says not saved, keeps what was typed and can be tried again", async (status, body, message) => {
  fetcher.mockResolvedValue(Response.json(body, { status }));
  render();
  type("Build name", "Fire");
  type("Share code", MAGE);
  await act(async () => { button("Save build").click(); });
  await flush();
  const alert = host.querySelector('[role="alert"]')!.textContent!;
  expect(alert).toMatch(/^Not saved\./);
  expect(alert).toMatch(message);
  expect(input("Build name").value).toBe("Fire");
  expect(onSaved).not.toHaveBeenCalled();
  expect(button("Try again").disabled).toBe(false);
});

const UNCONFIRMED = "We could not confirm the save. Check your builds before trying again.";
test.each([
  ["a 503", () => fetcher.mockResolvedValue(Response.json({ error: "x", code: "save_unconfirmed" }, { status: 503 }))],
  ["a 500 with no JSON", () => fetcher.mockResolvedValue(new Response("oops", { status: 500 }))],
  ["a dropped connection", () => fetcher.mockRejectedValue(new TypeError("Failed to fetch"))],
  ["a success with no build in it", () => fetcher.mockResolvedValue(new Response("", { status: 201 }))],
])("after %s the outcome is unknown: it never claims Not saved, and keeps what was typed", async (_name, arrange) => {
  arrange();
  render();
  type("Build name", "Fire");
  type("Share code", MAGE);
  await act(async () => { button("Save build").click(); });
  await flush();
  const alert = host.querySelector('[role="alert"]')!.textContent!;
  expect(alert).toBe(UNCONFIRMED);
  expect(alert).not.toMatch(/not saved/i);
  expect(input("Build name").value).toBe("Fire");
  expect(input("Share code").value).toBe(MAGE);
  expect(onSaved).not.toHaveBeenCalled();
});

test("an answer for another account is refused", async () => {
  fetcher.mockResolvedValue(Response.json({ accountId: OTHER, build: build() }, { status: 201 }));
  render();
  type("Build name", "Fire");
  type("Share code", MAGE);
  await act(async () => { button("Save build").click(); });
  await flush();
  expect(onSaved).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/someone else/i);
});

test("switching account or closing mid-save aborts it and drops the late answer", async () => {
  let release!: (r: Response) => void;
  let signal!: AbortSignal;
  fetcher.mockImplementation((_url: string, init: RequestInit) => { signal = init.signal!; return new Promise<Response>((r) => { release = r; }); });
  render();
  type("Build name", "Fire");
  type("Share code", MAGE);
  await act(async () => { button("Save build").click(); });
  render({ accountId: OTHER });
  expect(signal.aborted).toBe(true);
  await act(async () => { release(Response.json({ accountId: ME, build: build() }, { status: 201 })); });
  await flush();
  expect(onSaved).not.toHaveBeenCalled();
  // The form starts over for the new account: nothing typed for the old one is kept.
  expect(input("Build name").value).toBe("");

  fetcher.mockImplementation((_url: string, init: RequestInit) => { signal = init.signal!; return new Promise<Response>(() => {}); });
  type("Build name", "Fire");
  type("Share code", MAGE);
  await act(async () => { button("Save build").click(); });
  act(() => root.unmount());
  expect(signal.aborted).toBe(true);
  root = createRoot(host);
});

test("switching to another build starts over with that build, abandons the first save and never posts one build's edits under the other's id", async () => {
  const B = "3b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e33";
  let release!: (r: Response) => void;
  let signal!: AbortSignal;
  fetcher.mockImplementation((_url: string, init: RequestInit) => { signal = init.signal!; return new Promise<Response>((r) => { release = r; }); });
  render({ build: build() });
  type("Build name", "Fire edited");
  await act(async () => { button("Save build").click(); });
  render({ build: build({ id: B, name: "Frost", notes: "PvP" }) });
  expect(signal.aborted).toBe(true);
  await act(async () => { release(Response.json({ accountId: ME, build: build({ name: "Fire edited" }) })); });
  await flush();
  expect(onSaved).not.toHaveBeenCalled();
  expect(input("Build name").value).toBe("Frost");
  expect(input("Notes (optional)").value).toBe("PvP");

  type("Build name", "Fire edited");
  render({ build: build({ id: B, name: "Frost" }) });
  render({ build: build() });
  expect(input("Build name").value).toBe("Fire");
  fetcher.mockResolvedValue(Response.json({ accountId: ME, build: build() }));
  await act(async () => { button("Save build").click(); });
  await flush();
  expect(sentBody(1).build).toMatchObject({ id: BUILD_ID, name: "Fire" });
});

test("Cancel closes without sending", () => {
  render();
  act(() => button("Cancel").click());
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(fetcher).not.toHaveBeenCalled();
});
