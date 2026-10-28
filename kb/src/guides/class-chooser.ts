/**
 * The class chooser's two files under kb/guides, read by /classes/choose. class-roles.yaml holds facts: the roles
 * Blizzard's race and class article gives each class, and the races its tables let play each class. class-chooser.yaml
 * holds Everloot's own editorial choices: the questions the chooser asks and the weight each answer gives a class. An
 * option that weighs a role weighs the classes class-roles.yaml gives that role, so how much a role counts is decided
 * in one file and who has it in the other. Beside them it may weigh readings: classes the source describes without
 * naming the role, by Everloot's reading of the description, which the page labels as such.
 *
 * Each file is versioned and names its review: a reviewed file says who reviewed this version and on which day, and a
 * draft names no one. Pure, with no file access, so the check and the site read the files the same way, and the site
 * refuses what the check refuses.
 */
import { TALENT_CLASSES } from "@everloot/protocol";
import { isMap, isNode, isScalar, isSeq, parseDocument, type Document } from "yaml";
import { z, type ZodError } from "zod";
import { SOURCE_HOST, type Problem } from "./check.js";
import { GUIDE_ROLES } from "./guide.js";

export const CHOOSER_FILES = { roles: "class-roles.yaml", chooser: "class-chooser.yaml" } as const;

/** The factions of Blizzard's race tables, in the order the chooser lists them. */
export const FACTIONS = ["Alliance", "Horde"] as const;

/** The race question's id in a link: the chooser asks it from class-roles.yaml, so no question in class-chooser.yaml takes it. */
export const RACE_QUESTION = "race";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");
const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters and digits joined by single hyphens");
const words = (max: number) => z.string().trim().min(1).max(max);

/** The review of the version a file holds. */
const review = {
  status: z.enum(["draft", "reviewed"]),
  version: z.number().int().positive(),
  /** Who reviewed this version, as the page names them. Empty while the file is a draft. */
  reviewer: z.string().trim().max(80),
  /** The day they reviewed it. Null while the file is a draft. */
  reviewedOn: isoDate.nullable(),
};

type Issue = (message: string, path: PropertyKey[]) => void;
const issues = (ctx: z.RefinementCtx): Issue => (message, path) => ctx.addIssue({ code: "custom", message, path });

/** Only a person who reviewed a version is named, and only a reviewed version names one. */
function reviewRules(f: { status: "draft" | "reviewed"; reviewer: string; reviewedOn: string | null }, issue: Issue): void {
  if (f.status === "reviewed") {
    if (!f.reviewer) issue("a reviewed file names its reviewer, the person who reviewed this version", ["reviewer"]);
    if (!f.reviewedOn) issue("a reviewed file gives reviewedOn, the day this version was reviewed, as YYYY-MM-DD", ["reviewedOn"]);
  } else {
    if (f.reviewer) issue('a draft names no reviewer: reviewer stays "" until someone reviews this version', ["reviewer"]);
    if (f.reviewedOn !== null) issue("a draft has no reviewedOn: it stays null until someone reviews this version", ["reviewedOn"]);
  }
}

/* ---------- class-roles.yaml: what the source says ---------- */

const classFacts = z.strictObject({
  /** The roles the source gives the class, each with what it says, in our words. None where it gives none. */
  roles: z.array(z.strictObject({ role: z.enum(GUIDE_ROLES), basis: words(200) })),
  /** The races that can be the class, per faction, as the source's tables list them. */
  races: z.strictObject({ Alliance: z.array(words(40)), Horde: z.array(words(40)) }),
});

const RolesFields = z.strictObject({
  ...review,
  /** The one source every fact in the file comes from: one of Blizzard's own posts. */
  source: z.strictObject({ title: words(200), url: z.url({ protocol: /^https$/ }), checkedOn: isoDate }),
  classes: z.strictObject(Object.fromEntries(TALENT_CLASSES.map((c) => [c, classFacts])) as Record<(typeof TALENT_CLASSES)[number], typeof classFacts>),
});

export const ClassRolesFile = RolesFields.superRefine((f, ctx) => {
  const issue = issues(ctx);
  reviewRules(f, issue);
  if (!SOURCE_HOST.test(new URL(f.source.url).hostname)) {
    issue("source is not one of Blizzard's own posts (worldofwarcraft.blizzard.com, news.blizzard.com or the US and EU forums)", ["source"]);
  }
  for (const [slug, facts] of Object.entries(f.classes)) {
    facts.roles.forEach(({ role }, i) => {
      if (facts.roles.findIndex((r) => r.role === role) !== i) issue(`classes.${slug} lists the role "${role}" twice`, ["classes", slug, "roles", i]);
    });
    for (const faction of FACTIONS) {
      facts.races[faction].forEach((race, i) => {
        if (facts.races[faction].indexOf(race) !== i) issue(`classes.${slug} lists ${race} twice for the ${faction}`, ["classes", slug, "races", faction, i]);
      });
    }
    if (FACTIONS.every((faction) => facts.races[faction].length === 0)) issue(`classes.${slug} lists no race`, ["classes", slug, "races"]);
  }
});
export type ClassRoles = z.infer<typeof ClassRolesFile>;

/* ---------- class-chooser.yaml: the questions and their weights ---------- */

/** How much an answer counts for a class: 1, 2 or 3. Small on purpose: an answer leans toward a class, it does not measure it. */
const weight = z.number().int().min(1).max(3);
const weighed = z.strictObject({ class: z.enum(TALENT_CLASSES), weight, why: words(200) });

const option = z.strictObject({
  id,
  text: words(80),
  /** Weighs each class class-roles.yaml gives this role, by `weight`... */
  role: z.enum(GUIDE_ROLES).optional(),
  weight: weight.optional(),
  /** ...and with it, classes the source describes without naming the role, by Everloot's reading; the page says so. */
  readings: z.array(weighed).optional(),
  /** Or weighs classes one by one, each with why, in our words. */
  classes: z.array(weighed).optional(),
});

const ChooserFields = z.strictObject({
  ...review,
  questions: z.array(z.strictObject({ id, text: words(120), options: z.array(option).min(1) })).min(1),
});

export const ClassChooserFile = ChooserFields.superRefine((f, ctx) => {
  const issue = issues(ctx);
  reviewRules(f, issue);
  f.questions.forEach((q, i) => {
    const first = f.questions.findIndex((other) => other.id === q.id);
    if (q.id === RACE_QUESTION) issue(`questions.${i}: "${RACE_QUESTION}" is the race question's id; the chooser asks it from class-roles.yaml`, ["questions", i]);
    else if (first !== i) issue(`questions.${i}: the id "${q.id}" is already used by questions.${first}`, ["questions", i]);
    q.options.forEach((o, j) => {
      const at = `questions.${i}.options.${j}`;
      const path = ["questions", i, "options", j];
      if (q.options.findIndex((other) => other.id === o.id) !== j) issue(`${at}: the id "${o.id}" is already used in this question`, path);
      if (o.classes !== undefined && (o.role !== undefined || o.weight !== undefined || o.readings !== undefined)) issue(`${at} weighs classes by role or one by one, not both`, path);
      else if (o.readings !== undefined && o.role === undefined) issue(`${at} gives readings without the role they read`, path);
      else if (o.role !== undefined && o.weight === undefined) issue(`${at} gives the role ${o.role} without the weight each class with it gets`, path);
      else if (o.role === undefined && o.weight !== undefined) issue(`${at} gives a weight without the role it applies to`, path);
      else if (o.role === undefined && !o.classes?.length) issue(`${at} weighs no class: give a role and a weight, or classes`, path);
      const named = [...(o.classes ?? []), ...(o.readings ?? [])];
      named.forEach((c, k) => {
        if (named.findIndex((other) => other.class === c.class) !== k) issue(`${at} weighs ${c.class} twice`, path);
      });
    });
  });
});
export type ClassChooser = z.infer<typeof ClassChooserFile>;

export interface ClassChooserData { roles: ClassRoles; chooser: ClassChooser }

/** The rule between the files: a reading is for a class the facts give no such role, or the class would count twice. */
function crossIssues({ roles, chooser }: ClassChooserData): { message: string; path: PropertyKey[] }[] {
  return chooser.questions.flatMap((q, i) => q.options.flatMap((o, j) => (o.readings ?? [])
    .filter((r) => roles.classes[r.class].roles.some((fact) => fact.role === o.role))
    .map((r) => ({ message: `questions.${i}.options.${j} reads ${r.class} as ${o.role}, a role class-roles.yaml already gives it`, path: ["questions", i, "options", j] }))));
}

/* ---------- Reading and checking ---------- */

export interface ChooserFile { path: string; source: string }
/** The two files, each null when it is not there. */
export interface ChooserFiles { roles: ChooserFile | null; chooser: ChooserFile | null }

type LineOf = (path: readonly PropertyKey[]) => number;

const normal = (source: string) => source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

/**
 * The line each field is written on: a key's own line, or a list item's. A field that is not written points at the
 * nearest one around it that is, and at the first line when there is none.
 */
function fieldLines(text: string, doc: Document): LineOf {
  const lineAt = (offset: number) => text.slice(0, offset).split("\n").length;
  return (path) => {
    let node: unknown = doc.contents;
    let line = 1;
    for (const key of path) {
      if (isMap(node)) {
        const pair = node.items.find((p) => isScalar(p.key) && p.key.value === key);
        if (!pair) break;
        if (isScalar(pair.key) && pair.key.range) line = lineAt(pair.key.range[0]);
        node = pair.value;
      } else if (isSeq(node) && typeof key === "number" && isNode(node.items[key])) {
        node = node.items[key];
        if (isNode(node) && node.range) line = lineAt(node.range[0]);
      } else break;
    }
    return line;
  };
}

const where = (path: readonly PropertyKey[]) => (path.length ? `${path.join(".")}: ` : "");

/** Each schema issue on the line of the field it is about, an unknown field on its own line. */
function reported(error: ZodError, lineOf: LineOf, file: string): Problem[] {
  return error.issues.flatMap((issue): Problem[] => issue.code === "unrecognized_keys"
    ? issue.keys.map((key) => ({ file, line: lineOf([...issue.path, key]), message: `${where(issue.path)}unknown field "${key}"` }))
    : [{ file, line: lineOf(issue.path), message: issue.code === "custom" ? issue.message : `${where(issue.path)}${issue.message}` }]);
}

/** A YAML error as a problem on its line. */
const yamlProblem = (file: string, doc: Document, before = ""): Problem => {
  const [e] = doc.errors;
  return { file, line: e.linePos?.[0]?.line ?? 1, message: `${before}${e.message.split("\n")[0]}` };
};

type Review = { status: "draft" | "reviewed"; version: number; reviewer: string; reviewedOn: string | null };

/**
 * One file read against its schema: the value, or its problems, each with its line; and the data as written. The check
 * and the site both read a file here, so they refuse the same files, a review dated after `today` included.
 */
function readFile<T extends Review>(file: ChooserFile, schema: z.ZodType<T>, today: string): { value: T | null; raw: unknown; problems: Problem[]; lineOf: LineOf } {
  const text = normal(file.source);
  const doc = parseDocument(text);
  const lineOf = fieldLines(text, doc);
  if (doc.errors.length) return { value: null, raw: null, problems: [yamlProblem(file.path, doc)], lineOf };
  const raw = doc.toJS();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { value: null, raw, problems: reported(parsed.error, lineOf, file.path), lineOf };
  const on = parsed.data.reviewedOn;
  if (on && on > today) return { value: null, raw, problems: [{ file: file.path, line: lineOf(["reviewedOn"]), message: `reviewedOn ${on} is after today (${today})` }], lineOf };
  return { value: parsed.data, raw, problems: [], lineOf };
}

/** The fields that record a file's review; a review vouches for everything else in the file. */
const REVIEW_FIELDS = ["status", "version", "reviewer", "reviewedOn"];

/** What a review vouches for, as text to compare: the data without its review fields, keys in order wherever they are written. */
function vouchedFor(data: unknown): string {
  const rest = Object.fromEntries(Object.entries((data ?? {}) as Record<string, unknown>).filter(([key]) => !REVIEW_FIELDS.includes(key)));
  return JSON.stringify(rest, (_, value) => (value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : value));
}

/**
 * A file held to its review before the change, as the guides hold a published version: once reviewed, any change to
 * it is a new version, which carries a review of its own or goes back to draft until it has one. A new review of the
 * same content is a new version too, and versions never go down. A file that was a draft, or was not there, is free.
 */
function heldToReview(name: string, path: string, now: { value: Review; raw: unknown }, lineOf: LineOf, before: ChooserFile): Problem[] {
  const doc = parseDocument(normal(before.source));
  if (doc.errors.length) return [yamlProblem(path, doc, "as it was before this change, the file does not read, so the change cannot be held to its review: ")];
  const then = doc.toJS() as Partial<Review> | null;
  if (then?.status !== "reviewed") return [];
  const v = then.version;
  const problem = (field: string, message: string): Problem[] => [{ file: path, line: lineOf([field]), message }];
  if (typeof v === "number" && now.value.version < v) return problem("version", `version ${now.value.version} is below version ${v}, reviewed before this change: versions never go down`);
  const sameReview = now.value.reviewer === then.reviewer && now.value.reviewedOn === then.reviewedOn;
  if (vouchedFor(now.raw) !== vouchedFor(then)) {
    if (now.value.version === v) return problem("version", `${name} was reviewed as version ${v} and has changed since: a change is a new version, so raise version above ${v}`);
    if (now.value.status === "reviewed" && sameReview) {
      return problem("reviewedOn", `version ${now.value.version} carries version ${v}'s review (${then.reviewer}, ${then.reviewedOn}); a new version needs its own review, or status: draft until it has one`);
    }
  } else if (now.value.version === v && now.value.status === "reviewed" && !sameReview) {
    return problem("version", `${name} version ${v} was reviewed by ${then.reviewer} on ${then.reviewedOn}; a new review is a new version, so raise version above ${v}`);
  }
  return [];
}

/**
 * Every rule the two files keep, each problem with its file and line. `today`: a review is never dated after it. The
 * files are read together, so one without the other is a problem. Given the files as they were before the change
 * (`previous`), a reviewed file is held to that review.
 */
export function checkClassChooser(files: ChooserFiles, today: string, previous?: ChooserFiles): { data: ClassChooserData | null; problems: Problem[] } {
  const problems: Problem[] = [];
  const read = <T extends Review>(key: keyof ChooserFiles, schema: z.ZodType<T>): { value: T | null; lineOf: LineOf } | null => {
    const file = files[key];
    if (!file) {
      problems.push({ file: `guides/${CHOOSER_FILES[key]}`, message: `guides/${CHOOSER_FILES[key]} is missing: the class chooser reads ${CHOOSER_FILES.roles} and ${CHOOSER_FILES.chooser} together` });
      return null;
    }
    const { value, raw, problems: found, lineOf } = readFile(file, schema, today);
    problems.push(...found);
    const before = previous?.[key];
    if (value && before) problems.push(...heldToReview(CHOOSER_FILES[key], file.path, { value, raw }, lineOf, before));
    return { value, lineOf };
  };
  const roles = read("roles", ClassRolesFile);
  const chooser = read("chooser", ClassChooserFile);
  if (roles?.value && chooser?.value) {
    for (const c of crossIssues({ roles: roles.value, chooser: chooser.value })) problems.push({ file: files.chooser!.path, line: chooser.lineOf(c.path), message: c.message });
  }
  return { data: roles?.value && chooser?.value && !problems.length ? { roles: roles.value, chooser: chooser.value } : null, problems };
}

/**
 * The two files as the site reads them: their data, or null when either breaks a rule of its own or of the two
 * together, a review dated after `today` included, as the check refuses them.
 */
export function parseClassChooser(roles: string, chooser: string, today = new Date().toISOString().slice(0, 10)): ClassChooserData | null {
  const r = readFile({ path: CHOOSER_FILES.roles, source: roles }, ClassRolesFile, today).value;
  const c = readFile({ path: CHOOSER_FILES.chooser, source: chooser }, ClassChooserFile, today).value;
  return r && c && !crossIssues({ roles: r, chooser: c }).length ? { roles: r, chooser: c } : null;
}
