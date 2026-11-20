// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const nav = vi.hoisted(() => ({ path: "/docs/mcp", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useRouter: () => ({ push: nav.push, refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => <a {...props}>{children}</a>,
}));

import { DocsTabs } from "./DocsNav";
import { DOCS_TABS } from "@/lib/docs/nav";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nav.push.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<DocsTabs />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("below md one labelled select lists the docs sections, with the page's section chosen, and navigates to the one picked", async () => {
  const select = container.querySelector<HTMLSelectElement>("select")!;
  expect(select.closest("label")!.className).toContain("md:hidden");
  expect(select.closest("label")!.textContent).toContain("Docs section");
  expect(Array.from(select.options).map((o) => o.textContent)).toEqual(DOCS_TABS.map((t) => t.label));
  expect(select.value).toBe("mcp");
  select.value = "cookbook";
  await act(async () => select.dispatchEvent(new Event("change", { bubbles: true })));
  expect(nav.push).toHaveBeenCalledWith("/docs/cookbook");
});

test("from md up the tab strip stays: every section a link, the page's section current", () => {
  const strip = container.querySelector('nav[aria-label="Docs sections"]')!;
  expect(strip.closest("div.hidden")!.className).toBe("hidden md:block");
  expect(Array.from(strip.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual(DOCS_TABS.map((t) => t.href));
  expect(strip.querySelector('a[aria-current="page"]')!.getAttribute("href")).toBe("/docs/mcp");
});
