// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Tabs } from "@/components/ui";

const action = vi.hoisted(() => ({ characterTab: vi.fn() }));
vi.mock("./[region]/[slug]/tab-action", () => action);
const { default: LaterTab } = await import("./[region]/[slug]/later-tab");

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/armory/eu/velkara-duskmantle");
  action.characterTab.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const sheet = () => (
  <Tabs label="Sheet" tabs={[
    { id: "talents", label: "Talents", panel: <p>Trees</p> },
    { id: "reputations", label: "Reputations", panel: <LaterTab region="eu" slug="velkara-duskmantle" tab="reputations" /> },
  ]} />
);
const panel = (id: string) => container.querySelector(`[data-tab-panel="${id}"]`)!;
const tab = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === name)!;

test("a tab's content loads the first time it opens, once, and stays", async () => {
  action.characterTab.mockResolvedValue(<p>Darkspear Trolls</p>);
  await act(async () => root.render(sheet()));
  expect(action.characterTab).not.toHaveBeenCalled();
  expect(panel("reputations").textContent).toBe("Loading…");

  await act(async () => tab("Reputations").click());
  expect(action.characterTab).toHaveBeenCalledWith("eu", "velkara-duskmantle", "reputations");
  expect(panel("reputations").textContent).toBe("Darkspear Trolls");

  await act(async () => tab("Talents").click());
  await act(async () => tab("Reputations").click());
  expect(action.characterTab).toHaveBeenCalledTimes(1);
  expect(panel("reputations").textContent).toBe("Darkspear Trolls");
});

test("an address naming the tab loads it on arrival", async () => {
  window.history.replaceState(null, "", "/armory/eu/velkara-duskmantle#reputations");
  action.characterTab.mockResolvedValue(<p>Darkspear Trolls</p>);
  await act(async () => root.render(sheet()));
  expect(action.characterTab).toHaveBeenCalledTimes(1);
  expect(panel("reputations").textContent).toBe("Darkspear Trolls");
});

test("a failed load says so and can be tried again", async () => {
  action.characterTab.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(<p>Darkspear Trolls</p>);
  await act(async () => root.render(sheet()));
  await act(async () => tab("Reputations").click());
  expect(panel("reputations").textContent).toContain("This tab did not load.");
  expect(panel("reputations").textContent).toContain("Reload the page");
  await act(async () => panel("reputations").querySelector("button")!.click());
  expect(action.characterTab).toHaveBeenCalledTimes(2);
  expect(panel("reputations").textContent).toBe("Darkspear Trolls");
});
