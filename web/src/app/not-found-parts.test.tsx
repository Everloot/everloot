// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, onNavigate: _onNavigate, ...props }: { children: React.ReactNode; onNavigate?: () => void; href: string }) => <a {...props}>{children}</a>,
}));
// The browser's view: usePathname names the address tried, on the static 404 as on a thrown one.
const mocks = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.path }));
vi.mock("@/components/glint/Glint", () => ({ default: () => <svg data-glint="sad" /> }));

import NotFoundBody from "./not-found-parts";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // The field's suggestion requests wait 120 ms; none fires inside a test, and none may reach the network if it did.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const field = () => container.querySelector<HTMLInputElement>("input#not-found-search")!;

async function mount(path: string, database = false) {
  window.history.replaceState({}, "", path);
  mocks.path = path;
  await act(async () => root.render(<NotFoundBody database={database} />));
}

test("after mount the search box holds the last segment of the address tried (#975)", async () => {
  await mount("/this-page-does-not-exist");
  expect(field().value).toBe("this-page-does-not-exist");
  expect(container.querySelector("form[role=search]")?.getAttribute("action")).toBe("/search");
  expect(container.textContent).not.toContain("three installs make it public");
});

test("a database 404 for an id searches for that id and says no install has reported it yet", async () => {
  await mount("/database/npcs/999999", true);
  expect(field().value).toBe("999999");
  expect(container.textContent).toContain("No report for this id yet; three installs make it public.");
  expect(container.querySelector('a[href="/addon"]')).not.toBeNull();
});

test("the database line is only for an id: a non-numeric id keeps the generic copy", async () => {
  await mount("/database/items/abc", true);
  expect(field().value).toBe("abc");
  expect(container.textContent).not.toContain("three installs make it public");
  expect(container.querySelector('a[href="/addon"]')).toBeNull();
});
