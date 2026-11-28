// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import legacyPerks from "@/data/game-data/legacy-perks.json";
import type { LegacyPerkCatalog } from "@kb/legacy-perks/catalog";
import LegacyPlanner from "./LegacyPlanner";
import { encodePlan, type Purchase } from "./plan";

// Same serializable catalog passed into the client component by the server; page.test validates the actual JSON.
const LEGACY_PERKS = legacyPerks as LegacyPerkCatalog;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/tools/legacy");
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(navigator, "clipboard");
  vi.unstubAllGlobals();
});

const render = () => act(async () => root.render(<LegacyPlanner catalog={LEGACY_PERKS} />));
const text = () => container.textContent ?? "";
const button = (label: string) => [...container.querySelectorAll("button")].find((element) =>
  (element.getAttribute("aria-label") ?? element.textContent?.trim()) === label)!;
const click = (label: string) => act(async () => button(label).click());

test("edits ranks, explains stored blockers, and restores a saved plan after reset", async () => {
  await render();
  expect(button("Add rank to Dedicated Study").disabled).toBe(true);
  expect(text()).toContain("Requires Bartering.");
  expect(button("Add rank to Bartering").disabled).toBe(false);
  await click("Add rank to Bartering");
  expect(text()).toContain("Estimated gate spend 0/5 before first rank (below gate).");
  await click("Add rank to Dedicated Study");
  expect(button("Remove rank from Bartering").disabled).toBe(true);
  expect(text()).toContain("2 ranks planned");
  await click("Save on this device");
  await click("Reset plan");
  expect(text()).toContain("0 ranks planned");
  await click("Load saved plan");
  expect(text()).toContain("2 ranks planned");
  expect(text()).toContain("Loaded the saved plan.");
});

test("opens a share link in purchase order and exposes a manual link when clipboard access fails", async () => {
  const find = (name: string): Purchase => {
    const node = LEGACY_PERKS.trees.flatMap((tree) => tree.nodes).find((perk) => perk.entries[0]?.name === name)!;
    return [node.id, node.entries[0]!.id];
  };
  const code = encodePlan(LEGACY_PERKS.build.buildId, [find("Bartering"), find("Dedicated Study"), find("Well Rested")]);
  window.history.replaceState(null, "", `/tools/legacy#everloot-cookie-rejected&legacy=${code}&everloot-analytics-rejected`);
  await render();
  expect(text()).toContain("3 ranks planned");
  expect(text()).toContain("Loaded the linked plan.");

  const copy = container.querySelector<HTMLButtonElement>("button:has([data-copy-labels])")!;
  await act(async () => copy.click());
  const link = container.querySelector<HTMLInputElement>('input[aria-label="Plan link"]')!;
  expect(new URL(link.value).hash).toBe(`#legacy=${code}`);

  await click("Reset plan");
  expect(window.location.hash).toBe("#everloot-cookie-rejected&everloot-analytics-rejected");
  expect(text()).toContain("0 ranks planned");
  await act(async () => {
    window.history.replaceState(null, "", "/tools/legacy#legacy=invalid");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(text()).toContain("This linked Legacy plan is damaged or uses an unsupported format.");
  expect(text()).toContain("0 ranks planned");
});
