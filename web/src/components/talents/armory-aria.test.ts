import { expect, test } from "vitest";
import type { GameAssets } from "@/lib/talents/assets";
import type { TalentNode } from "@/lib/talents/types";
import { describeNode } from "./TalentTreeView";

const assets = (text: string): GameAssets => ({
  version: "1.60.1.71139", label: "found in game files", frames: new Map(), backgrounds: new Map(),
  spells: new Map([[7, { icon: null, passive: true, text, partial: true }]]),
});
const node: TalentNode = { id: 1, treeId: 1, row: 1, col: 1, maxRanks: 2, kind: "single", entries: [{ definitionId: 7, spellId: null, name: "Seal Fate" }] } as TalentNode;

test("a read-only talent's screen-reader text drops the [?]% as its tooltip does and says the amount is missing", () => {
  const out = describeNode(assets("Your critical strikes have a [?]% chance to add an additional combo point."), node, 1, true);
  expect(out).not.toContain("[?]");
  expect(out).toBe("Seal Fate. Your critical strikes have a chance to add an additional combo point. This rank's amount is not in the game files we read.");
});

test("no talent description reads the [?] mark aloud, in the calculator either", () => {
  expect(describeNode(assets("Increases damage by [?]%."), node, 1)).toBe("Seal Fate. Increases damage by (amount not in the game files).");
});
