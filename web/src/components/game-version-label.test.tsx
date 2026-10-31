// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import GameVersionLabel from "./GameVersionLabel";
import { CURRENT_VERSION, GAME_VERSIONS } from "@/lib/game-version";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<GameVersionLabel />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const button = () => container.querySelector("button")!;
const menu = () => container.querySelector<HTMLElement>("#game-version-menu")!;

test("the button names the version and the menu starts closed", () => {
  expect(button().textContent).toBe("Build 1.60.1");
  expect(button().getAttribute("aria-label")).toBe("Game version: Build 1.60.1");
  expect(button().getAttribute("aria-expanded")).toBe("false");
  expect(menu().hidden).toBe(true);
});

// Which version is current comes from lib/game-version.ts (Beta before launch, Live after), which its own test pins.
test("opening lists the unavailable versions as disabled with their note, and the current one with the full build", async () => {
  await act(async () => button().click());
  expect(button().getAttribute("aria-expanded")).toBe("true");
  expect(menu().hidden).toBe(false);
  const rows = [...menu().querySelectorAll("li")];
  expect(rows.map((r) => r.firstElementChild?.textContent)).toEqual(["Live", "PTR", "Beta"]);
  GAME_VERSIONS.forEach((v, i) => {
    if (v.id === CURRENT_VERSION.id) {
      expect(rows[i].getAttribute("aria-disabled"), v.id).toBeNull();
      expect(rows[i].getAttribute("aria-current"), v.id).toBe("true");
      expect(rows[i].textContent, v.id).toContain(CURRENT_VERSION.build!);
    } else {
      expect(rows[i].getAttribute("aria-disabled"), v.id).toBe("true");
      expect(rows[i].textContent, v.id).toContain(v.note!);
    }
  });
});

test("Escape closes the menu and returns focus to the button", async () => {
  await act(async () => button().click());
  button().focus();
  await act(async () => { button().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(menu().hidden).toBe(true);
  expect(document.activeElement).toBe(button());
});
