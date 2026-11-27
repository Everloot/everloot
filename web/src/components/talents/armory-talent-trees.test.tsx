// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fixture } from "@/lib/talents/fixture";
import type { TalentCatalog } from "@/lib/talents/types";
import ArmoryTalentTrees from "./ArmoryTalentTrees";

const BASE = "https://assets.example.test/b";
const catalog: TalentCatalog = {
  ...fixture,
  nodes: fixture.nodes.map((n) => ({ ...n, entries: n.entries.map((e, i) => ({ ...e, definitionId: n.id * 10 + i })) })),
};
const at = (name: string, n: number) => Array.from({ length: n }, (_, i) => ({ text: `${name} gives ${(i + 1) * 3}%.`, unresolved: [] }));
const spells = Object.fromEntries(catalog.nodes.flatMap((n) => n.entries.map((e) => [
  String(e.definitionId),
  { spellId: 1, name: e.name, icon: null, passive: false, description: { text: `Text of ${e.name}.`, unresolved: [] }, ...(n.id === 11 ? { ranks: at(e.name, 5) } : {}) },
])));
const manifest = {
  schema: "everloot.game-assets/1", label: "found in game files, unconfirmed",
  build: { product: "p", buildId: 1, version: "9.9.9.1", buildConfig: "c", extractedAt: "2026-10-18T00:00:00.000Z" },
  spells, icons: {}, frames: {}, backgrounds: {},
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("a character's talent shows the amount of the rank they hold, and a tiered talent the entry that rank is in", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(manifest)));
  await act(async () => root.render(<ArmoryTalentTrees catalog={catalog} ranks={{ 11: { rank: 2 }, 53: { rank: 1 } }} />));
  const tip = () => document.querySelector("[data-talent-tooltip]")?.textContent ?? "";
  const focus = (id: number) => act(async () => { container.querySelector<HTMLElement>(`#talent-${id}`)!.focus(); });

  await focus(11);
  expect(tip()).toContain("Rank 2/5");
  expect(tip()).toContain("Talent 11 gives 6%.");
  expect(tip()).not.toContain("Text of Talent 11.");

  // One point in a tiered talent is its first entry, not the second.
  await focus(53);
  expect(tip()).toMatch(/^Tier oneRank 1\/3Text of Tier one\./);
});
