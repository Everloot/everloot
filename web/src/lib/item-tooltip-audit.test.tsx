// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ItemRecord } from "@kb/assets/items";
import type { ItemCategory } from "@kb/item-taxonomy";
import type { ItemFactState } from "@kb/item-facts";
import { GameCard } from "@/components/game/GameCard";
import { itemTipText, withReported } from "./item-names";
import { itemTooltip, type ItemTooltipInput, type TooltipSet } from "./item-tooltip";
import { tipLine } from "./tip-line";

// The tooltip audit's twelve kinds of item (C:/tmp/site-v5/tooltip-audit/findings.md), as made-up records in the
// shard's shape: the names, effects, sets and flavour text are not the game's.
const base = { st: [], u: 0, d: 0, sp: 0, r: 0, b: 0, s: 0, cr: [], rq: [], fx: [] } satisfies Partial<ItemRecord>;
const KINDS: Record<string, ItemRecord> = {
  weapon: { ...base, n: "Synthetic Blade", q: 3, l: 24, r: 19, b: 2, s: 13, c: 2, sc: 7, d: 1800, sp: 2345, st: [4] },
  armor: { ...base, n: "Synthetic Jerkin", q: 2, l: 18, r: 13, b: 2, s: 5, c: 4, sc: 2, st: [3, 7], sp: 412 },
  setPiece: { ...base, n: "Synthetic Spaulders", q: 4, l: 66, r: 60, b: 1, s: 3, c: 4, sc: 4, st: [4], sp: 90000, is: { id: 77, n: "Synthetic Battlegear" }, t: "Made for a test." },
  trinket: { ...base, n: "Synthetic Charm", q: 3, l: 58, r: 53, b: 1, s: 12, c: 4, sc: 0, sp: 10001, lc: "Unique-Equipped: Synthetic Charms (1)", fx: ["Equip: Synthetic ward."] },
  consumable: { ...base, n: "Synthetic Draught", q: 1, l: 55, r: 45, c: 0, sc: 1, sp: 1000, fx: ["Use: Restores 10 to 20 synthetic."] },
  recipe: { ...base, n: "Pattern: Synthetic Vest", q: 1, l: 12, c: 9, sc: 2, sp: 50, rq: ["Requires Tailoring (35)"], t: "Teaches a synthetic vest." },
  bag: { ...base, n: "Synthetic Pouch", q: 1, l: 5, s: 18, c: 1, sc: 0, sp: 200 },
  questStarter: { ...base, n: "Synthetic Note", q: 1, l: 7, r: 7, b: 1, c: 12, sc: 0, u: 1, qs: 4321 },
  classOnly: { ...base, n: "Synthetic Vestments", q: 3, l: 40, r: 35, b: 1, s: 20, c: 4, sc: 1, st: [5, 6], sp: 6000, cr: ["Classes: Priest", "Races: Synthetic"] },
  boeGreen: { ...base, n: "Synthetic Boots", q: 2, l: 30, r: 25, b: 2, s: 8, c: 4, sc: 3, st: [3], sp: 777 },
  noSell: { ...base, n: "Synthetic Heirloom", q: 7, l: 1, r: 1, b: 1, s: 16, c: 4, sc: 1, st: [7] },
  reagent: { ...base, n: "Synthetic Cloth", q: 1, l: 5, c: 7, sc: 5, sp: 13 },
};

const quality = (id: number) => ({ id, name: "", slug: "" });
const tipOf = (r: ItemRecord, state?: ItemFactState) => {
  const tip = { ...itemTipText(r, []), icon: null, label: "Found in game files, unconfirmed · build 1.60.1.71139" };
  return state ? withReported(tip, state) : tip;
};
const input = (r: ItemRecord, extra: Partial<ItemTooltipInput> = {}): ItemTooltipInput => ({
  id: 9001, tip: tipOf(r), name: { name: r.n, source: "players", color: null, wikiPage: null },
  category: { class: null, subclass: null, slot: null, quality: quality(r.q) }, ...extra,
});
const SET: TooltipSet = {
  id: 77, items: [9001, 9002, 9003], bonuses: [[2, 501], [3, 502]],
  pieceName: (id) => ({ 9001: "Synthetic Spaulders", 9002: "Synthetic Breastplate", 9003: "Synthetic Helm" } as Record<number, string>)[id],
  spellName: (id) => (id === 501 ? "Synthetic Fortitude" : "Synthetic Might"),
};
const DPS_ONE: ItemFactState = {
  shown: [], contested: [], unconfirmed: [{ fact: "damage_per_second", value: 9.1, reporters: 1, build: "1.60.1.71139", lastSeen: null }],
};

function drawn(t: ReturnType<typeof itemTooltip>): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<GameCard card={t.card} />);
  return root;
}
const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-tooltip-frame] > div > div > p")];
const row = (root: HTMLElement, text: string) => rows(root).find((p) => p.textContent!.replace(/\s+/g, " ").trim().startsWith(text))!;

describe("the tooltip audit's twelve kinds of item", () => {
  for (const [kind, record] of Object.entries(KINDS)) {
    test(`${kind}: lines and drawn box`, () => {
      const t = itemTooltip(input(record, kind === "setPiece" ? { set: SET } : kind === "weapon" ? { tip: tipOf(record, DPS_ONE) } : {}));
      expect(t.card.lines).toMatchSnapshot();
      expect(drawn(t).innerHTML).toMatchSnapshot();
    });
  }
});

describe("what the audit changed", () => {
  test("the sell price leaves out a coin that is zero, as the game's tooltip money format does", () => {
    expect(itemTipText(KINDS.consumable).lines.at(-1)).toBe("Sell Price: 10s");
    expect(itemTipText(KINDS.setPiece).lines.at(-1)).toBe("Sell Price: 9g");
    expect(itemTipText(KINDS.trinket).lines.at(-1)).toBe("Sell Price: 1g 1c");
    expect(itemTipText(KINDS.reagent).lines.at(-1)).toBe("Sell Price: 13c");
    expect(itemTipText(KINDS.weapon).lines.at(-1)).toBe("Sell Price: 23s 45c");
    expect(tipLine("Sell Price: 10s")).toEqual({ kind: "price", label: "Sell Price:", coins: [{ metal: "silver", amount: 10 }] });
    expect(tipLine("Sell Price: 1g 1c")).toEqual({ kind: "price", label: "Sell Price:", coins: [{ metal: "gold", amount: 1 }, { metal: "copper", amount: 1 }] });
    // The older full form still reads as a price, and lines that are not one stay plain.
    expect(tipLine("Sell Price: 1g 0s 0c").kind).toBe("price");
    for (const line of ["Sell Price: ", "Sell Price: 1x", "Sell Price 13c"]) expect(tipLine(line).kind, line).toBe("plain");
    const price = row(drawn(itemTooltip(input(KINDS.consumable))), "Sell Price:");
    expect([...price.querySelectorAll("svg > use")].map((c) => c.getAttribute("href"))).toEqual(["#coin-s"]);
  });

  test("a gated card draws the slot left and the kind right, as the game's slot line", () => {
    const category = (classId: number, subclassId: number, inventoryType: number): ItemCategory => ({
      itemId: 1, class: { id: classId, name: "", label: "Armor", slug: "" }, subclass: { id: subclassId, name: "One-Handed Swords", slug: "" },
      slot: { inventoryType, name: "", slug: "" }, quality: null,
    });
    const gated = (c: ItemCategory) => itemTooltip({ id: 1, tip: undefined, name: null, category: c }).card.lines;
    expect(gated(category(2, 7, 21))).toEqual(["Main Hand · Sword"]);
    expect(gated(category(4, 2, 5))).toEqual(["Chest · Leather"]);
    // A trinket's kind is Miscellaneous: the game prints the slot alone.
    expect(gated(category(4, 0, 12))).toEqual(["Trinket"]);
    // Not worn: the subclass's name, as before.
    expect(gated({ ...category(7, 5, 0), slot: null, subclass: { id: 5, name: "Cloth", slug: "" } })).toEqual(["Cloth"]);
    expect(tipLine("Main Hand · Sword").kind).toBe("pair");
  });

  test("the set's name and its bonuses each open with the game's blank line", () => {
    const root = drawn(itemTooltip(input(KINDS.setPiece, { set: SET })));
    expect(row(root, "Synthetic Battlegear (0/3)").className).toBe("mt-2 text-tip-yellow");
    expect(row(root, "(2) Set: Synthetic Fortitude").className).toBe("mt-2 text-muted");
    expect(row(root, "(3) Set: Synthetic Might").className).toBe("text-muted");
    expect(row(root, "Synthetic Breastplate").className).toBe("pl-2.5 text-muted");
  });

  test("an unconfirmed number keeps its mark, set apart in the muted colour", () => {
    const line = row(drawn(itemTooltip(input(KINDS.weapon, { tip: tipOf(KINDS.weapon, DPS_ONE) }))), "(9.1 damage per second)");
    expect(line.className).toBe("text-fg");
    const mark = line.querySelector("[data-unconfirmed]")!;
    expect(mark.textContent).toBe("(unconfirmed, seen by 1 player)");
    expect(mark.className).toContain("text-muted");
    expect(line.textContent).toBe("(9.1 damage per second) (unconfirmed, seen by 1 player)");
  });
});
