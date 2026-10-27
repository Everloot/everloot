// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";
import DocumentBoundary from "./DocumentBoundary";
import OptionalScripts from "./OptionalScripts";

let pathname: string | null = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
const reload = vi.fn();
vi.mock("@/lib/document-boundary", async (actual) => ({ ...(await actual<object>()), reloadDocument: () => reload() }));

let root: Root | null = null;
let mounted: Mock<() => void>;

/** A page whose effect would read storage, as chat does. */
function Page() {
  useEffect(() => { mounted(); }, []);
  return <p>page</p>;
}

beforeEach(() => {
  mounted = vi.fn();
  reload.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The document was loaded at `loadedAt` (null: the browser has no navigation entry); the app now shows `now`. */
function at(loadedAt: string | null, now: string | null) {
  vi.spyOn(performance, "getEntriesByType").mockImplementation((type) => (type === "navigation" && loadedAt !== null ? [{ name: `http://localhost:3000${loadedAt}` } as PerformanceEntry] : []));
  if (now !== null) window.history.replaceState(null, "", now);
  pathname = now;
}

async function mount(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

test("a move from a public page to chat reloads the page, and chat never mounts in the public page's document", async () => {
  at("/", "/chat");
  const host = await mount(<DocumentBoundary><Page /></DocumentBoundary>);
  expect(mounted).not.toHaveBeenCalled();
  expect(host.textContent).toBe("");
  expect(reload).toHaveBeenCalledTimes(1);
});

test("a move from the account page to a public page reloads too, without mounting the public page first", async () => {
  at("/account", "/database/items");
  await mount(<DocumentBoundary><Page /></DocumentBoundary>);
  expect(mounted).not.toHaveBeenCalled();
  expect(reload).toHaveBeenCalledTimes(1);
});

test("moves on one side of the line, and the served version's prefix, show the page without a reload", async () => {
  for (const [loadedAt, now] of [["/chat", "/settings"], ["/", "/wiki"], ["/chat", "/beta/chat"]] as const) {
    at(loadedAt, now);
    await mount(<DocumentBoundary><Page /></DocumentBoundary>);
    act(() => root?.unmount());
  }
  expect(mounted).toHaveBeenCalledTimes(3);
  expect(reload).not.toHaveBeenCalled();
});

test("without a navigation entry, the page the document opened on shows without a reload", async () => {
  at(null, "/chat");
  await mount(<DocumentBoundary><Page /></DocumentBoundary>);
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();
});

test("the boundary hydrates the server's markup as it is", async () => {
  at("/chat", "/chat");
  const host = document.body.appendChild(document.createElement("div"));
  host.innerHTML = renderToString(<DocumentBoundary><Page /></DocumentBoundary>);
  const onRecoverableError = vi.fn();
  await act(async () => { root = hydrateRoot(host, <DocumentBoundary><Page /></DocumentBoundary>, { onRecoverableError }); });
  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(mounted).toHaveBeenCalledTimes(1);
});

test("ads and analytics load on public pages only", async () => {
  const shown = async (loadedAt: string, now: string | null) => {
    at(loadedAt, now);
    const host = await mount(<OptionalScripts><span>scripts</span></OptionalScripts>);
    const text = host.textContent;
    act(() => root?.unmount());
    return text === "scripts";
  };
  expect(await shown("/", "/")).toBe(true);
  expect(await shown("/", "/database/items")).toBe(true);
  for (const path of ["/chat", "/account", "/settings", "/beta/account"]) expect(await shown(path, path), path).toBe(false);
  // Not in a protected page's document on its way to a public page, nor when the path is unknown.
  expect(await shown("/chat", "/")).toBe(false);
  expect(await shown("/", null)).toBe(false);
});

test("Plans on this device loads no ads, analytics or consent banner, and a move to or from it reloads first", async () => {
  for (const path of ["/tools/builds", "/beta/tools/builds"]) {
    at(path, path);
    const host = await mount(<OptionalScripts><span>scripts</span></OptionalScripts>);
    expect(host.textContent, path).toBe("");
    act(() => root?.unmount());
  }
  // From the calculator to the plans, and from the plans back to a plan in the calculator: neither page mounts in
  // the other's document.
  for (const [loadedAt, now] of [["/tools/talents/mage", "/tools/builds"], ["/tools/builds", "/tools/talents/mage"]] as const) {
    at(loadedAt, now);
    await mount(<DocumentBoundary><Page /></DocumentBoundary>);
    act(() => root?.unmount());
  }
  expect(mounted).not.toHaveBeenCalled();
  expect(reload).toHaveBeenCalledTimes(2);
  // The scripts stay out of the plans' document on its way to the calculator, too.
  at("/tools/builds", "/tools/talents/mage");
  const host = await mount(<OptionalScripts><span>scripts</span></OptionalScripts>);
  expect(host.textContent).toBe("");
});
