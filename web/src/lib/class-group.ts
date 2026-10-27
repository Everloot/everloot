/**
 * A group planned by class: how many players it is for and which classes, in the order they were added. That is all a
 * plan holds and all its link carries: no names, characters or talent trees. What the classes bring is the raid
 * builder's coverage of the same places (lib/raid.ts), over its table from the game files, and a role is one a reviewed
 * guide is written for. Nothing here works a role out from a class or a tree, ranks a class or reads how many players
 * play one. The planner runs in the browser, so this file reads no files.
 */
import { CLASSES } from "@/design/tokens";
import type { BuffEntry, BuffTable, Family } from "@/data/game-data/raid";
import type { GuideRole } from "../../../kb/src/guides/guide";
import { ROLES, parseClassContext, type ClassSlug } from "./class-context";
import { GROUP_SIZE, SIZES, coverage, encodeRaid, groupsOf, treeNames, type Size, type Slot, type Slots } from "./raid";

/** A party of five, or one of the raid builder's raids. */
export const GROUP_SIZES = [GROUP_SIZE, ...SIZES] as const;
export type GroupSize = (typeof GROUP_SIZES)[number];

export interface GroupPlan { size: GroupSize; classes: ClassSlug[] }

export const EMPTY_GROUP: GroupPlan = { size: GROUP_SIZE, classes: [] };

/* ---------- The link ---------- */

export type GroupRead = { ok: true; plan: GroupPlan } | { ok: false; error: string };

/** A value as a reason repeats it, as class-context.ts quotes one: quoted, and cut short when a link carries something long. */
const quoted = (value: string) => JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);

/**
 * The group a link's fragment carries: `size` (5 when it has none) and `classes`, comma-separated in the order of the
 * places. Read whole or refused whole, with the reason: a size that is not a group size, a class a hub link would
 * refuse, an empty class, more classes than the size holds, or a value given twice. Nothing else in the link is read.
 */
export function parseGroup(search: URLSearchParams): GroupRead {
  const [sizes, lists] = ["size", "classes"].map((key) => search.getAll(key).filter((v) => v !== ""));
  if (sizes.length > 1) return { ok: false, error: "The link gives size more than once." };
  if (lists.length > 1) return { ok: false, error: "The link gives classes more than once." };
  const size = sizes.length ? GROUP_SIZES.find((s) => String(s) === sizes[0]) : GROUP_SIZE;
  if (size === undefined) return { ok: false, error: `${quoted(sizes[0])} is not a group size: 5, 10, 20 or 40.` };
  const classes: ClassSlug[] = [];
  for (const slug of lists.length ? lists[0].split(",") : []) {
    if (slug === "") return { ok: false, error: "The link lists an empty class." };
    const read = parseClassContext({ class: slug });
    if (!read.ok) return read;
    classes.push(read.context!.classSlug);
  }
  if (classes.length > size) return { ok: false, error: `A group of ${size} holds ${size} classes; the link gives ${classes.length}.` };
  return { ok: true, plan: { size, classes } };
}

/** The fragment of the group's link: its size and classes, nothing else. An empty group of five is the plain address. */
export function groupHash({ size, classes }: GroupPlan): string {
  if (size === GROUP_SIZE && classes.length === 0) return "";
  return `#size=${size}${classes.length ? `&classes=${classes.join(",")}` : ""}`;
}

export const groupHref = (plan: GroupPlan): string => `/classes/group${groupHash(plan)}`;

/* ---------- Planning ---------- */

/** The group with the class in its next open place; the same group when it is full. */
export const addClass = (plan: GroupPlan, c: ClassSlug): GroupPlan =>
  plan.classes.length < plan.size ? { ...plan, classes: [...plan.classes, c] } : plan;

/** The group without the class at `index`; the classes after it move up a place. */
export const removeClass = (plan: GroupPlan, index: number): GroupPlan =>
  index >= 0 && index < plan.classes.length ? { ...plan, classes: plan.classes.filter((_, i) => i !== index) } : plan;

/** The group at another size when that size holds every class chosen; the same group when it does not, so none is dropped. */
export const withSize = (plan: GroupPlan, size: GroupSize): GroupPlan =>
  size !== plan.size && plan.classes.length <= size ? { ...plan, size } : plan;

/** The group as the raid builder's places: five to a party in the order added, each on "any tree", as a plan names no tree. */
export const groupSlots = ({ size, classes }: GroupPlan): Slots =>
  Array.from({ length: size }, (_, i): Slot | null => (classes[i] ? { class: classes[i], tree: 0 } : null));

export interface Party { classes: ClassSlug[]; open: number }

/** The parties of five, each with its classes and its open places. */
export const partiesOf = (plan: GroupPlan): Party[] =>
  groupsOf(groupSlots(plan)).map((party) => ({ classes: party.flatMap((s) => (s ? [s.class] : [])), open: party.filter((s) => !s).length }));

/** Each class in the group and how often, in the game's class order. */
export const classCounts = ({ classes }: GroupPlan): { classSlug: ClassSlug; count: number }[] =>
  CLASSES.map((classSlug) => ({ classSlug, count: classes.filter((c) => c === classSlug).length })).filter((c) => c.count > 0);

/** The classes not in the group, in the game's class order. */
export const absentClasses = ({ classes }: GroupPlan): ClassSlug[] => CLASSES.filter((c) => !classes.includes(c));

/* ---------- Into the raid builder ---------- */

/** The smallest raid the raid builder plans that holds the group: a party of five opens as the first group of ten. */
export const raidSizeFor = (size: GroupSize): Size => SIZES.find((s) => s >= size) ?? SIZES[SIZES.length - 1];

/** The raid builder's own address for the group, which it reads from the fragment: the same classes in the same places. */
export const raidHref = (plan: GroupPlan, table: BuffTable): string =>
  `/tools/raid#raid=${encodeRaid({ size: raidSizeFor(plan.size), build: table.build, slots: groupSlots(plan) })}`;

/* ---------- What the group brings ---------- */

/** The talent a class needs for an effect: null when it comes with the class, a tree of null when the files match talents in more than one tree. */
export type Talent = { tree: string | null } | null;

export interface GroupCoverage {
  /** Effects every party gets; `cast` when they are cast on one player at a time. */
  brought: { family: Family; classes: ClassSlug[]; cast: boolean }[];
  /** Effects nobody in the group brings, under each class not in it that does and the talent it needs, in class order. */
  nobody: { classSlug: ClassSlug; effects: { family: Family; talent: Talent }[] }[];
  /** Effects a member brings only with a talent in this tree. */
  talent: { family: Family; classSlug: ClassSlug; tree: string }[];
  /** Party effects a member brings, and the parties (counted from 1) where nobody does. */
  party: { family: Family; parties: number[] }[];
  /** Effects a member brings where the files do not settle how far they reach, or which talent tree gives them. */
  unknown: { family: Family; classSlug: ClassSlug; reason: "reach" | "tree" }[];
}

const classesOf = (entries: BuffEntry[]): ClassSlug[] => CLASSES.filter((c) => entries.some((e) => e.class === c));

/**
 * What the group brings and what it does not: the raid builder's coverage of the group's places, sorted into what every
 * party gets, what nobody brings (under the classes that would), what needs a talent, a party effect some parties go
 * without, and what the files leave unknown. Each is a statement of coverage; none ranks a class.
 */
export function groupCoverage(plan: GroupPlan, table: BuffTable): GroupCoverage {
  const result: GroupCoverage = { brought: [], nobody: [], talent: [], party: [], unknown: [] };
  const treeName = (e: BuffEntry, tree: number) => treeNames(table, e.class as ClassSlug)[tree - 1] ?? `tree ${tree}`;
  const talentOf = (e: BuffEntry): Talent => (e.tree === "baseline" ? null : { tree: e.tree === "unknown" ? null : treeName(e, e.tree) });
  const missing = new Map<ClassSlug, { family: Family; talent: Talent }[]>();
  const cov = coverage(groupSlots(plan), table);
  for (const { family, groups, raid, entries } of [...cov.buffs, ...cov.debuffs]) {
    const ours = entries.filter((e) => (plan.classes as string[]).includes(e.class));
    if (raid === "covered" || raid === "cast") {
      result.brought.push({ family, classes: classesOf(ours), cast: raid === "cast" });
    } else if (raid === "possible") {
      for (const e of ours) {
        if (typeof e.tree !== "number") continue;
        const t = { family, classSlug: e.class as ClassSlug, tree: treeName(e, e.tree) };
        if (!result.talent.some((x) => x.family === family && x.classSlug === t.classSlug && x.tree === t.tree)) result.talent.push(t);
      }
    } else if (raid === "unknown") {
      for (const classSlug of classesOf(ours)) {
        result.unknown.push({ family, classSlug, reason: ours.some((e) => e.class === classSlug && e.tree === "unknown") ? "tree" : "reach" });
      }
    } else if (groups.some((g) => g !== "missing")) {
      result.party.push({ family, parties: groups.flatMap((g, i) => (g === "missing" ? [i + 1] : [])) });
    } else {
      for (const e of entries) {
        const list = missing.get(e.class as ClassSlug) ?? [];
        const listed = list.find((x) => x.family === family);
        // The class brings it without a talent when any of its entries does.
        if (!listed) list.push({ family, talent: talentOf(e) });
        else if (talentOf(e) === null) listed.talent = null;
        missing.set(e.class as ClassSlug, list);
      }
    }
  }
  result.nobody = CLASSES.filter((c) => missing.has(c)).map((classSlug) => ({ classSlug, effects: missing.get(classSlug)! }));
  return result;
}

/* ---------- Roles ---------- */

/** The roles a class's reviewed guides are written for, in ROLES order; none without a guide. */
export const reviewedRoles = (guides: { roles: readonly GuideRole[] }[]): GuideRole[] => ROLES.filter((r) => guides.some((g) => g.roles.includes(r)));
