// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ItemRecord } from "../../../../kb/src/assets/items";
import { GameCard } from "@/components/game/GameCard";
import { itemTipText } from "@/lib/item-names";
import { itemFactLines, NO_ITEM_FACTS } from "@/lib/tooltip";
import { gameOrder, tipLine } from "@/lib/tip-line";

// Made-up records in the shard's shape: the names, effects and flavour text are not the game's.
const base = { st: [], u: 0, d: 0, sp: 0, r: 0, b: 0, s: 0, cr: [], rq: [], fx: [] } satisfies Partial<ItemRecord>;
const WEAPON: ItemRecord = { ...base, n: "Test Mace", q: 2, l: 9, r: 4, b: 2, s: 21, c: 2, sc: 4, d: 2100, sp: 110, fx: ["Chance on hit: Synthetic effect."] };
const ARMOR: ItemRecord = {
  ...base, n: "Test Helm", q: 4, l: 61, r: 56, b: 2, s: 1, c: 4, sc: 4, st: [4, 32], sp: 21894,
  cr: ["Classes: Warrior"], fx: ["Equip: Synthetic effect."], is: { id: 1, n: "Synthetic Battlegear" }, t: "Synthetic.",
};
const CONSUMABLE: ItemRecord = { ...base, n: "Test Bread", q: 1, l: 5, r: 1, c: 0, sc: 5, sp: 1, fx: ["Use: Restores [?] health over 18 sec."] };
const QUEST: ItemRecord = { ...base, n: "Test Letter", q: 1, l: 1, b: 4, c: 12, sc: 0, u: 1 };

/** The card as the hover card and the chat draw it, in a DOM to read back. */
function card(lines: string[]): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<GameCard card={{ title: "Test", quality: 1, icon: null, lines, foot: null }} />);
  return root;
}
const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-tooltip-frame] > div > div > p")];
/** What a screen reader says for a line: a coin by its metal's name. */
function spoken(p: HTMLElement): string {
  const copy = p.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((img) => img.remove());
  return copy.textContent!.replace(/\s+/g, " ").trim();
}
const row = (root: HTMLElement, start: string) => rows(root).find((p) => p.textContent!.startsWith(start))!;

describe("item tooltip lines", () => {
  test("a weapon: item level first, slot and kind and damage and speed in two columns, its proc in green", () => {
    const lines = itemTipText(WEAPON).lines;
    const root = card(lines);
    // One element per line, in the game's order (the item level moved up under the name, nothing else), reading the
    // same as the text (a pair's halves joined for screen readers).
    expect(rows(root).map(spoken)).toEqual(gameOrder(lines).map((l) => l.replace(" · ", ", ").replace("1s 10c", "1 silver 10 copper")));
    expect(rows(root).map(spoken)).toEqual([
      "Item Level 9", "Binds when equipped", "Main Hand, Mace", "[?] - [?] Damage, Speed 2.10", "([?] damage per second)",
      "Requires Level 4", "Chance on hit: Synthetic effect.", "Sell Price: 1 silver 10 copper",
    ]);
    expect(rows(root)[0].className).toBe("text-tip-yellow");
    const pairs = [...root.querySelectorAll("[data-tip-pair]")].map((p) => [...p.children].filter((c) => !c.classList.contains("sr-only")).map((c) => c.textContent));
    expect(pairs).toEqual([["Main Hand", "Mace"], ["[?] - [?] Damage", "Speed 2.10"]]);
    expect(root.querySelector("[data-tip-pair]")!.className).toContain("justify-between");
    expect(row(root, "Chance on hit:").className).toBe("text-q-uncommon");
    expect(row(root, "Requires Level 4").className).toBe("");
    expect(spoken(row(root, "Sell Price:"))).toBe("Sell Price: 1 silver 10 copper");
  });

  test("armor: requirements neutral, Equip green, the set and the flavour text yellow, the price in three coins", () => {
    const root = card(itemTipText(ARMOR).lines);
    expect(rows(root).map(spoken).slice(0, 3)).toEqual(["Item Level 61", "Binds when equipped", "Head, Plate"]);
    for (const neutral of ["Binds when equipped", "Classes: Warrior", "Requires Level 56", "+[?] Strength"]) expect(row(root, neutral).className, neutral).toBe("");
    expect(row(root, "Equip:").className).toBe("text-q-uncommon");
    expect(row(root, "Set: Synthetic Battlegear").className).toBe("text-tip-yellow");
    expect(row(root, '"Synthetic."').className).toBe("text-tip-yellow");
    const price = row(root, "Sell Price:");
    expect(spoken(price)).toBe("Sell Price: 2 gold 18 silver 94 copper");
    expect([...price.querySelectorAll("svg")].map((c) => c.getAttribute("class")))
      .toEqual(expect.arrayContaining([expect.stringContaining("text-coin-gold"), expect.stringContaining("text-coin-silver"), expect.stringContaining("text-coin-copper")]));
    expect(price.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(3);
  });

  test("the site moves the item level under the name and leaves the lines it is given in the order it got them", () => {
    for (const record of [WEAPON, ARMOR]) {
      const lines = itemTipText(record).lines;
      const before = [...lines];
      const shown = gameOrder(lines);
      expect(lines).toEqual(before);
      expect(shown[0]).toBe(`Item Level ${record.l}`);
      // Only that one line moved: the rest keep their relative order.
      expect(shown.slice(1)).toEqual(lines.filter((l) => !l.startsWith("Item Level ")));
    }
    // Nothing to move: no item level, or already first.
    expect(gameOrder(["Quest Item", "Unique"])).toEqual(["Quest Item", "Unique"]);
    expect(gameOrder(["Item Level 5", "Use: x"])).toEqual(["Item Level 5", "Use: x"]);
  });

  test("a consumable: its Use line green, a copper-only price, no columns", () => {
    const root = card(itemTipText(CONSUMABLE).lines);
    expect(rows(root).map(spoken)).toEqual(["Item Level 5", "Use: Restores [?] health over 18 sec.", "Sell Price: 1 copper"]);
    expect(row(root, "Use:").className).toBe("text-q-uncommon");
    expect(root.querySelector("[data-tip-pair]")).toBeNull();
    expect(spoken(row(root, "Sell Price:"))).toBe("Sell Price: 1 copper");
  });

  test("a quest item: its binding line and Unique neutral, and no price when it sells for nothing", () => {
    const root = card(itemTipText(QUEST).lines);
    expect(rows(root).map((p) => [p.textContent, p.className])).toEqual([["Item Level 1", "text-tip-yellow"], ["Quest Item", ""], ["Unique", ""]]);
    expect(root.querySelector("[role=img]")).toBeNull();
  });

  test("an item without the game files: every placeholder line stays neutral, Set and Equip and Use too", () => {
    const lines = itemFactLines(NO_ITEM_FACTS, false);
    const root = card(lines);
    expect(rows(root).map((p) => [p.textContent, p.className])).toEqual(lines.map((l) => [l, ""]));
  });

  test("lines that only look like item lines are drawn as they are", () => {
    // An NPC or quest card's lines, and pairs whose halves are not a slot and a kind.
    for (const line of ["Level 12", "Trade Goods · Cloth", "Seen on 2 maps, agreed by 3 or more installs.", "Sell Price 13c", "Set: [?]"])
      expect(tipLine(line), line).toEqual({ kind: "plain", text: line });
    expect(tipLine("Off Hand · Shield")).toEqual({ kind: "pair", left: "Off Hand", right: "Shield" });
    expect(tipLine("10 - 20 Fire Damage · Speed 1.80")).toEqual({ kind: "pair", left: "10 - 20 Fire Damage", right: "Speed 1.80" });
  });
});
