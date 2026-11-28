// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import LevelingGuide from "./leveling-guide";
import type { ProfessionGuideRecipe } from "@/lib/profession-guide-data";

const recipes: ProfessionGuideRecipe[] = [{
  id: 10, name: "Practice Potion", reagents: [{ itemId: 11, count: 2 }],
  windows: [{ fromSkill: 1, toSkill: 3, points: 1, chance: 1, evidence: "observed" }],
  prices: { materials: null }, trainingCopper: 15, output: null,
  source: { kind: "trainer", npcIds: [12], provider: "everloot" },
}];

test("updates the route and shareable URL as skill changes while keeping the last valid plan during editing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ houses: {} }) }));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  window.history.replaceState(null, "", "/tools/professions/alchemy?class=mage#prof-path");
  try {
    await act(async () => root.render(<LevelingGuide profession="Alchemy" recipes={recipes}
      items={{ 11: { name: "Peacebloom" } }} from={1} to={3} />));
    expect(host.textContent).toContain("Practice Potion");
    expect(host.textContent).toContain("4 × Peacebloom");
    expect(host.textContent).toContain("Copy shopping list");
    expect(host.textContent).not.toContain("Copy for Everloot");
    expect(host.textContent).not.toContain("Plan route");
    expect(host.querySelector('a[href="/database/npcs/12"]')).toBeNull();
    const details = [...host.querySelectorAll("details")].find(node => node.textContent === "Recipe details")!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    expect(host.querySelector('a[href="/database/npcs/12"]')).not.toBeNull();
    const goal = host.querySelector<HTMLInputElement>('input[name="to"]')!;
    const edit = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(goal, value);
      goal.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await edit("");
    expect(host.textContent).toContain("Skill 1–3");
    expect(host.textContent).toContain("Enter whole skills");
    await edit("5");
    expect(host.textContent).toContain("3–5");
    expect(host.textContent).toContain("Recipe evidence missing");
    expect(window.location.search).toBe("?class=mage&from=1&to=5");
    expect(window.location.hash).toBe("#prof-path");
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  }
});

test("switches faction prices, labels stale quotes, and copies the current material list", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn(async (input: string) => {
    const query = new URL(input, "https://test.invalid").searchParams;
    if (!query.has("house")) return { ok: true, json: async () => ({ houses: { "Forever PvP": ["Alliance", "Horde"] } }) };
    const alliance = query.get("house") === "Alliance";
    return { ok: true, json: async () => ({ ok: true, items: [[11, 100, alliance ? 30 : 70, 100, 12, "2026-11-24", 3, null, alliance ? 3 : 1, null]] }) };
  });
  vi.stubGlobal("fetch", fetcher);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const button = (label: string) => [...host.querySelectorAll("button")].find(node =>
    node.textContent === label || node.querySelector("[data-copy-labels] > span")?.textContent === label)!;
  const change = async (label: string, value: string) => {
    const input = [...host.querySelectorAll("label")].find(node => node.textContent?.startsWith(label))!.querySelector("select")!;
    await act(async () => {
      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  try {
    await act(async () => root.render(<LevelingGuide profession="Alchemy" recipes={recipes} items={{ 11: { name: "Peacebloom" } }} from={1} to={3} />));
    expect(host.textContent).not.toContain("Load auction prices");
    await change("Realm", "Forever PvP");
    await change("Auction house", "Alliance");
    expect(host.textContent).toContain("1s 20c");
    expect(host.textContent).toContain("2026-11-24, stale");
    await change("Auction house", "Horde");
    expect(host.textContent).toContain("2s 80c");
    expect(host.textContent).not.toContain("1s 20c");
    expect(fetcher.mock.calls.filter(([input]) => input.includes("items=11"))).toHaveLength(2);
    await act(async () => button("Copy shopping list").click());
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("4 × Peacebloom · 2s 80c"));
  } finally {
    await act(async () => root.unmount());
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    Reflect.deleteProperty(navigator, "clipboard");
    vi.unstubAllGlobals();
  }
});
