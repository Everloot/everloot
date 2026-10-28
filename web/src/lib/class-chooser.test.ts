import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CLASSES } from "@/design/tokens";
import { FACTIONS as KB_FACTIONS, RACE_QUESTION, parseClassChooser, type ClassChooserData } from "../../../kb/src/guides/class-chooser";
import {
  FACTIONS, RACE, answersHash, chooseClasses, chooserReviewed, notOffered, optionOffered, optionWeights, parseAnswers, raceChoices, type Answers,
} from "./class-chooser";
import { classRaces } from "./class-hub";
import { guidesDir } from "./guides";

/* ---------- A made-up chooser: its weights are the tests', not the site's ---------- */

const ROLES = `status: draft
version: 1
reviewer: ""
reviewedOn: null
source: { title: "A Blizzard post", url: "https://news.blizzard.com/en-us/article/1/a-post", checkedOn: 2026-10-27 }
classes:
  warrior: { roles: [{ role: damage, basis: "Fights with weapons." }], races: { Alliance: [Human], Horde: [Orc, Tauren] } }
  paladin: { roles: [{ role: healer, basis: "Heals wounds." }, { role: damage, basis: "Smites evil." }], races: { Alliance: [Human], Horde: [Undead] } }
  hunter: { roles: [], races: { Alliance: [Human], Horde: [Orc, Tauren] } }
  rogue: { roles: [], races: { Alliance: [Human], Horde: [Orc] } }
  priest: { roles: [{ role: healer, basis: "Heals or harms." }], races: { Alliance: [Human], Horde: [Undead] } }
  shaman: { roles: [], races: { Alliance: [Dwarf], Horde: [Orc, Tauren] } }
  mage: { roles: [{ role: damage, basis: "Hurls frost and flame." }], races: { Alliance: [Human], Horde: [Orc] } }
  warlock: { roles: [], races: { Alliance: [Human], Horde: [Orc] } }
  druid: { roles: [], races: { Alliance: [Night Elf], Horde: [Tauren] } }
`;

const CHOOSER = `status: draft
version: 1
reviewer: ""
reviewedOn: null
questions:
  - id: role
    text: What would you like to do in a group?
    options:
      - { id: heal, text: Heal my allies, role: healer, weight: 2 }
      - { id: damage, text: Deal damage, role: damage, weight: 2 }
      - { id: protect, text: Protect my group, role: tank, weight: 2 }
  - id: theme
    text: Which of these draws you in?
    options:
      - id: frost
        text: Frost and flame
        classes:
          - { class: mage, weight: 3, why: "Mages hurl frost and flame." }
      - id: weapons
        text: Weapons
        classes:
          - { class: warrior, weight: 2, why: "Warriors fight with weapons." }
          - { class: paladin, weight: 1, why: "Paladins are warriors too." }
      - id: wild
        text: The wild
        classes:
          - { class: hunter, weight: 2, why: "Hunters tame beasts." }
          - { class: druid, weight: 2, why: "Druids change shape." }
`;

const data = parseClassChooser(ROLES, CHOOSER)!;
const ROLE_Q = "What would you like to do in a group?";
const THEME_Q = "Which of these draws you in?";
const choose = (answers: Answers) => chooseClasses(answers, data)!;
const slugs = (fits: { classSlug: string }[]) => fits.map((f) => f.classSlug);
const read = (query: string) => parseAnswers(new URLSearchParams(query), data);

test("the fixture reads", () => expect(data).not.toBeNull());

describe("choosing", () => {
  test("with nothing answered there is no result to show", () => {
    expect(chooseClasses({}, data)).toBeNull();
  });

  test("an answer adds its weight to each class it names, with its reason, and the highest score leads", () => {
    const result = choose({ theme: "frost" });
    expect(result.top).toEqual([{ classSlug: "mage", score: 3, reasons: [{ question: THEME_Q, answer: "Frost and flame", weight: 3, why: "Mages hurl frost and flame." }] }]);
    expect(result.alternatives).toEqual([]);
    expect(result.unweighed).toEqual(["druid", "hunter", "paladin", "priest", "rogue", "shaman", "warlock", "warrior"]);
  });

  test("a role answer weighs each class the facts give that role, with what the source says", () => {
    const { top } = choose({ role: "heal" });
    expect(top).toEqual([
      { classSlug: "paladin", score: 2, reasons: [{ question: ROLE_Q, answer: "Heal my allies", weight: 2, why: "Heals wounds." }] },
      { classSlug: "priest", score: 2, reasons: [{ question: ROLE_Q, answer: "Heal my allies", weight: 2, why: "Heals or harms." }] },
    ]);
  });

  test("answers add up; the other classes they weigh are alternatives, highest first", () => {
    const result = choose({ role: "damage", theme: "weapons" });
    expect(result.top.map((f) => [f.classSlug, f.score])).toEqual([["warrior", 4]]);
    expect(result.top[0].reasons.map((r) => r.answer)).toEqual(["Deal damage", "Weapons"]);
    expect(result.alternatives.map((f) => [f.classSlug, f.score])).toEqual([["paladin", 3], ["mage", 2]]);
  });

  test("a tie is never broken: tied classes are shown together, in alphabetical order, whatever the order of the answers", () => {
    expect(slugs(choose({ role: "damage" }).top)).toEqual(["mage", "paladin", "warrior"]);
    expect(slugs(choose({ theme: "wild" }).top)).toEqual(["druid", "hunter"]);
    const one = choose({ theme: "wild", role: "damage" });
    const other = choose({ role: "damage", theme: "wild" });
    expect(other).toEqual(one);
    expect(slugs(one.top)).toEqual(["druid", "hunter", "mage", "paladin", "warrior"]);
  });

  test("a race keeps the classes it can be, and the rest are set aside with what the answers gave them", () => {
    const result = choose({ race: "horde-tauren", role: "damage" });
    expect(result.race).toMatchObject({ faction: "Horde", race: "Tauren", classes: ["druid", "hunter", "shaman", "warrior"] });
    expect(slugs(result.top)).toEqual(["warrior"]);
    expect(result.excluded.map((f) => [f.classSlug, f.score])).toEqual([["mage", 2], ["paladin", 2], ["priest", 0], ["rogue", 0], ["warlock", 0]]);
    expect([...slugs(result.top), ...slugs(result.alternatives), ...result.unweighed].sort()).toEqual(["druid", "hunter", "shaman", "warrior"]);
  });

  test("an answer that weighs no class says why: none has the role, or none the race can be", () => {
    const protect = choose({ role: "protect" });
    expect(protect.top).toEqual([]);
    expect(protect.silent).toEqual([{ question: ROLE_Q, answer: "Protect my group", reason: "none", role: "tank" }]);
    expect(protect.unweighed).toHaveLength(9);
    const frost = choose({ race: "horde-tauren", theme: "frost" });
    expect(frost.top).toEqual([]);
    expect(frost.silent).toEqual([{ question: THEME_Q, answer: "Frost and flame", reason: "race" }]);
    expect(frost.unweighed).toEqual(["druid", "hunter", "shaman", "warrior"]);
  });

  test("a reading weighs a class the facts give no such role, and says it is Everloot's reading", () => {
    const read = parseClassChooser(ROLES, CHOOSER.replace("{ id: damage, text: Deal damage, role: damage, weight: 2 }", '{ id: damage, text: Deal damage, role: damage, weight: 2, readings: [{ class: rogue, weight: 1, why: "Rogues eliminate their targets." }] }'))!;
    expect(optionWeights(read.chooser.questions[0].options[1], read)).toEqual([
      { classSlug: "mage", weight: 2, why: "Hurls frost and flame." },
      { classSlug: "paladin", weight: 2, why: "Smites evil." },
      { classSlug: "warrior", weight: 2, why: "Fights with weapons." },
      { classSlug: "rogue", weight: 1, why: "Rogues eliminate their targets.", reading: true },
    ]);
    const result = chooseClasses({ role: "damage" }, read)!;
    expect(slugs(result.top)).toEqual(["mage", "paladin", "warrior"]);
    expect(result.top[0].reasons[0].reading).toBeUndefined();
    expect(result.alternatives).toEqual([{ classSlug: "rogue", score: 1, reasons: [{ question: ROLE_Q, answer: "Deal damage", weight: 1, why: "Rogues eliminate their targets.", reading: true }] }]);
  });

  test("a race alone lists the classes it can be, none ahead of another", () => {
    const result = choose({ race: "alliance-night-elf" });
    expect(result.top).toEqual([]);
    expect(result.unweighed).toEqual(["druid"]);
    expect(result.silent).toEqual([]);
  });
});

describe("the link", () => {
  test("reads each answer, and a blank one as no answer", () => {
    expect(read("race=horde-tauren&role=heal&theme=")).toEqual({ ok: true, answers: { race: "horde-tauren", role: "heal" } });
    expect(read("")).toEqual({ ok: true, answers: {} });
  });

  test("refuses a link it cannot read whole, with the reason, and fills in nothing", () => {
    expect(read("role=wizard&theme=frost")).toEqual({ ok: false, error: `The link answers "${ROLE_Q}" with "wizard", which is not one of its answers.` });
    expect(read("race=pandaren")).toEqual({ ok: false, error: '"pandaren" is not one of the races in Blizzard\'s tables.' });
    expect(read("distance=close")).toEqual({ ok: false, error: 'The link answers "distance", which is not a question the chooser asks.' });
    expect(read("role=heal&role=damage")).toEqual({ ok: false, error: "The link gives role more than once." });
    expect(read(`role=${"x".repeat(60)}`)).toEqual({ ok: false, error: `The link answers "${ROLE_Q}" with "${"x".repeat(40)}…", which is not one of its answers.` });
  });

  test("refuses a role answer no class is named for yet: the form does not offer it", () => {
    expect(read("role=protect")).toEqual({
      ok: false,
      error: `The link answers "${ROLE_Q}" with "Protect my group", which is not offered yet. No class is named for protecting the group in Blizzard's descriptions yet.`,
    });
  });

  test("writes the race first, then the questions in their order, and reads back the same answers", () => {
    const answers = { theme: "frost", race: "horde-tauren", role: "heal" };
    expect(answersHash(answers, data)).toBe("#race=horde-tauren&role=heal&theme=frost");
    expect(read(answersHash(answers, data).slice(1))).toEqual({ ok: true, answers: { race: "horde-tauren", role: "heal", theme: "frost" } });
    expect(answersHash({}, data)).toBe("");
  });
});

test("races are offered per faction from the facts, alphabetically, each with the classes it can be", () => {
  expect(raceChoices(data).map((r) => [r.key, r.classes])).toEqual([
    ["alliance-dwarf", ["shaman"]],
    ["alliance-human", ["hunter", "mage", "paladin", "priest", "rogue", "warlock", "warrior"]],
    ["alliance-night-elf", ["druid"]],
    ["horde-orc", ["hunter", "mage", "rogue", "shaman", "warlock", "warrior"]],
    ["horde-tauren", ["druid", "hunter", "shaman", "warrior"]],
    ["horde-undead", ["paladin", "priest"]],
  ]);
});

test("an option's weights, a role's expanded from the facts, the heaviest first", () => {
  const [heal] = data.chooser.questions[0].options;
  expect(optionWeights(heal, data)).toEqual([{ classSlug: "paladin", weight: 2, why: "Heals wounds." }, { classSlug: "priest", weight: 2, why: "Heals or harms." }]);
  const weapons = data.chooser.questions[1].options[1];
  expect(optionWeights(weapons, data).map((w) => [w.classSlug, w.weight])).toEqual([["warrior", 2], ["paladin", 1]]);
  expect(optionWeights(data.chooser.questions[0].options[2], data)).toEqual([]);
});

test("an answer is offered unless it is a role no class is named for, in the facts or by a reading", () => {
  const [heal, , protect] = data.chooser.questions[0].options;
  expect(optionOffered(heal, data)).toBe(true);
  expect(optionOffered(protect, data)).toBe(false);
  expect(optionOffered(data.chooser.questions[1].options[0], data)).toBe(true);
  const read = parseClassChooser(ROLES, CHOOSER.replace("{ id: protect, text: Protect my group, role: tank, weight: 2 }", '{ id: protect, text: Protect my group, role: tank, weight: 2, readings: [{ class: warrior, weight: 1, why: "Strong and tough." }] }'))!;
  expect(optionOffered(read.chooser.questions[0].options[2], read)).toBe(true);
  expect(notOffered("tank")).toBe("No class is named for protecting the group in Blizzard's descriptions yet.");
});

test("the chooser is reviewed only when both files are", () => {
  expect(chooserReviewed(data)).toBe(false);
  const reviewed = (s: string) => s.replace("status: draft", "status: reviewed").replace('reviewer: ""', "reviewer: Kai").replace("reviewedOn: null", "reviewedOn: 2026-10-26");
  expect(chooserReviewed(parseClassChooser(reviewed(ROLES), CHOOSER)!)).toBe(false);
  expect(chooserReviewed(parseClassChooser(reviewed(ROLES), reviewed(CHOOSER))!)).toBe(true);
});

test("the race key and the factions are kb's", () => {
  expect(RACE).toBe(RACE_QUESTION);
  expect(FACTIONS).toEqual(KB_FACTIONS);
});

/* ---------- The committed chooser ---------- */

describe("the committed chooser", () => {
  const file = (name: string) => readFileSync(join(guidesDir(), name), "utf8");
  const committed = parseClassChooser(file("class-roles.yaml"), file("class-chooser.yaml")) as ClassChooserData;

  /** Every set of answers the form allows: each question unanswered or given one of the answers it offers. */
  function everyAnswerSet(): Answers[] {
    const offered = (q: ClassChooserData["chooser"]["questions"][number]) => q.options.filter((o) => optionOffered(o, committed)).map((o) => o.id);
    const questions: [string, string[]][] = [[RACE, raceChoices(committed).map((r) => r.key)], ...committed.chooser.questions.map((q): [string, string[]] => [q.id, offered(q)])];
    return questions.reduce<Answers[]>((sets, [key, ids]) => sets.flatMap((s) => [s, ...ids.map((id) => ({ ...s, [key]: id }))]), [{}]);
  }

  test("reads", () => expect(committed).not.toBeNull());

  test("Skyborne is offered once on each side, with the classes each side's tables give it", () => {
    const skyborne = raceChoices(committed).filter((r) => r.race === "Skyborne");
    expect(skyborne.map((r) => [r.key, r.classes])).toEqual([
      ["alliance-skyborne", ["druid", "hunter", "mage", "rogue", "warrior"]],
      ["horde-skyborne", ["druid", "hunter", "rogue", "shaman", "warrior"]],
    ]);
  });

  test("class-roles.yaml's races are the site's copy of Blizzard's race tables", () => {
    for (const slug of CLASSES) {
      const site = classRaces(slug);
      for (const faction of FACTIONS) {
        expect(committed.roles.classes[slug].races[faction], `${slug} ${faction}`).toEqual(site.find((f) => f.faction === faction)?.races.map((r) => r.race) ?? []);
      }
    }
  });

  test("Warriors and Rogues deal damage only by Everloot's reading: the facts give them no role", () => {
    expect(committed.roles.classes.warrior.roles).toEqual([]);
    expect(committed.roles.classes.rogue.roles).toEqual([]);
    const damage = committed.chooser.questions.find((q) => q.id === "role")!.options.find((o) => o.id === "damage")!;
    expect(optionWeights(damage, committed).filter((w) => w.reading).map((w) => w.classSlug)).toEqual(["rogue", "warrior"]);
  });

  test("every class is the one class the answers fit most under some answers the form allows", () => {
    const sole = new Set<string>();
    for (const answers of everyAnswerSet()) {
      const result = chooseClasses(answers, committed);
      if (result?.top.length === 1) sole.add(result.top[0].classSlug);
    }
    expect([...sole].sort()).toEqual([...CLASSES].sort());
  });

  test("no answers put a class the race cannot be among the classes that fit", () => {
    for (const answers of everyAnswerSet().filter((a) => a[RACE])) {
      const result = chooseClasses(answers, committed)!;
      for (const fit of [...result.top, ...result.alternatives]) expect(result.race!.classes, JSON.stringify(answers)).toContain(fit.classSlug);
    }
  });
});
