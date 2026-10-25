import { expect, test } from "vitest";
import { PLACEHOLDER, resolveTooltip, type SpellFacts } from "../src/assets/tooltip.js";

const eff = (index: number, basePoints: number, extra: Partial<SpellFacts["effects"][number]> = {}) =>
  ({ index, basePoints, dieSides: 0, periodMs: 0, chainTargets: 0, radiusYards: null, ...extra });
const self: SpellFacts = {
  effects: [eff(0, 15), eff(1, -30, { periodMs: 3000 }), eff(2, 9, { dieSides: 4 })],
  durationMs: 12000, procChance: 20, name: "Test",
};

test("effect values, duration and period", () => {
  expect(resolveTooltip("Deals $s1 damage every $t2 sec for $d.", self)).toEqual({ text: "Deals 15 damage every 3 sec for 12 sec.", unresolved: [] });
  expect(resolveTooltip("Reduces by $s2%.", self).text).toBe("Reduces by 30%.");
  expect(resolveTooltip("Total $o2.", self).text).toBe("Total 120.");
});

test("dice give a range, and $m and $M its ends", () => {
  expect(resolveTooltip("$s3 / $m3 / $M3", self).text).toBe("10 to 13 / 10 / 13");
});

test("a variance gives the game's range around the base; an expression keeps the base", () => {
  // Minor Mana Potion (base 160, variance 0.25) "restores 140 to 180 mana" (Warcraft Wiki); Frostbolt rank 1 is 19 and 0.105.
  const potion: SpellFacts = { effects: [eff(0, 160, { variance: 0.25 })], durationMs: null };
  expect(resolveTooltip("Restores $s1 mana.", potion).text).toBe("Restores 140 to 180 mana.");
  expect(resolveTooltip("$m1 / $M1 / ${$s1*2}", potion).text).toBe("140 / 180 / 320");
  expect(resolveTooltip("Causes $s1 Frost damage.", { effects: [eff(0, 19, { variance: 0.10526315867900848 })], durationMs: null }).text).toBe("Causes 18 to 20 Frost damage.");
  expect(resolveTooltip("$s1", { effects: [eff(0, 160, { variance: 0 })], durationMs: null }).text).toBe("160");
});

test("arithmetic, divided tokens and proc chance", () => {
  expect(resolveTooltip("${$s1*2} and ${$s1/4}.1 and $/5;s1 and $h%", self).text).toBe("30 and 3.8 and 3 and 20%");
});

test("plural follows the number before it", () => {
  expect(resolveTooltip("$s1 $lcharge:charges;", self).text).toBe("15 charges");
  expect(resolveTooltip("$s1 $lcharge:charges;", { ...self, effects: [eff(0, 1)] }).text).toBe("1 charge");
});

test("what the tables do not hold stays an honest placeholder", () => {
  const r = resolveTooltip("Hits $s4 targets, $a1 yards, $?s12345[more][less] and $q1.", self);
  expect(r.text).toBe(`Hits ${PLACEHOLDER} targets, ${PLACEHOLDER} yards, ${PLACEHOLDER} and ${PLACEHOLDER}.`);
  expect(r.unresolved).toEqual(["$s4", "$a1", "$?s12345[more][less]", "$q1"]);
});

test("a value inside an expression that is missing leaves the whole expression open", () => {
  const r = resolveTooltip("${$s9*2} damage", self);
  expect(r.text).toBe(`${PLACEHOLDER} damage`);
  expect(r.unresolved).toEqual(["${$s9*2}"]);
});

test("another spell's numbers and name", () => {
  const others = (id: number) => (id === 99 ? { effects: [eff(0, 7)], durationMs: 5000, name: "Other" } : undefined);
  expect(resolveTooltip("Casts $@spellname99 for $99s1 over $99d.", self, others).text).toBe("Casts Other for 7 over 5 sec.");
  expect(resolveTooltip("$98s1", self, others).unresolved).toEqual(["$98s1"]);
});

test("another spell's description is resolved with that spell's own numbers", () => {
  const others = (id: number): SpellFacts | undefined => id === 99
    ? { effects: [eff(0, 40)], durationMs: 6000, description: "Restores $s1 health over $d." }
    : id === 98 ? { effects: [], durationMs: null, description: "Gives $s3 and $@spelldesc98." }
    : id === 97 ? { effects: [], durationMs: null } : undefined;
  expect(resolveTooltip("Eat. $@spelldesc99", self, others)).toEqual({ text: "Eat. Restores 40 health over 6 sec.", unresolved: [] });
  // What the other description cannot resolve stays open, and is reported.
  expect(resolveTooltip("$@spelldesc98", self, others).unresolved).toContain("$s3");
  // No description, an unknown spell, or a loop between descriptions: one placeholder, never a guess.
  expect(resolveTooltip("$@spelldesc97 $@spelldesc96", self, others)).toEqual({ text: `${PLACEHOLDER} ${PLACEHOLDER}`, unresolved: ["$@spelldesc97", "$@spelldesc96"] });
  expect(resolveTooltip("$@spelldesc98", self, others).text).toContain(PLACEHOLDER);
});

test("a sentence prints the size of a reduction, an expression keeps the stored sign", () => {
  const cut: SpellFacts = { effects: [eff(0, -1500)], durationMs: null };
  expect(resolveTooltip("Reduces by $s1 and by ${$s1/-1000}.1 sec.", cut).text).toBe("Reduces by 1500 and by 1.5 sec.");
  expect(resolveTooltip("Saves $/1000;s1 sec.", cut).text).toBe("Saves 1.5 sec.");
});

test("a value of 0 is left open: the tables hold 0 where the real number lives elsewhere", () => {
  const zero: SpellFacts = { effects: [eff(0, 0)], durationMs: null };
  const r = resolveTooltip("Gives a $m1% chance and ${$m1*2.5}% more.", zero);
  expect(r.text).toBe(`Gives a ${PLACEHOLDER}% chance and ${PLACEHOLDER}% more.`);
  expect(r.unresolved).toEqual(["$m1", "${$m1*2.5}"]);
});

test("conditions, named variables and other spells' text are single placeholders", () => {
  const r = resolveTooltip("$?a5487|a9634[|CFFFFFFFFNeeds a form|R][|cFFFF2020Needs a form|r]\r\nCharge.\r\n\r\n$@spelltooltip414924 and $<mult> and $proccooldown and $?s1[a]?s2[b][c]", self);
  expect(r.text).toBe(`${PLACEHOLDER}\nCharge.\n\n${PLACEHOLDER} and ${PLACEHOLDER} and ${PLACEHOLDER} and ${PLACEHOLDER}`);
  expect(r.unresolved).toEqual(["$?a5487|a9634[Needs a form][Needs a form]", "$@spelltooltip414924", "$<mult>", "$proccooldown", "$?s1[a]?s2[b][c]"]);
});

test("colour codes go, line breaks stay", () => {
  expect(resolveTooltip("|cffffffffBold|r|nNext $s1", self).text).toBe("Bold\nNext 15");
});
