/**
 * A class context: the class a player plans, and optionally the level they are at and the role a guide is written
 * for. A link carries it in full (/classes/<class>?level=25&role=damage, or class= on another page), so a page shows
 * what its address says. A class this browser remembers is offered beside it, never put in its place. The server
 * pages and the browser both read it, so this file reads no files and does not load the guide schema.
 */
import type { GuideRole } from "../../../kb/src/guides/guide";
import { CLASSES } from "@/design/tokens";

export type ClassSlug = (typeof CLASSES)[number];

export interface ClassContext { classSlug: ClassSlug; level?: number; role?: GuideRole }

/** The level cap: every calculator's rules.maxLevel (class-context.test.ts holds them equal). */
export const MAX_LEVEL = 60;

/** The roles a guide is written for: GUIDE_ROLES of kb/src/guides/guide.ts, held equal by the test. */
export const ROLES: readonly GuideRole[] = ["tank", "healer", "damage"];

const isClassSlug = (slug: string): slug is ClassSlug => (CLASSES as readonly string[]).includes(slug);
const isRole = (role: string): role is GuideRole => (ROLES as readonly string[]).includes(role);
const isLevel = (level: unknown): level is number => Number.isInteger(level) && (level as number) >= 1 && (level as number) <= MAX_LEVEL;

/** "Mage" for mage. */
export const classLabel = (slug: ClassSlug): string => slug[0].toUpperCase() + slug.slice(1);

type Search = URLSearchParams | Record<string, string | string[] | undefined>;

/** A link's class context; null when it carries none. An error is one sentence, for the page to show. */
export type ContextRead = { ok: true; context: ClassContext | null } | { ok: false; error: string };

/** A parameter's value; every value when it is given more than once. An empty value (a blank form field) is none. */
function param(search: Search, key: string): string | string[] | undefined {
  const given = (search instanceof URLSearchParams ? search.getAll(key) : ([] as string[]).concat(search[key] ?? [])).filter((v) => v !== "");
  return given.length > 1 ? given : given[0];
}

/** A value as a reason repeats it: quoted, and cut short when a link carries something long. */
const quoted = (value: string) => JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);

/**
 * The class context a link carries: `class` (or the hub's own class, `pathClass`), `level` and `role`. Read whole or
 * refused whole, with the reason: a value that is not one of these, given twice, or a level or role with no class.
 * A page narrows nothing by a value it could not read, and nothing fills the gap.
 */
export function parseClassContext(search: Search, pathClass?: string): ContextRead {
  const values = { class: pathClass ?? param(search, "class"), level: param(search, "level"), role: param(search, "role") };
  for (const [key, value] of Object.entries(values)) if (Array.isArray(value)) return { ok: false, error: `The link gives ${key} more than once.` };
  const { class: cls, level, role } = values as { class?: string; level?: string; role?: string };
  if (cls === undefined) return level === undefined && role === undefined ? { ok: true, context: null } : { ok: false, error: "A level or a role needs a class." };
  if (!isClassSlug(cls)) return { ok: false, error: `${quoted(cls)} is not one of the nine classes.` };
  if (level !== undefined && !(/^[1-9]\d?$/.test(level) && isLevel(Number(level)))) return { ok: false, error: `${quoted(level)} is not a level from 1 to ${MAX_LEVEL}.` };
  if (role !== undefined && !isRole(role)) return { ok: false, error: `${quoted(role)} is not a role guides are written for: tank, healer or damage.` };
  return { ok: true, context: { classSlug: cls, ...(level !== undefined ? { level: Number(level) } : {}), ...(role !== undefined ? { role } : {}) } };
}

/** The class's hub, with the level and role the context has. */
export function classHubHref(ctx: ClassContext): string {
  const query = new URLSearchParams();
  if (ctx.level !== undefined) query.set("level", String(ctx.level));
  if (ctx.role !== undefined) query.set("role", ctx.role);
  const q = query.toString();
  return q ? `/classes/${ctx.classSlug}?${q}` : `/classes/${ctx.classSlug}`;
}

export type ContextDestination = "hub" | "talents" | "spells" | "items" | "raid" | "professions" | "dungeons";
export interface ContextLink { key: ContextDestination; label: string; href: string }

/**
 * Where a class context leads: its hub, the class's talent calculator, then the spell, item, raid, profession and
 * dungeon pages. Each link carries the part of the context its page reads: the hub all of it; the calculator its
 * class; the spell, item, raid and profession pages all of it, which they show and keep on their own links (the
 * spell list also narrows to the class's talent catalog); the dungeon list nothing yet. A link never holds a value
 * its page would ignore.
 */
export function contextLinks(ctx: ClassContext): ContextLink[] {
  return [
    { key: "hub", label: classLabel(ctx.classSlug), href: classHubHref(ctx) },
    { key: "talents", label: "Talent calculator", href: `/tools/talents/${ctx.classSlug}` },
    { key: "spells", label: "Spells", href: withClassContext("/database/spells", ctx) },
    { key: "items", label: "Items", href: withClassContext("/database/items", ctx) },
    { key: "raid", label: "Raid builder", href: withClassContext("/tools/raid", ctx) },
    { key: "professions", label: "Profession hubs", href: withClassContext("/tools/professions", ctx) },
    { key: "dungeons", label: "Dungeons and raids", href: "/database/instances" },
  ];
}

/* ---------- The context on the pages it leads to ---------- */

const CONTEXT_KEYS = ["class", "level", "role"];

/** The parameters a context travels in, in the order a link writes them; a form sends them as hidden fields. */
export const classContextParams = (ctx: ClassContext): [string, string][] => [
  ["class", ctx.classSlug],
  ...(ctx.level !== undefined ? [["level", String(ctx.level)] as [string, string]] : []),
  ...(ctx.role ? [["role", ctx.role] as [string, string]] : []),
];

/** A link on or to a page a context leads to: the page's own parameters as they are, then class, level and role. */
export function withClassContext(href: string, ctx: ClassContext | null): string {
  return ctx ? `${href}${href.includes("?") ? "&" : "?"}${new URLSearchParams(classContextParams(ctx))}` : href;
}

/** Every parameter of an address, in order, once per value. */
const entries = (search: Search): [string, string][] => search instanceof URLSearchParams
  ? [...search.entries()]
  : Object.entries(search).flatMap(([k, v]) => ([] as string[]).concat(v ?? []).map((one): [string, string] => [k, one]));

/**
 * The address without its class context, read or refused: every other parameter as it was given, so taking the
 * context off never loses a filter. Commas stay commas, as the lists write them.
 */
export function withoutClassContext(path: string, search: Search): string {
  const rest = new URLSearchParams(entries(search).filter(([k]) => !CONTEXT_KEYS.includes(k))).toString().replace(/%2C/g, ",");
  return rest ? `${path}?${rest}` : path;
}

/**
 * An address without a context (withoutClassContext) with one put on it: back on its first page, since the list
 * it narrows may be shorter, and every other parameter kept. Taking a context off keeps the page.
 */
export function switchClassContext(here: string, ctx: ClassContext): string {
  const [path, query = ""] = here.split("?");
  const rest = new URLSearchParams(query);
  rest.delete("page");
  const kept = rest.toString().replace(/%2C/g, ",");
  return withClassContext(kept ? `${path}?${kept}` : path, ctx);
}

/** Whether an address gives a class, a level or a role, read or not: a page with one is not its plain list. */
export const hasClassContext = (search: Search): boolean => entries(search).some(([k, v]) => CONTEXT_KEYS.includes(k) && v !== "");

/** What a context adds to its class, in words: ["level 25", "damage"]. */
export const contextExtras = (ctx: ClassContext): string[] => [...(ctx.level !== undefined ? [`level ${ctx.level}`] : []), ...(ctx.role ? [ctx.role] : [])];

/** The context in words, in the order a link carries it: "Mage", "Mage, level 25, damage". */
export const contextLabel = (ctx: ClassContext): string => [classLabel(ctx.classSlug), ...contextExtras(ctx)].join(", ");

export const sameContext = (a: ClassContext, b: ClassContext): boolean => a.classSlug === b.classSlug && a.level === b.level && a.role === b.role;

/* ---------- The class this browser remembers ---------- */

/** Its key in localStorage. A later shape gets a new key, so this one only ever holds a ClassContext. */
export const CLASS_CONTEXT_SLOT = "everloot.class.context.v1";

/** localStorage, or a stand-in with its three calls. */
export type DeviceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A stored copy, when it is exactly a context the site reads; any other shape is none. */
function storedContext(value: unknown): ClassContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { classSlug, level, role, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length || typeof classSlug !== "string" || !isClassSlug(classSlug)) return null;
  if (level !== undefined && !isLevel(level)) return null;
  if (role !== undefined && (typeof role !== "string" || !isRole(role))) return null;
  return { classSlug, ...(level !== undefined ? { level } : {}), ...(role !== undefined ? { role } : {}) };
}

/** The class this browser remembers. Null for none, a copy the site cannot read, or storage the browser refuses. */
export function readClassContext(storage: DeviceStorage | null): ClassContext | null {
  try {
    const raw = storage?.getItem(CLASS_CONTEXT_SLOT);
    return raw ? storedContext(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Keeps the context on this browser. True only when it reads back as the same context. Nothing is sent anywhere. */
export function rememberClassContext(storage: DeviceStorage | null, ctx: ClassContext): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CLASS_CONTEXT_SLOT, JSON.stringify(ctx));
  } catch {
    return false;
  }
  const kept = readClassContext(storage);
  return kept !== null && sameContext(kept, ctx);
}

/** Removes this browser's copy. True only when none is left. */
export function forgetClassContext(storage: DeviceStorage | null): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(CLASS_CONTEXT_SLOT);
    return storage.getItem(CLASS_CONTEXT_SLOT) === null;
  } catch {
    return false;
  }
}
