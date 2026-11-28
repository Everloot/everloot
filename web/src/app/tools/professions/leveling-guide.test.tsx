// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import LevelingGuide from "./leveling-guide";
import type { ProfessionGuideRecipe } from "@/lib/profession-guide-data";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const recipes: ProfessionGuideRecipe[] = [{
  id: 10, name: "Practice Potion", reagents: [{ itemId: 11, count: 2 }],
  windows: [{ fromSkill: 1, toSkill: 3, points: 1, chance: 1, evidence: "observed" }],
  prices: { materials: null }, trainingCopper: 15, output: null,
  source: { kind: "trainer", npcIds: [12], provider: "everloot" },
}];

test("shows a usable route and shopping list with unknown prices, then replans and makes evidence gaps visible", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<LevelingGuide profession="Alchemy" recipes={recipes}
      items={{ 11: { name: "Peacebloom" } }} from={1} to={3} />));
    expect(host.textContent).toContain("Practice Potion");
    expect(host.textContent).toContain("4 × Peacebloom");
    expect(host.textContent).toContain("Copy shopping list");
    expect(host.textContent).not.toContain("Copy for Everloot");
    expect(host.textContent).toContain("15c");
    expect(host.querySelector('a[href="/database/npcs/12"]')).not.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    const goal = host.querySelector<HTMLInputElement>('input[name="to"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(goal, "5");
      goal.dispatchEvent(new Event("input", { bubbles: true }));
      goal.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(host.textContent).toContain("3–5");
    expect(host.textContent).toContain("Recipe evidence missing");
    expect(replace).toHaveBeenCalledWith(expect.stringMatching(/\?from=1&to=5$/), { scroll: false });
  } finally {
    await act(async () => root.unmount());
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
    await act(async () => button("Load auction prices").click());
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
    Reflect.deleteProperty(navigator, "clipboard");
    vi.unstubAllGlobals();
  }
});
