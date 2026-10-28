import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { checkClassChooser, parseClassChooser, type ChooserFiles } from "../src/guides/class-chooser.js";
import { readClassChooserFiles } from "../src/guides/data.js";

const ROLES_PATH = "guides/class-roles.yaml";
const CHOOSER_PATH = "guides/class-chooser.yaml";
const TODAY = "2026-10-27";
const ARTICLE = "https://news.blizzard.com/en-us/article/24304075/create-the-hero-you-want-to-be-in-world-of-warcraft-forever";

/** Every class once, a role only where the made-up source gives one. */
const ROLES = `status: draft
version: 1
reviewer: ""
reviewedOn: null
source: { title: "Create the Hero You Want to Be in World of Warcraft: Forever", url: "${ARTICLE}", checkedOn: 2026-10-27 }
classes:
  warrior: { roles: [{ role: damage, basis: "Trains for armed combat." }], races: { Alliance: [Human], Horde: [Orc] } }
  paladin: { roles: [{ role: healer, basis: "Heals wounds with the Light." }], races: { Alliance: [Human], Horde: [Undead] } }
  hunter: { roles: [], races: { Alliance: [Human], Horde: [Orc] } }
  rogue: { roles: [], races: { Alliance: [Human], Horde: [Orc] } }
  priest: { roles: [{ role: healer, basis: "Can heal or harm." }], races: { Alliance: [Human], Horde: [Undead] } }
  shaman: { roles: [], races: { Alliance: [Dwarf], Horde: [Orc] } }
  mage: { roles: [{ role: damage, basis: "Attacks from a distance." }], races: { Alliance: [Human], Horde: [Orc] } }
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
      - { id: heal, text: Heal allies, role: healer, weight: 2 }
      - { id: damage, text: Deal damage, role: damage, weight: 2 }
  - id: theme
    text: Which of these draws you in?
    options:
      - id: frost-and-flame
        text: Frost and flame
        classes:
          - { class: mage, weight: 2, why: "Mages hurl bolts of frost and flame." }
`;

const files = (roles: string | null = ROLES, chooser: string | null = CHOOSER): ChooserFiles => ({
  roles: roles === null ? null : { path: ROLES_PATH, source: roles },
  chooser: chooser === null ? null : { path: CHOOSER_PATH, source: chooser },
});
const problemsOf = (roles: string | null = ROLES, chooser: string | null = CHOOSER, today = TODAY) => checkClassChooser(files(roles, chooser), today).problems;
/** The line a problem should point at: the first line of the file that starts with `start`, after its indent. */
const lineOf = (source: string, start: string) => source.split("\n").findIndex((l) => l.trimStart().startsWith(start)) + 1;
const at = (file: string, source: string, start: string, message: string) => ({ file, line: lineOf(source, start), message: expect.stringContaining(message) });

const reviewed = (source: string, by = "Kai", on = "2026-10-26") =>
  source.replace("status: draft", "status: reviewed").replace('reviewer: ""', `reviewer: ${by}`).replace("reviewedOn: null", `reviewedOn: ${on}`);

test("drafts that name no reviewer pass, and the site reads them", () => {
  expect(problemsOf()).toEqual([]);
  const data = parseClassChooser(ROLES, CHOOSER);
  expect(data?.roles.classes.paladin.roles).toEqual([{ role: "healer", basis: "Heals wounds with the Light." }]);
  expect(data?.chooser.questions.map((q) => q.id)).toEqual(["role", "theme"]);
});

test("the committed files pass the check", () => {
  const committed = readClassChooserFiles();
  expect(committed.roles?.path).toBe(ROLES_PATH);
  expect(committed.chooser?.path).toBe(CHOOSER_PATH);
  expect(checkClassChooser(committed, new Date().toISOString().slice(0, 10)).problems).toEqual([]);
});

describe("review", () => {
  test("a file marked reviewed names its reviewer and the day of the review", () => {
    const noOne = ROLES.replace("status: draft", "status: reviewed");
    expect(problemsOf(noOne)).toEqual([
      at(ROLES_PATH, noOne, "reviewer:", "a reviewed file names its reviewer"),
      at(ROLES_PATH, noOne, "reviewedOn:", "a reviewed file gives reviewedOn"),
    ]);
    const undated = reviewed(CHOOSER).replace("reviewedOn: 2026-10-26", "reviewedOn: null");
    expect(problemsOf(ROLES, undated)).toEqual([at(CHOOSER_PATH, undated, "reviewedOn:", "a reviewed file gives reviewedOn")]);
    const blank = reviewed(CHOOSER, '"  "');
    expect(problemsOf(ROLES, blank)).toEqual([at(CHOOSER_PATH, blank, "reviewer:", "a reviewed file names its reviewer")]);
  });

  test("a site reader refuses a reviewed file without its reviewer too", () => {
    expect(parseClassChooser(ROLES.replace("status: draft", "status: reviewed"), CHOOSER)).toBeNull();
    expect(parseClassChooser(reviewed(ROLES), reviewed(CHOOSER))).not.toBeNull();
  });

  test("reviewed files with their reviewer and date pass", () => {
    expect(problemsOf(reviewed(ROLES), reviewed(CHOOSER))).toEqual([]);
  });

  test("a draft names no one and no date: a name there would read as a review", () => {
    const named = ROLES.replace('reviewer: ""', "reviewer: Kai");
    expect(problemsOf(named)).toEqual([at(ROLES_PATH, named, "reviewer:", "a draft names no reviewer")]);
    const dated = CHOOSER.replace("reviewedOn: null", "reviewedOn: 2026-10-26");
    expect(problemsOf(ROLES, dated)).toEqual([at(CHOOSER_PATH, dated, "reviewedOn:", "a draft has no reviewedOn")]);
  });

  test("a review cannot be dated after today", () => {
    const ahead = reviewed(CHOOSER, "Kai", "2026-10-28");
    expect(problemsOf(ROLES, ahead)).toEqual([at(CHOOSER_PATH, ahead, "reviewedOn:", "2026-10-28 is after today (2026-10-27)")]);
  });

  test("the site reader refuses a review dated after today, as the check does, for either file", () => {
    const ahead = reviewed(CHOOSER, "Kai", "2099-01-01");
    expect(problemsOf(reviewed(ROLES), ahead)).toEqual([at(CHOOSER_PATH, ahead, "reviewedOn:", "2099-01-01 is after today (2026-10-27)")]);
    expect(parseClassChooser(reviewed(ROLES), ahead, TODAY)).toBeNull();
    expect(parseClassChooser(reviewed(ROLES), ahead)).toBeNull();
    expect(parseClassChooser(reviewed(ROLES, "Kai", "2099-01-01"), reviewed(CHOOSER))).toBeNull();
    const onTheDay = reviewed(CHOOSER, "Kai", TODAY);
    expect(problemsOf(reviewed(ROLES), onTheDay)).toEqual([]);
    expect(parseClassChooser(reviewed(ROLES), onTheDay, TODAY)).not.toBeNull();
  });

  test("a version is a whole number from 1", () => {
    const zero = CHOOSER.replace("version: 1", "version: 0");
    expect(problemsOf(ROLES, zero)).toEqual([at(CHOOSER_PATH, zero, "version:", "version")]);
  });
});

describe("class-roles.yaml", () => {
  test("lists the nine classes, each once", () => {
    const missing = ROLES.replace(/^ {2}hunter: .*\n/m, "");
    expect(problemsOf(missing)).toEqual([{ file: ROLES_PATH, line: lineOf(missing, "classes:"), message: expect.stringContaining("classes.hunter") }]);
    const extra = ROLES.replace("classes:\n", "classes:\n  deathknight: { roles: [], races: { Alliance: [Human], Horde: [Orc] } }\n");
    expect(problemsOf(extra)).toEqual([at(ROLES_PATH, extra, "deathknight:", 'unknown field "deathknight"')]);
  });

  test("a role is one the guides use, given once, with what the source says", () => {
    const unknown = ROLES.replace("role: healer, basis: \"Heals", "role: support, basis: \"Heals");
    expect(problemsOf(unknown)).toEqual([at(ROLES_PATH, unknown, "paladin:", "classes.paladin.roles.0.role")]);
    const twice = ROLES.replace('roles: [{ role: healer, basis: "Can heal or harm." }]', 'roles: [{ role: healer, basis: "Can heal." }, { role: healer, basis: "Can heal or harm." }]');
    expect(problemsOf(twice)).toEqual([at(ROLES_PATH, twice, "priest:", 'classes.priest lists the role "healer" twice')]);
    const bare = ROLES.replace('{ role: damage, basis: "Attacks from a distance." }', "{ role: damage }");
    expect(problemsOf(bare)).toEqual([at(ROLES_PATH, bare, "mage:", "classes.mage.roles.0.basis")]);
  });

  test("races are listed per faction, each once, and every class has one", () => {
    const twice = ROLES.replace("warrior: { roles: [{ role: damage, basis: \"Trains for armed combat.\" }], races: { Alliance: [Human]", "warrior: { roles: [{ role: damage, basis: \"Trains for armed combat.\" }], races: { Alliance: [Human, Human]");
    expect(problemsOf(twice)).toEqual([at(ROLES_PATH, twice, "warrior:", "classes.warrior lists Human twice for the Alliance")]);
    const none = ROLES.replace("rogue: { roles: [], races: { Alliance: [Human], Horde: [Orc] } }", "rogue: { roles: [], races: { Alliance: [], Horde: [] } }");
    expect(problemsOf(none)).toEqual([at(ROLES_PATH, none, "rogue:", "classes.rogue lists no race")]);
    const neutral = ROLES.replace("Horde: [Tauren]", "Horde: [Tauren], Neutral: [Pandaren]");
    expect(problemsOf(neutral)).toEqual([at(ROLES_PATH, neutral, "druid:", 'unknown field "Neutral"')]);
  });

  test("the source is one of Blizzard's own posts", () => {
    const other = ROLES.replace(ARTICLE, "https://example.com/classes");
    expect(problemsOf(other)).toEqual([at(ROLES_PATH, other, "source:", "source is not one of Blizzard's own posts")]);
  });
});

describe("class-chooser.yaml", () => {
  test("an option weighs classes by a sourced role or one by one, never both and never neither", () => {
    const both = CHOOSER.replace("{ id: heal, text: Heal allies, role: healer, weight: 2 }", "{ id: heal, text: Heal allies, role: healer, weight: 2, classes: [{ class: druid, weight: 1, why: Heals. }] }");
    expect(problemsOf(ROLES, both)).toEqual([at(CHOOSER_PATH, both, "- { id: heal", "questions.0.options.0 weighs classes by role or one by one, not both")]);
    const neither = CHOOSER.replace("{ id: heal, text: Heal allies, role: healer, weight: 2 }", "{ id: heal, text: Heal allies }");
    expect(problemsOf(ROLES, neither)).toEqual([at(CHOOSER_PATH, neither, "- { id: heal", "questions.0.options.0 weighs no class")]);
    const noWeight = CHOOSER.replace("{ id: heal, text: Heal allies, role: healer, weight: 2 }", "{ id: heal, text: Heal allies, role: healer }");
    expect(problemsOf(ROLES, noWeight)).toEqual([at(CHOOSER_PATH, noWeight, "- { id: heal", "questions.0.options.0 gives the role healer without the weight")]);
    const noRole = CHOOSER.replace("{ id: heal, text: Heal allies, role: healer, weight: 2 }", "{ id: heal, text: Heal allies, weight: 2 }");
    expect(problemsOf(ROLES, noRole)).toEqual([at(CHOOSER_PATH, noRole, "- { id: heal", "questions.0.options.0 gives a weight without the role")]);
    const empty = CHOOSER.replace(/classes:\n\s+- \{ class: mage.*\n/, "classes: []\n");
    expect(problemsOf(ROLES, empty)).toEqual([at(CHOOSER_PATH, empty, "- id: frost-and-flame", "questions.1.options.0 weighs no class")]);
  });

  test("a weight is a whole number from 1 to 3, and a class is weighed once in an option", () => {
    for (const weight of ["0", "4", "1.5"]) {
      const off = CHOOSER.replace("{ class: mage, weight: 2", `{ class: mage, weight: ${weight}`);
      expect(problemsOf(ROLES, off), weight).toEqual([at(CHOOSER_PATH, off, "- { class: mage", "questions.1.options.0.classes.0.weight")]);
    }
    const twice = CHOOSER.replace(/(- \{ class: mage.*\n)/, "$1          - { class: mage, weight: 1, why: \"Again.\" }\n");
    expect(problemsOf(ROLES, twice)).toEqual([at(CHOOSER_PATH, twice, "- id: frost-and-flame", "questions.1.options.0 weighs mage twice")]);
    const unknown = CHOOSER.replace("{ class: mage,", "{ class: monk,");
    expect(problemsOf(ROLES, unknown)).toEqual([at(CHOOSER_PATH, unknown, "- { class: monk", "questions.1.options.0.classes.0.class")]);
  });

  test("a role answer may also weigh classes the facts give no such role, as Everloot's reading of the source", () => {
    const read = CHOOSER.replace("{ id: damage, text: Deal damage, role: damage, weight: 2 }", '{ id: damage, text: Deal damage, role: damage, weight: 2, readings: [{ class: rogue, weight: 2, why: "Rogues eliminate their targets." }] }');
    expect(problemsOf(ROLES, read)).toEqual([]);
    expect(parseClassChooser(ROLES, read)?.chooser.questions[0].options[1].readings).toEqual([{ class: "rogue", weight: 2, why: "Rogues eliminate their targets." }]);
    const twice = read.replace("class: rogue", "class: mage");
    expect(problemsOf(ROLES, twice)).toEqual([at(CHOOSER_PATH, twice, "- { id: damage", "questions.0.options.1 reads mage as damage, a role class-roles.yaml already gives it")]);
    expect(parseClassChooser(ROLES, twice)).toBeNull();
    const again = read.replace('[{ class: rogue, weight: 2, why: "Rogues eliminate their targets." }]', '[{ class: rogue, weight: 2, why: "One." }, { class: rogue, weight: 1, why: "Two." }]');
    expect(problemsOf(ROLES, again)).toEqual([at(CHOOSER_PATH, again, "- { id: damage", "questions.0.options.1 weighs rogue twice")]);
    const roleless = CHOOSER.replace("        classes:\n          - { class: mage", "        readings:\n          - { class: mage");
    expect(problemsOf(ROLES, roleless)).toEqual([at(CHOOSER_PATH, roleless, "- id: frost-and-flame", "questions.1.options.0 gives readings without the role they read")]);
  });

  test("ids are unique, and race belongs to the race question", () => {
    const sameQuestion = CHOOSER.replace("- id: theme", "- id: role");
    expect(problemsOf(ROLES, sameQuestion)).toEqual([{ file: CHOOSER_PATH, line: 11, message: expect.stringContaining('questions.1: the id "role" is already used by questions.0') }]);
    const sameOption = CHOOSER.replace("{ id: damage, text: Deal damage", "{ id: heal, text: Deal damage");
    expect(problemsOf(ROLES, sameOption)).toEqual([at(CHOOSER_PATH, sameOption, "- { id: heal, text: Deal damage", 'questions.0.options.1: the id "heal" is already used in this question')]);
    const race = CHOOSER.replace("- id: role", "- id: race");
    expect(problemsOf(ROLES, race)).toEqual([at(CHOOSER_PATH, race, "- id: race", 'questions.0: "race" is the race question')]);
  });

  test("an unknown field fails on its own line, and a YAML error at its line", () => {
    const rated = CHOOSER.replace("version: 1", "version: 1\nrating: 5");
    expect(problemsOf(ROLES, rated)).toEqual([at(CHOOSER_PATH, rated, "rating:", 'unknown field "rating"')]);
    const broken = CHOOSER.replace("    text: Which of these draws you in?", "    text: [Which of these");
    const problems = problemsOf(ROLES, broken);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ file: CHOOSER_PATH, line: expect.any(Number) });
    expect(parseClassChooser(ROLES, broken)).toBeNull();
  });
});

describe("reviewed versions stay as they were", () => {
  const before = () => files(reviewed(ROLES), reviewed(CHOOSER));
  const compared = (now: ChooserFiles, then: ChooserFiles = before()) => checkClassChooser(now, TODAY, then).problems;
  const mage3 = (source: string) => source.replace("{ class: mage, weight: 2", "{ class: mage, weight: 3");
  const v2 = (source: string) => source.replace("version: 1", "version: 2");

  test("an unchanged reviewed file passes", () => {
    expect(compared(before())).toEqual([]);
  });

  test("a weight changed under the same version and review fails: Mage from 2 to 3", () => {
    const now = mage3(reviewed(CHOOSER));
    expect(compared(files(reviewed(ROLES), now))).toEqual([at(CHOOSER_PATH, now, "version:", "class-chooser.yaml was reviewed as version 1 and has changed since: a change is a new version")]);
  });

  test("the facts are held the same way", () => {
    const now = reviewed(ROLES).replace("Attacks from a distance.", "Fights from afar.");
    expect(compared(files(now, reviewed(CHOOSER)))).toEqual([at(ROLES_PATH, now, "version:", "class-roles.yaml was reviewed as version 1 and has changed since")]);
  });

  test("a new version cannot carry the old review over; with a review of its own, or as a draft, it passes", () => {
    const carried = v2(mage3(reviewed(CHOOSER)));
    expect(compared(files(reviewed(ROLES), carried))).toEqual([at(CHOOSER_PATH, carried, "reviewedOn:", "version 2 carries version 1's review (Kai, 2026-10-26)")]);
    expect(compared(files(reviewed(ROLES), v2(mage3(reviewed(CHOOSER, "Kai", "2026-10-27")))))).toEqual([]);
    expect(compared(files(reviewed(ROLES), v2(mage3(CHOOSER))))).toEqual([]);
  });

  test("a new review is a change too: no restamping without a new version", () => {
    const restamped = reviewed(CHOOSER, "Kai", "2026-10-27");
    expect(compared(files(reviewed(ROLES), restamped))).toEqual([at(CHOOSER_PATH, restamped, "version:", "class-chooser.yaml version 1 was reviewed by Kai on 2026-10-26; a new review is a new version")]);
  });

  test("a reviewed version may go back to draft unchanged", () => {
    expect(compared(files(reviewed(ROLES), CHOOSER))).toEqual([]);
  });

  test("versions never go down", () => {
    const down = reviewed(CHOOSER, "Kai", "2026-10-27");
    expect(compared(files(reviewed(ROLES), down), files(reviewed(ROLES), reviewed(CHOOSER).replace("version: 1", "version: 3")))).toEqual([at(CHOOSER_PATH, down, "version:", "version 1 is below version 3")]);
  });

  test("a draft before the change, or a file that was not there, may change freely", () => {
    expect(compared(files(ROLES, mage3(CHOOSER)), files(ROLES, CHOOSER))).toEqual([]);
    expect(compared(before(), files(null, null))).toEqual([]);
  });

  test("a copy from before the change that does not read fails, so no change slips past it", () => {
    expect(compared(before(), files(reviewed(ROLES), "status: [reviewed"))).toEqual([{ file: CHOOSER_PATH, line: 1, message: expect.stringContaining("as it was before this change, the file does not read") }]);
  });
});

test("the files are read together: one without the other is a problem", () => {
  expect(problemsOf(ROLES, null)).toEqual([{ file: CHOOSER_PATH, message: expect.stringContaining("is missing") }]);
  expect(problemsOf(null, CHOOSER)).toEqual([{ file: ROLES_PATH, message: expect.stringContaining("is missing") }]);
});

describe("guide-check", () => {
  const KB = fileURLToPath(new URL("..", import.meta.url));
  /** The real command, as CI runs it, on a folder of its own. */
  const guideCheck = (dir: string, ...more: string[]) => {
    const run = spawnSync(process.execPath, [join(KB, "node_modules", "tsx", "dist", "cli.mjs"), join(KB, "src", "cli.ts"), "guide-check", "--dir", dir, ...more], { cwd: KB, encoding: "utf8" });
    return { code: run.status, stdout: run.stdout, stderr: run.stderr };
  };
  const folder = (contents: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "chooser-check-"));
    for (const [name, source] of Object.entries(contents)) writeFileSync(join(dir, name), source);
    return dir;
  };

  test("checks the chooser's files with the guides, and refuses one marked reviewed that names no reviewer", { timeout: 60_000 }, () => {
    expect(guideCheck(folder({ "class-roles.yaml": ROLES, "class-chooser.yaml": CHOOSER }))).toMatchObject({
      code: 0,
      stdout: expect.stringContaining("class chooser: class-roles.yaml draft version 1, class-chooser.yaml draft version 1, 0 problems"),
    });
    const unnamed = CHOOSER.replace("status: draft", "status: reviewed");
    expect(guideCheck(folder({ "class-roles.yaml": ROLES, "class-chooser.yaml": unnamed }))).toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`${CHOOSER_PATH}:${lineOf(unnamed, "reviewer:")}: a reviewed file names its reviewer`),
    });
  });

  test("with --previous, a reviewed file that changed under the same version and review fails", { timeout: 60_000 }, () => {
    const then = folder({ "class-roles.yaml": reviewed(ROLES), "class-chooser.yaml": reviewed(CHOOSER) });
    const changed = reviewed(CHOOSER).replace("{ class: mage, weight: 2", "{ class: mage, weight: 3");
    expect(guideCheck(folder({ "class-roles.yaml": reviewed(ROLES), "class-chooser.yaml": changed }), "--previous", then)).toMatchObject({
      code: 1,
      stdout: expect.stringContaining("compared with 2 of its files from before the change"),
      stderr: expect.stringContaining(`${CHOOSER_PATH}:${lineOf(changed, "version:")}: class-chooser.yaml was reviewed as version 1 and has changed since`),
    });
    expect(guideCheck(folder({ "class-roles.yaml": reviewed(ROLES), "class-chooser.yaml": reviewed(CHOOSER) }), "--previous", then)).toMatchObject({ code: 0 });
  });
});
