/**
 * The class chooser's rules: the answers a link carries and the classes they fit, each with its reasons. The weights
 * come from the chooser's files under kb/guides: Everloot's editorial choices in class-chooser.yaml, over the facts in
 * class-roles.yaml (kb/src/guides/class-chooser.ts reads both). Any question may be left unanswered. A race keeps the
 * classes it can be; every other answer adds its weight to the classes it names. Nothing here measures a class or puts
 * one ahead: classes with the same score are shown together, in alphabetical order, and no tie is broken. The chooser
 * runs in the browser, so this file reads no files and does not load the files' schema.
 */
import { CLASSES } from "@/design/tokens";
import type { ClassChooserData } from "../../../kb/src/guides/class-chooser";
import type { GuideRole } from "../../../kb/src/guides/guide";
import { classLabel, type ClassSlug } from "./class-context";

type Question = ClassChooserData["chooser"]["questions"][number];
export type ChooserOption = Question["options"][number];

/** The factions of Blizzard's race tables, in the chooser's order: FACTIONS of kb/src/guides/class-chooser.ts, held equal by the test. */
export const FACTIONS = ["Alliance", "Horde"] as const;
export type Faction = (typeof FACTIONS)[number];

/** The race question's key in a link: RACE_QUESTION of kb/src/guides/class-chooser.ts, held equal by the test. */
export const RACE = "race";

/** Alphabetical, by the name the page shows. */
const byName = (a: ClassSlug, b: ClassSlug) => classLabel(a).localeCompare(classLabel(b));

/** A value as a reason repeats it: quoted, and cut short when a link carries something long. */
const quoted = (value: string) => JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);

/* ---------- Races ---------- */

/** A race the chooser offers: one faction's race, keyed with its faction (Skyborne is on both sides), and the classes it can be. */
export interface RaceChoice { key: string; faction: Faction; race: string; classes: ClassSlug[] }

const raceKey = (faction: Faction, race: string) => `${faction} ${race}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Every race the facts list, per faction and alphabetically within one, with the classes it can be, alphabetically. */
export function raceChoices({ roles }: ClassChooserData): RaceChoice[] {
  return FACTIONS.flatMap((faction) => [...new Set(CLASSES.flatMap((c) => roles.classes[c].races[faction]))]
    .sort((a, b) => a.localeCompare(b))
    .map((race) => ({ key: raceKey(faction, race), faction, race, classes: CLASSES.filter((c) => roles.classes[c].races[faction].includes(race)).sort(byName) })));
}

/* ---------- The link ---------- */

/** The answers a link gives: a question's id to its answer's id, and `race` to a race's key. An unanswered question is left out. */
export type Answers = Readonly<Record<string, string>>;

/** A link's answers, or why it cannot be read. An error is one sentence, for the page to show. */
export type AnswersRead = { ok: true; answers: Answers } | { ok: false; error: string };

/**
 * The answers in a link's fragment, read whole or refused whole with the reason: a question the chooser does not ask,
 * an answer it does not offer, or a question answered twice. A blank answer is none. Nothing fills the gap.
 */
export function parseAnswers(search: URLSearchParams, data: ClassChooserData): AnswersRead {
  const races = raceChoices(data);
  const answers: Record<string, string> = {};
  for (const key of new Set(search.keys())) {
    const question = data.chooser.questions.find((q) => q.id === key);
    if (key !== RACE && !question) return { ok: false, error: `The link answers ${quoted(key)}, which is not a question the chooser asks.` };
    const given = search.getAll(key).filter((v) => v !== "");
    if (given.length > 1) return { ok: false, error: `The link gives ${key} more than once.` };
    const [value] = given;
    if (value === undefined) continue;
    if (!question && !races.some((r) => r.key === value)) return { ok: false, error: `${quoted(value)} is not one of the races in Blizzard's tables.` };
    const option = question?.options.find((o) => o.id === value);
    if (question && !option) return { ok: false, error: `The link answers ${JSON.stringify(question.text)} with ${quoted(value)}, which is not one of its answers.` };
    if (question && option && !optionOffered(option, data)) {
      return { ok: false, error: `The link answers ${JSON.stringify(question.text)} with ${JSON.stringify(option.text)}, which is not offered yet. ${notOffered(option.role!)}` };
    }
    answers[key] = value;
  }
  return { ok: true, answers };
}

/** The fragment of the answers' link: the race, then each question in the chooser's order. No answers is the plain address. */
export function answersHash(answers: Answers, data: ClassChooserData): string {
  const keys = [RACE, ...data.chooser.questions.map((q) => q.id)].filter((key) => answers[key]);
  return keys.length ? `#${new URLSearchParams(keys.map((key) => [key, answers[key]]))}` : "";
}

/* ---------- Choosing ---------- */

/** How the page names a reading: a weight that is Everloot's reading of a description, where the source names no role. */
export const READING = "Everloot's reading of Blizzard's description, not a role Blizzard names";

/** A weight an option gives a class, with why; `reading` when it is Everloot's reading rather than a role the facts give. */
export interface Weighed { classSlug: ClassSlug; weight: number; why: string; reading?: true }

/** What an option gives each class it weighs, with why: a role's classes and reasons are the facts', then its readings. The heaviest first. */
export function optionWeights(option: ChooserOption, { roles }: ClassChooserData): Weighed[] {
  const weighed: Weighed[] = option.role
    ? [
      ...CLASSES.flatMap((c) => roles.classes[c].roles.filter((r) => r.role === option.role).map((r) => ({ classSlug: c, weight: option.weight!, why: r.basis }))),
      ...(option.readings ?? []).map((r) => ({ classSlug: r.class, weight: r.weight, why: r.why, reading: true as const })),
    ]
    : (option.classes ?? []).map((c) => ({ classSlug: c.class, weight: c.weight, why: c.why }));
  return weighed.sort((a, b) => b.weight - a.weight || byName(a.classSlug, b.classSlug));
}

/** What a role answer asks of a class, in the note that says no class is named for it yet. */
const ROLE_DOING: Record<GuideRole, string> = { tank: "protecting the group", healer: "healing", damage: "dealing damage" };

/** Why the form does not offer a role answer yet. */
export const notOffered = (role: GuideRole): string => `No class is named for ${ROLE_DOING[role]} in Blizzard's descriptions yet.`;

/** Whether the form offers an answer: all but a role no class is named for yet, in the facts or by a reading. */
export const optionOffered = (option: ChooserOption, data: ClassChooserData): boolean => !option.role || optionWeights(option, data).length > 0;

export interface Reason { question: string; answer: string; weight: number; why: string; reading?: true }
export interface ClassFit { classSlug: ClassSlug; score: number; reasons: Reason[] }

export interface ChooserResult {
  /** The race answered, if one was. */
  race: RaceChoice | null;
  /** The classes the answers fit most: one, or several with the same score in alphabetical order. None when no answer weighs a class the race can be. */
  top: ClassFit[];
  /** The other classes the answers weigh, the highest score first, ties in alphabetical order. */
  alternatives: ClassFit[];
  /** The classes the race can be that no answer weighs, in alphabetical order. */
  unweighed: ClassSlug[];
  /** The classes the race cannot be, with what the answers gave them, in alphabetical order. */
  excluded: ClassFit[];
  /** The answers that weigh no class here, and why: no class has the role they ask for, or none the race can be does. */
  silent: Silent[];
}

/** An answer that weighs no class: `none` is a role the facts give no class (`role`), `race` weighs only classes the race cannot be. */
export type Silent = { question: string; answer: string } & ({ reason: "none"; role: GuideRole } | { reason: "race" });

/** The classes a set of answers fits, with the reasons. Null with nothing answered: there is nothing to fit. */
export function chooseClasses(answers: Answers, data: ClassChooserData): ChooserResult | null {
  const race = raceChoices(data).find((r) => r.key === answers[RACE]) ?? null;
  const answered = data.chooser.questions.flatMap((question) => {
    const option = question.options.find((o) => o.id === answers[question.id]);
    return option ? [{ question, option }] : [];
  });
  if (!race && !answered.length) return null;

  const can = (c: ClassSlug) => !race || race.classes.includes(c);
  const fits = new Map(CLASSES.map((c): [ClassSlug, ClassFit] => [c, { classSlug: c, score: 0, reasons: [] }]));
  const silent: Silent[] = [];
  for (const { question, option } of answered) {
    const weighed = optionWeights(option, data);
    for (const w of weighed) {
      const fit = fits.get(w.classSlug)!;
      fit.score += w.weight;
      fit.reasons.push({ question: question.text, answer: option.text, weight: w.weight, why: w.why, ...(w.reading ? { reading: true as const } : {}) });
    }
    // Only a role can weigh no class at all: an option that names classes names at least one.
    if (!weighed.length && option.role) silent.push({ question: question.text, answer: option.text, reason: "none", role: option.role });
    else if (!weighed.some((w) => can(w.classSlug))) silent.push({ question: question.text, answer: option.text, reason: "race" });
  }

  const ranked = [...fits.values()].sort((a, b) => b.score - a.score || byName(a.classSlug, b.classSlug));
  const kept = ranked.filter((f) => can(f.classSlug));
  const best = kept[0]?.score ?? 0;
  return {
    race,
    top: best > 0 ? kept.filter((f) => f.score === best) : [],
    alternatives: kept.filter((f) => f.score > 0 && f.score < best),
    unweighed: kept.filter((f) => f.score === 0).map((f) => f.classSlug),
    excluded: ranked.filter((f) => !can(f.classSlug)).sort((a, b) => byName(a.classSlug, b.classSlug)),
    silent,
  };
}

/** The chooser is reviewed once both files are: the facts and the weights. */
export const chooserReviewed = ({ roles, chooser }: ClassChooserData): boolean => roles.status === "reviewed" && chooser.status === "reviewed";

/* ---------- The page's words ---------- */

/** What a class with a role does, for one class and for several: "each class the source says heals", "which classes heal". */
export const ROLE_DOES: Record<GuideRole, { one: string; many: string }> = {
  tank: { one: "protects a group", many: "protect a group" },
  healer: { one: "heals", many: "heal" },
  damage: { one: "deals damage", many: "deal damage" },
};

/** "a, b and c", or "a, b or c". */
export const listed = (words: string[], last = "and"): string =>
  words.length > 1 ? `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}` : (words[0] ?? "");

export const article = (word: string): string => (/^[aeiou]/i.test(word) ? "an" : "a");

/** A race as a sentence names it: with its faction where both sides have a race of that name. */
export const raceLabel = (race: RaceChoice, races: RaceChoice[]): string =>
  races.some((r) => r.race === race.race && r.faction !== race.faction) ? `${race.faction} ${race.race}` : race.race;
