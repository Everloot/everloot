// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/database/items/19019" }));

import ScreenshotsSection from "./ScreenshotsSection";
import type { GalleryScreenshot, OwnScreenshotsView } from "@/lib/screenshots-shared";

const ME = "11111111-2222-4333-8444-555555555555";
const SHOT: GalleryScreenshot = { id: "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11", author: "thrall", width: 1920, height: 1080, approvedAt: "2026-11-25T10:00:00.000Z" };
const PENDING = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e12";
const REJECTED = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e13";

let container: HTMLDivElement;
let root: Root;
let gallery: GalleryScreenshot[];
let own: OwnScreenshotsView;
let sent: Array<{ url: string; method: string; init: RequestInit }>;
let answers: Array<{ status: number; body: object }>;
let observed: Array<(entries: Array<{ isIntersecting: boolean }>) => void>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  sent = [];
  answers = [];
  observed = [];
  gallery = [SHOT];
  own = { viewer: null, mine: [] };
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { observed.push(callback); }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    sent.push({ url: String(url), method, init });
    if (method === "GET") return Response.json(String(url).startsWith("/screenshots/mine") ? own : { screenshots: gallery });
    const answer = answers.shift() ?? { status: 200, body: {} };
    return Response.json(answer.body, { status: answer.status });
  }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<ScreenshotsSection type="item" id={19019} name="Thunderfury, Blessed Blade of the Windseeker" />));
  await act(async () => {});
}
async function scrollNear() {
  await act(async () => { for (const callback of observed) callback([{ isIntersecting: true }]); });
  await act(async () => {});
}
const text = () => container.textContent ?? "";
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
async function click(el: Element) { await act(async () => (el as HTMLElement).click()); await act(async () => {}); }
async function choose(file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function tick(box: HTMLInputElement) { await act(async () => box.click()); }

test("loads nothing until the section is near the screen, then the gallery without cookies and the viewer's own uncached", async () => {
  await render();
  expect(sent).toEqual([]);
  expect(container.querySelector("#screenshots")).not.toBeNull();
  await scrollNear();
  const urls = sent.map((s) => s.url);
  expect(urls).toEqual(["/screenshots?type=item&id=19019", "/screenshots/mine?type=item&id=19019"]);
  expect(sent[0].init.credentials).toBe("omit");
  expect(sent[1].init.cache).toBe("no-store");
});

test("the gallery: approved pictures, lazy, sized, described by the page's name and credited by handle", async () => {
  await render();
  await scrollNear();
  const img = container.querySelector("img")!;
  expect(img.getAttribute("src")).toBe(`/screenshots/file/${SHOT.id}`);
  expect(img.getAttribute("loading")).toBe("lazy");
  expect(img.getAttribute("width")).toBe("1920");
  expect(img.getAttribute("height")).toBe("1080");
  expect(img.getAttribute("alt")).toBe("Screenshot of Thunderfury, Blessed Blade of the Windseeker, by @thrall");
  expect(text()).toContain("@thrall");
  expect(text()).toContain("Game art in these screenshots © Blizzard Entertainment");
  gallery = [];
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  await scrollNear();
  expect(text()).toContain("No screenshots yet.");
  expect(text()).not.toContain("© Blizzard");
});

test("signed out: a sign-in link back to this section, and no upload form", async () => {
  await render();
  await scrollNear();
  expect(container.querySelector('a[href*="sign-in"]')?.getAttribute("href")).toContain(encodeURIComponent("/database/items/19019#screenshots"));
  expect(container.querySelector('input[type="file"]')).toBeNull();
});

test("signed in without a handle: pointed at settings, no form", async () => {
  own = { viewer: { id: ME, handle: null }, mine: [] };
  await render();
  await scrollNear();
  expect(container.querySelector('a[href="/settings"]')).not.toBeNull();
  expect(container.querySelector('input[type="file"]')).toBeNull();
});

test("upload: needs a file and the licence box, sends the form with the account named, then says it waits for review", async () => {
  own = { viewer: { id: ME, handle: "jaina" }, mine: [] };
  await render();
  await scrollNear();
  const upload = button("Upload screenshot");
  expect(upload.disabled).toBe(true);
  await choose(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", { type: "image/png" }));
  expect(upload.disabled).toBe(true);
  await tick(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  expect(upload.disabled).toBe(false);
  answers.push({ status: 201, body: { screenshotId: PENDING } });
  own = { viewer: { id: ME, handle: "jaina" }, mine: [{ id: PENDING, status: "pending", width: 8, height: 8, createdAt: "2026-11-25T10:00:00.000Z" }] };
  await click(upload);
  const posted = sent.find((s) => s.method === "POST")!;
  expect(posted.url).toBe("/screenshots");
  expect(new Headers(posted.init.headers).get("x-everloot-expected-owner")).toBe(ME);
  const form = posted.init.body as FormData;
  expect([...form.keys()].sort()).toEqual(["confirm", "file", "id", "type"]);
  expect(form.get("confirm")).toBe("yes");
  expect(form.get("type")).toBe("item");
  expect(form.get("id")).toBe("19019");
  expect(text()).toContain("A moderator will look at it");
  expect(text()).toContain("Waiting for review");
  expect(container.querySelector(`img[src="/screenshots/review/${PENDING}"]`)).not.toBeNull();
});

test("a file over 8 MB or not a picture type is refused in the browser, with nothing sent", async () => {
  own = { viewer: { id: ME, handle: "jaina" }, mine: [] };
  await render();
  await scrollNear();
  await choose(new File([new Uint8Array(8 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" }));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("8 MB");
  await choose(new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("PNG, JPEG or WebP");
  expect(button("Upload screenshot").disabled).toBe(true);
  expect(sent.some((s) => s.method === "POST")).toBe(false);
});

test("the server's refusal is shown as worded", async () => {
  own = { viewer: { id: ME, handle: "jaina" }, mine: [] };
  await render();
  await scrollNear();
  await choose(new File([new Uint8Array([1])], "shot.png", { type: "image/png" }));
  await tick(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  answers.push({ status: 429, body: { error: "That is today's limit (5 screenshots a day). Try again tomorrow." } });
  await click(button("Upload screenshot"));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("That is today's limit (5 screenshots a day). Try again tomorrow.");
});

test("the uploader's own: status in words, and delete after a second click", async () => {
  own = {
    viewer: { id: ME, handle: "jaina" },
    mine: [
      { id: PENDING, status: "pending", width: 8, height: 8, createdAt: "2026-11-25T10:00:00.000Z" },
      { id: SHOT.id, status: "approved", width: 8, height: 8, createdAt: "2026-11-24T10:00:00.000Z" },
      { id: REJECTED, status: "rejected", width: 8, height: 8, createdAt: "2026-11-23T10:00:00.000Z" },
    ],
  };
  await render();
  await scrollNear();
  expect(text()).toContain("Waiting for review");
  expect(text()).toContain("Shown on this page");
  expect(text()).toContain("Not approved");
  // A rejected one has no picture any more.
  expect(container.querySelector(`img[src*="${REJECTED}"]`)).toBeNull();
  await click(container.querySelectorAll<HTMLButtonElement>("button[data-delete]")[0]);
  expect(sent.some((s) => s.method === "POST")).toBe(false);
  await click(button("Delete screenshot"));
  const posted = sent.find((s) => s.method === "POST")!;
  expect(posted.url).toBe("/screenshots/mine");
  expect(JSON.parse(String(posted.init.body))).toEqual({ action: "delete", screenshotId: PENDING });
});
