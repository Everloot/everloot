// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ItemRecord } from "@kb/assets/items";
import type { ItemFactState } from "@kb/item-facts";
import { GameCard } from "@/components/game/GameCard";
import { itemTipText, withReported } from "./item-names";
import { itemTooltip, type ItemTooltipInput, type TooltipSet } from "./item-tooltip";
import { tipLine } from "./tip-line";

// Made-up records in the shard's shape: the names, effects, sets and flavour text are not the game's.
const base = { st: [], u: 0, d: 0, sp: 0, r: 0, b: 0, s: 0, cr: [], rq: [], fx: [] } satisfies Partial<ItemRecord>;
const WEAPON: ItemRecord = { ...base, n: "Synthetic Mace", q: 2, l: 20, r: 15, b: 2, s: 21, c: 2, sc: 4, d: 2600, sp: 1234, st: [7], fx: ["Chance on hit: Synthetic proc."] };
const ARMOR: ItemRecord = { ...base, n: "Synthetic Helm", q: 3, l: 40, r: 35, b: 1, s: 1, c: 4, sc: 3, st: [7, 4], sp: 5678, cr: ["Classes: Hunter, Shaman"] };
const USE: ItemRecord = { ...base, n: "Synthetic Draught", q: 1, l: 25, r: 20, c: 0, sc: 1, sp: 30, fx: ["Use: Restores [?] mana."] };
const SET_PIECE: ItemRecord = { ...base, n: "Synthetic Spaulders", q: 4, l: 66, r: 60, b: 1, s: 3, c: 4, sc: 4, st: [4], sp: 9000, is: { id: 77, n: "Synthetic Battlegear" }, t: "Made for a test." };
const QUEST: ItemRecord = { ...base, n: "Synthetic Letter", q: 1, l: 1, b: 4, c: 12, sc: 0, u: 1 };

const reported = (facts: [ItemFactState["shown"][number]["fact"], number, number][]): ItemFactState => ({
  shown: facts.filter(([, , n]) => n >= 3).map(([fact, value, reporters]) => ({ fact, value, reporters, build: "1.60.1.71139", lastSeen: "2026-11-20T10:00:00Z" })),
  unconfirmed: facts.filter(([, , n]) => n < 3).map(([fact, value, reporters]) => ({ fact, value, reporters, build: "1.60.1.71139", lastSeen: null })),
  contested: [],
});
const tipOf = (r: ItemRecord, state?: ItemFactState) => {
  const text = itemTipText(r, []);
  const tip = { ...text, icon: null, label: "Found in game files, unconfirmed · build 1.60.1.71139" };
  return state ? withReported(tip, state) : tip;
};
const named = (n: string) => ({ name: n, source: "players" as const, color: null, wikiPage: null });
const input = (r: ItemRecord, extra: Partial<ItemTooltipInput> = {}): ItemTooltipInput => ({
  id: 9001, tip: tipOf(r), name: named(r.n), category: { class: null, subclass: null, slot: null, quality: { id: r.q, name: "", slug: "" } }, ...extra,
});

const SET: TooltipSet = {
  id: 77, items: [9001, 9002, 9003, 9004], bonuses: [[2, 501], [4, 502]],
  pieceName: (id) => ({ 9001: "Synthetic Spaulders", 9002: "Synthetic Breastplate", 9004: "Monster - Synthetic Helm" } as Record<number, string>)[id],
  spellName: (id) => (id === 501 ? "Synthetic Fortitude" : undefined),
};

/** The box drawn, in a DOM: the hover card (no links) or the item page (links and a label). */
function drawn(t: ReturnType<typeof itemTooltip>, page = false): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(page ? <GameCard card={t.card} links={t.links} label="box" /> : <GameCard card={t.card} />);
  return root;
}
const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-tooltip-frame] > div > div > p")];
const row = (root: HTMLElement, text: string) => rows(root).find((p) => p.textContent!.replace(/\s+/g, " ").trim().startsWith(text))!;

describe("item tooltip, as the card and the page box draw it", () => {
  test("a weapon: slot and kind, damage and speed in two columns, its reported DPS and stamina in white, the proc green", () => {
    const t = itemTooltip(input(WEAPON, { tip: tipOf(WEAPON, reported([["damage_per_second", 12.5, 3], ["stamina", 4, 3]])) }));
    expect(t.card.title).toBe("Synthetic Mace");
    expect(t.card.quality).toBe(2);
    expect(t.card.lines.slice(0, 5)).toEqual(["Binds when equipped", "Main Hand · Mace", "[?] - [?] Damage · Speed 2.60", "(12.5 damage per second)", "+4 Stamina"]);
    const root = drawn(t);
    expect(row(root, "(12.5 damage per second)").className).toBe("text-fg");
    expect(row(root, "+4 Stamina").className).toBe("text-fg");
    expect(row(root, "Chance on hit:").className).toBe("text-q-uncommon");
    expect(root.querySelectorAll("[data-tip-pair]")).toHaveLength(2);
    // The damage range is still [?]: the reason goes under the box, not inside it.
    expect(root.querySelector("[data-card-notes]")!.textContent).toContain("[?] damage");
  });

  test("armour with stats: the reported armour and stat white, an unreported stat's [?] neutral, a reported resistance added in white", () => {
    const t = itemTooltip(input(ARMOR, { tip: tipOf(ARMOR, reported([["armor", 210, 3], ["stamina", 11, 3], ["fire_resistance", 10, 3], ["strength", 7, 1]])) }));
    const root = drawn(t);
    expect(rows(root).map((p) => p.textContent).slice(0, 8)).toEqual([
      "Item Level 40", "Binds when picked up", "Head, Mail", "210 Armor", "+11 Stamina", "+7 Strength (unconfirmed, seen by 1 player)", "+10 Fire Resistance", "Classes: Hunter, Shaman",
    ]);
    for (const white of ["210 Armor", "+11 Stamina", "+7 Strength", "+10 Fire Resistance"]) expect(row(root, white).className, white).toBe("text-fg");
    expect(row(root, "Classes:").className).toBe("");
    expect(tipLine("+[?] Stamina").kind).toBe("plain");
    expect(tipLine("[?] Armor").kind).toBe("plain");
  });

  test("a Use item: the Use line green, a [?] in it explained under the box", () => {
    const root = drawn(itemTooltip(input(USE)));
    expect(row(root, "Use: Restores [?] mana.").className).toBe("text-q-uncommon");
    expect(root.querySelector("[data-card-notes]")!.textContent).toContain("Use, Equip or Chance on hit");
  });

  test("a set piece: the set's name over its pieces and bonuses, as the game lays it out, linked on the page only", () => {
    const t = itemTooltip(input(SET_PIECE, { set: SET }));
    const at = t.card.lines.indexOf("Synthetic Battlegear (0/3)");
    expect(at).toBeGreaterThan(0);
    // The development leftover stays out, a piece with no shown name is its id, a bonus without a name its spell id.
    expect(t.card.lines.slice(at, at + 6)).toEqual([
      "Synthetic Battlegear (0/3)", "  Synthetic Spaulders", "  Synthetic Breastplate", "  Item 9003", "(2) Set: Synthetic Fortitude", "(4) Set: Spell 502",
    ]);
    expect(t.card.lines).not.toContain("Set: Synthetic Battlegear");
    expect(t.card.lines.at(-2)).toBe('"Made for a test."');
    expect(t.links).toEqual({
      "Synthetic Battlegear (0/3)": "/database/item-sets/77", "  Synthetic Spaulders": "/database/items/9001",
      "  Synthetic Breastplate": "/database/items/9002", "  Item 9003": "/database/items/9003",
    });

    const card = drawn(t);
    expect(row(card, "Synthetic Battlegear (0/3)").className).toBe("text-tip-yellow");
    expect(row(card, "Synthetic Breastplate").className).toBe("pl-2.5 text-muted");
    expect(row(card, "(2) Set: Synthetic Fortitude").className).toBe("text-muted");
    expect(card.querySelectorAll("a")).toHaveLength(0);

    const page = drawn(t, true);
    expect([...page.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Synthetic Battlegear (0/3)", "/database/item-sets/77"], ["Synthetic Spaulders", "/database/items/9001"],
      ["Synthetic Breastplate", "/database/items/9002"], ["Item 9003", "/database/items/9003"],
    ]);
    expect(page.querySelector("[data-tooltip-frame]")!.getAttribute("aria-label")).toBe("box");
    // The same lines, in the same colours: only the links differ.
    expect(rows(page).map((p) => [p.textContent, p.className])).toEqual(rows(card).map((p) => [p.textContent, p.className]));
  });

  test("a set whose name the files do not give keeps its [?] neutral", () => {
    const t = itemTooltip(input({ ...SET_PIECE, is: { id: 77, n: null } }, { set: SET }));
    expect(t.card.lines).toContain("[?] (0/3)");
    expect(tipLine("[?] (0/3)").kind).toBe("plain");
    expect(t.card.notes?.some((n) => n.includes("set"))).toBe(true);
  });

  test("a quest item: Quest Item and Unique, neutral, no price", () => {
    const root = drawn(itemTooltip(input(QUEST)));
    expect(rows(root).map((p) => [p.textContent, p.className])).toEqual([["Item Level 1", "text-tip-yellow"], ["Quest Item", ""], ["Unique", ""]]);
  });

  test("the gates: no shown name is Item N without a colour; no game file tooltip is only the type and slot", () => {
    const anon = itemTooltip(input(ARMOR, { name: null }));
    expect(anon.card.title).toBe("Item 9001");
    expect(anon.card.quality).toBeNull();
    const hidden = itemTooltip(input(ARMOR, {
      tip: undefined, set: SET,
      category: { class: { id: 4, name: "Armor", label: "Armor", slug: "armor" }, subclass: { id: 3, name: "Mail", slug: "mail" }, slot: { inventoryType: 1, name: "Head", slug: "head" }, quality: null },
    }));
    expect(hidden.card.lines).toEqual(["Mail", "Head"]);
    expect(hidden.card.notes).toBeUndefined();
    expect(hidden.links).toEqual({});
  });
});
