// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/track", () => ({ track }));
vi.mock("next/navigation", () => ({ usePathname: () => "/tools/raid", useRouter: () => ({ refresh: () => {} }) }));
vi.mock("./AccountControls", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => <a {...props}>{children}</a>,
}));

import Header from "./Header";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  track.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Header />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const submit = async (form: HTMLFormElement) => {
  form.addEventListener("submit", (e) => e.preventDefault());
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
};

test("each header search form reports its own surface, never lore", async () => {
  await act(async () => (container.querySelector('button[aria-label="Menu"]') as HTMLButtonElement).click());
  const forms = Array.from(container.querySelectorAll<HTMLFormElement>('form[role="search"]'));
  expect(forms).toHaveLength(3);
  const seen: unknown[] = [];
  for (const form of forms) {
    track.mockClear();
    await submit(form);
    expect(track).toHaveBeenCalledTimes(1);
    seen.push(track.mock.calls[0]);
  }
  expect(seen).toEqual([
    ["search", { surface: "header" }],
    ["search", { surface: "header-phone" }],
    ["search", { surface: "menu" }],
  ]);
});
