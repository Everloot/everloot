// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import RememberCharacter, { REMEMBERED_SLOT } from "./RememberCharacter";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const show = (install: string, character: string) => act(() => root.render(<RememberCharacter install={install} character={character} />));
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;

test("remembering stores the install and character in this browser, and forgetting removes them", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  show("owner-install", "0a1b2c3d");
  act(() => button("Remember this character on this browser").click());
  expect(JSON.parse(localStorage.getItem(REMEMBERED_SLOT)!)).toEqual({ install: "owner-install", character: "0a1b2c3d" });
  expect(container.textContent).toContain("Remembered on this browser.");
  act(() => button("Forget").click());
  expect(localStorage.getItem(REMEMBERED_SLOT)).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("with nothing chosen it links back to the remembered character", () => {
  localStorage.setItem(REMEMBERED_SLOT, JSON.stringify({ install: "owner-install", character: "0a1b2c3d" }));
  show("", "");
  const link = container.querySelector("a")!;
  expect(link.textContent).toBe("Open the character you remembered");
  expect(link.getAttribute("href")).toBe("/tools/collections?install=owner-install&character=0a1b2c3d");
});

test("with nothing chosen and nothing remembered it draws nothing", () => {
  show("", "");
  expect(container.innerHTML).toBe("");
});
