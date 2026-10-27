import { LIMITS, codeClass, validId } from "./saved-builds";
import { TALENT_CLASSES, type TalentClassSlug } from "./talents/catalogs";
import { readPlanHash } from "./talents/import";
import { decodeBuild, decodeOrder, type OrderError, type OrderOrigin } from "./talents/share";

// The plans, alts and watches a player keeps in this browser, with no account and nothing uploaded: the
// PlayerWorkspace, format version 2. Version 2 gave alts their details (realm, class, level and the rest). Version 1
// is still read, its alts with those details unknown, and a version 1 bucket stays version 1 until an alt holds one of
// them (storedForm): pages that read only version 1 keep reading it, and its size and backup stay as they were. A
// shape change takes a new version number, so an older page reads newer data as newer and leaves it alone.
//
// One bucket per owner, each under its own localStorage key: the browser signed out, and each account by its
// stable user id, never its name. A plan saved in one bucket is shown in no other, so signing in, out or into
// another account shows that owner's plans only. That keeps plans apart on a shared browser. It is not
// encryption: whoever controls the browser can read every bucket.
//
// Every read and write says what happened. A write reads the stored bucket, makes one change, checks the result
// against the format and the limits, and stores it in one go: a plan another tab saved is kept, and nothing is
// stored unless every step worked. Stored text that does not read (damaged, or from a newer version) is left
// exactly as it is. A backup is a bucket's own text; it restores only into the bucket it came from, after a
// preview. A plan saved to an account by a transfer (components/workspace/TransferPlans.tsx) is bound to it and moves
// into that account's bucket, with the alts and watches that use it (bindTransferred).

export const WORKSPACE_FORMAT = "everloot.player-workspace";
/** The version a new bucket is stored in, and a version 1 bucket once an alt has version 2's details. */
export const WORKSPACE_VERSION = 2;
/** The newest version this version reads. A bucket in a newer one is left alone. */
export const NEWEST_VERSION = 2;
export type WorkspaceVersion = 1 | 2;

/** What one bucket holds at most. Names, notes and codes have the account's own limits (saved-builds.ts), so a
 *  plan saved to an account later is never cut. An alt's realm and level go as far as the addon's records do
 *  (packages/protocol): a realm of 60 characters, level 60. Everything fits a backup of 1 MiB. */
export const WORKSPACE_LIMITS = {
  plans: 200, alts: 60, altPlans: 10, name: LIMITS.name, notes: LIMITS.notes, code: LIMITS.code, bytes: 1024 * 1024,
  realm: 60, level: 60,
} as const;

/** Whose plans a bucket holds: the browser signed out, or one account by its stable id. */
export type Owner = { kind: "anonymous" } | { kind: "account"; userId: string };

/** The account a plan was saved to, and when. A bound plan lives in that account's bucket only. */
export interface Binding { userId: string; at: string }

export interface LocalPlan {
  id: string;
  name: string;
  classSlug: string;
  /** Set 1's share code, and set 2's when it has points. */
  code: string;
  code2: string | null;
  /** Each set's spend order token as it came, null when the order is unknown. A token this version cannot read
   *  is kept with the talents, and the calculator opens it as unknown. */
  order: string | null;
  order2: string | null;
  notes: string;
  updatedAt: string;
  boundTo: Binding | null;
}

/** The professions an alt can list: the same list the profession pages name (PROFESSIONS), in the game's order. A
 *  test keeps the two the same, so this module needs nothing from the modules that read the game's art. */
export const ALT_PROFESSIONS = [
  "Alchemy", "Blacksmithing", "Enchanting", "Engineering", "Herbalism", "Leatherworking", "Mining", "Skinning", "Tailoring",
  "Cooking", "First Aid", "Fishing",
] as const;

export type Faction = "alliance" | "horde";

/** The details of an alt that the player's own addon file can give. */
export const FILE_DETAILS = ["classSlug", "level", "faction"] as const;
export type FileDetail = (typeof FILE_DETAILS)[number];

/** Where an alt's details came from: typed here or added from the player's own addon file, the newest record of
 *  that file read into it (null if none ever was), and which details still hold the file's values, not the player's. */
export interface AltProvenance { source: "manual" | "addon-file"; fileRecordAt: string | null; fileDetails: FileDetail[] }

/** One of the player's characters and the plans it uses. A detail not known is null (no professions, an empty
 *  list), never guessed. */
export interface LocalAlt {
  id: string;
  name: string;
  realm: string | null;
  classSlug: TalentClassSlug | null;
  faction: Faction | null;
  level: number | null;
  professions: string[];
  notes: string;
  planIds: string[];
  provenance: AltProvenance;
  updatedAt: string;
}

/** A plan the player asked to hear about. */
export interface LocalWatch { id: string; planId: string; addedAt: string }

export interface PlayerWorkspace {
  format: typeof WORKSPACE_FORMAT;
  /** The version the bucket is stored in, kept on every change. */
  version: WorkspaceVersion;
  owner: Owner;
  plans: LocalPlan[];
  alts: LocalAlt[];
  watches: LocalWatch[];
}

/** localStorage, or a stand-in with its three calls. Its list of keys, where it has one, lets a transfer find a plan
 *  this browser holds for another account (boundElsewhere). */
export type DeviceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> & Partial<Pick<Storage, "key" | "length">>;

export const ANONYMOUS: Owner = { kind: "anonymous" };
const KEY = "everloot:workspace";

export const bucketKey = (owner: Owner) => (owner.kind === "anonymous" ? `${KEY}:anonymous` : `${KEY}:account:${owner.userId}`);
export const sameOwner = (a: Owner, b: Owner) => bucketKey(a) === bucketKey(b);
export const emptyWorkspace = (owner: Owner): PlayerWorkspace =>
  ({ format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, owner, plans: [], alts: [], watches: [] });

/** This browser's localStorage, or null when the browser refuses it (blocked site data). */
export function deviceStorage(): DeviceStorage | null {
  try { return window.localStorage; } catch { return null; }
}

// The format, checked field by field. Nothing read is run or kept beyond the fields below.

export type FormatError = "malformed" | "newer-version" | "over-limit" | "bad-reference";
export type Validation = { ok: true; workspace: PlayerWorkspace } | { ok: false; error: FormatError };

const PLAN_KEYS = ["id", "name", "classSlug", "code", "code2", "order", "order2", "notes", "updatedAt", "boundTo"] as const;
const ALT_KEYS = ["id", "name", "realm", "classSlug", "faction", "level", "professions", "notes", "planIds", "provenance", "updatedAt"] as const;
/** An alt as version 1 kept it. */
const V1_ALT_KEYS = ["id", "name", "planIds", "notes", "updatedAt"] as const;
const PROVENANCE_KEYS = ["source", "fileRecordAt", "fileDetails"] as const;
const WATCH_KEYS = ["id", "planId", "addedAt"] as const;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** What a link carries after #plan= or &order=: an order token with anything else would break its plan's link. */
const TOKEN = /^[A-Za-z0-9_.-]+$/;

/** Characters as the account counts them, so a limit here is the limit there. */
const length = (s: string) => Array.from(s).length;
const bytes = (text: string) => new TextEncoder().encode(text).length;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const hasKeys = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const isDate = (v: unknown) => typeof v === "string" && ISO.test(v) && Number.isFinite(Date.parse(v));
const unique = (ids: string[]) => new Set(ids).size === ids.length;

/** Plain text, as the account keeps it: control characters out (line breaks kept in notes), trimmed. */
export function clean(value: string, multiline: boolean): string {
  const text = multiline ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "") : value.replace(/[\u0000-\u001f\u007f]/g, "");
  return text.trim();
}

const isName = (v: unknown) => typeof v === "string" && v === clean(v, false) && length(v) >= 1 && length(v) <= WORKSPACE_LIMITS.name;
const isNotes = (v: unknown) => typeof v === "string" && v === clean(v, true) && length(v) <= WORKSPACE_LIMITS.notes;
const isToken = (v: unknown): v is string | null => v === null || (typeof v === "string" && v.length <= WORKSPACE_LIMITS.code && TOKEN.test(v));

function isOwner(v: unknown): v is Owner {
  if (!isRecord(v)) return false;
  return v.kind === "anonymous" ? hasKeys(v, ["kind"]) : v.kind === "account" && hasKeys(v, ["kind", "userId"]) && validId(v.userId);
}

/** A plan: two codes of its class, each order beside its own code, and bound, if at all, to its bucket's account. */
function isPlan(v: unknown, owner: Owner): v is LocalPlan {
  if (!isRecord(v) || !hasKeys(v, PLAN_KEYS)) return false;
  const { id, name, classSlug, code, code2, order, order2, notes, updatedAt, boundTo } = v;
  if (!validId(id) || !isName(name) || !isNotes(notes) || !isDate(updatedAt)) return false;
  if (typeof code !== "string" || codeClass(code) === null || codeClass(code) !== classSlug) return false;
  if (code2 !== null && (typeof code2 !== "string" || codeClass(code2) !== classSlug)) return false;
  if (!isToken(order) || !isToken(order2) || (order2 !== null && code2 === null)) return false;
  if (boundTo === null) return true;
  return isRecord(boundTo) && hasKeys(boundTo, ["userId", "at"]) && isDate(boundTo.at)
    && owner.kind === "account" && boundTo.userId === owner.userId;
}

const isRealm = (v: unknown) => v === null || (typeof v === "string" && v === clean(v, false) && length(v) >= 1 && length(v) <= WORKSPACE_LIMITS.realm);
const isLevel = (v: unknown) => v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= WORKSPACE_LIMITS.level);
const isClass = (v: unknown) => v === null || (TALENT_CLASSES as readonly unknown[]).includes(v);
const isProfessions = (v: unknown): v is string[] => Array.isArray(v) && v.every((p) => (ALT_PROFESSIONS as readonly unknown[]).includes(p)) && unique(v);

/** How an alt came, and its file's details: a detail can hold a file's value only once a file was read into the alt,
 *  and only while it has one. */
function isProvenance(v: unknown, alt: Record<string, unknown>): boolean {
  if (!isRecord(v) || !hasKeys(v, PROVENANCE_KEYS)) return false;
  const { source, fileRecordAt, fileDetails } = v;
  if ((source !== "manual" && source !== "addon-file") || (fileRecordAt !== null && !isDate(fileRecordAt))) return false;
  if (!Array.isArray(fileDetails) || !fileDetails.every((d) => (FILE_DETAILS as readonly unknown[]).includes(d)) || !unique(fileDetails)) return false;
  if ((source === "addon-file" || fileDetails.length > 0) && fileRecordAt === null) return false;
  return fileDetails.every((d) => alt[d] !== null);
}

const isAlt = (v: unknown): v is LocalAlt => isRecord(v) && hasKeys(v, ALT_KEYS) && validId(v.id) && isName(v.name) && isRealm(v.realm)
  && isClass(v.classSlug) && (v.faction === null || v.faction === "alliance" || v.faction === "horde") && isLevel(v.level)
  && isProfessions(v.professions) && isNotes(v.notes) && Array.isArray(v.planIds) && v.planIds.every(validId)
  && isProvenance(v.provenance, v) && isDate(v.updatedAt);
const isWatch = (v: unknown): v is LocalWatch => isRecord(v) && hasKeys(v, WATCH_KEYS) && validId(v.id) && validId(v.planId) && isDate(v.addedAt);

type V1Alt = Pick<LocalAlt, "id" | "name" | "planIds" | "notes" | "updatedAt">;
const isV1Alt = (v: unknown): v is V1Alt => isRecord(v) && hasKeys(v, V1_ALT_KEYS) && validId(v.id) && isName(v.name) && isNotes(v.notes)
  && isDate(v.updatedAt) && Array.isArray(v.planIds) && v.planIds.every(validId);

/** A version 1 alt as version 2 keeps it: all it had, and the details version 2 added, not known. */
const upgradeAlt = ({ id, name, planIds, notes, updatedAt }: V1Alt): LocalAlt => ({
  id, name, realm: null, classSlug: null, faction: null, level: null, professions: [], notes, planIds,
  provenance: { source: "manual", fileRecordAt: null, fileDetails: [] }, updatedAt,
});

/**
 * Is `value` a workspace this version reads, within the limits, every alt and watch naming a plan it holds? That is
 * version 2, or version 1, which comes back as version 2 (upgradeAlt). Each version's alts have exactly that
 * version's fields, so a version 1 workspace never carries version 2's.
 */
export function validateWorkspace(value: unknown): Validation {
  const refuse = (error: FormatError): Validation => ({ ok: false, error });
  if (!isRecord(value) || value.format !== WORKSPACE_FORMAT) return refuse("malformed");
  // A newer version may change everything after its number; say so rather than guess.
  if (typeof value.version === "number" && Number.isInteger(value.version) && value.version > NEWEST_VERSION) return refuse("newer-version");
  const { version, owner, plans, alts, watches } = value;
  if ((version !== 1 && version !== WORKSPACE_VERSION) || !hasKeys(value, ["format", "version", "owner", "plans", "alts", "watches"]) || !isOwner(owner)) return refuse("malformed");
  if (!Array.isArray(plans) || !Array.isArray(alts) || !Array.isArray(watches)) return refuse("malformed");
  // Counts before contents, so an overlong list is refused before each entry is checked.
  if (plans.length > WORKSPACE_LIMITS.plans || alts.length > WORKSPACE_LIMITS.alts) return refuse("over-limit");
  if (!plans.every((p) => isPlan(p, owner)) || !alts.every(version === 1 ? isV1Alt : isAlt) || !watches.every(isWatch)) return refuse("malformed");
  const altList = alts as V1Alt[];
  if (![plans, altList, watches].every((list) => unique(list.map((item) => item.id)))) return refuse("malformed");
  if (altList.some((a) => a.planIds.length > WORKSPACE_LIMITS.altPlans)) return refuse("over-limit");
  const planIds = new Set(plans.map((p) => p.id));
  const named = (id: string) => planIds.has(id);
  if (!altList.every((a) => unique(a.planIds) && a.planIds.every(named))) return refuse("bad-reference");
  if (!watches.every((w) => named(w.planId)) || !unique(watches.map((w) => w.planId))) return refuse("bad-reference");
  if (bytes(JSON.stringify(value)) > WORKSPACE_LIMITS.bytes) return refuse("over-limit");
  // A version 1 bucket stays version 1 (see storedForm): only its alts are read as version 2's, their new details unknown.
  const workspace = version === 1 ? { ...value, alts: altList.map(upgradeAlt) } : value;
  return { ok: true, workspace: workspace as unknown as PlayerWorkspace };
}

// Reading and writing a bucket.

export type ReadError = "unavailable" | "corrupt" | "newer-version";
export type WriteError =
  | ReadError | "full" | "over-limit" | "invalid" | "missing" | "referenced" | "changed" | "other-owner"
  | "not-transferred" | "incomplete" | "left-signed-out" | "format-room";
export type Failure = { ok: false; error: WriteError; message: string };
export type ReadResult = { ok: true; workspace: PlayerWorkspace; raw: string | null } | (Failure & { error: ReadError; raw: string | null });
export type WriteResult = { ok: true; workspace: PlayerWorkspace } | Failure;

const MESSAGES: Record<WriteError, string> = {
  unavailable: "This browser is not letting Everloot keep anything on this device (private browsing or blocked site data), so plans cannot be saved here. Links and share codes still work.",
  corrupt: "The plans stored on this device could not be read. They are kept as they are, and nothing is saved over them.",
  "newer-version": "The plans on this device were saved by a newer version of Everloot. Reload the page to open them. Nothing here changes them.",
  full: "This browser's storage is full, so nothing was saved. The plans on this device are as they were.",
  "over-limit": `That is more than this device keeps: ${WORKSPACE_LIMITS.plans} plans and ${WORKSPACE_LIMITS.alts} alts, all within a 1 MiB backup. Nothing was changed.`,
  invalid: "That plan is not valid, so nothing was saved.",
  missing: "That plan is no longer on this device. It may have been deleted in another tab.",
  referenced: "An alt or a watch on this device uses that plan, so it was left as it is.",
  changed: "The plans on this device changed since the preview. Choose the backup again to see what it would do now.",
  "other-owner": "Those plans belong to another account, so nothing was changed.",
  "not-transferred": "The transfer did not finish, so nothing on this device changed.",
  incomplete: "The transfer did not confirm every plan it was sent, so none were moved. Nothing on this device changed.",
  "left-signed-out": "The plans were saved to the account, but this browser could not take them out of its signed-out plans, so they show in both.",
  "format-room": "The plans and alts on this device are saved in an older format. Alt details need the newer one, which takes more room for the same alts, and here that would come to more than the 1 MiB this device keeps. Nothing was changed. Download a backup first (it keeps the older format), then delete a plan or an alt, or shorten some notes, to make room.",
};

const failure = (error: WriteError, message = MESSAGES[error]): Failure => ({ ok: false, error, message });

export function readWorkspace(storage: DeviceStorage | null, owner: Owner): ReadResult {
  let raw: string | null;
  try {
    if (!storage) throw new Error("No storage");
    raw = storage.getItem(bucketKey(owner));
  } catch {
    return { ...failure("unavailable"), error: "unavailable", raw: null };
  }
  if (raw === null) return { ok: true, workspace: emptyWorkspace(owner), raw };
  const refuse = (error: ReadError): ReadResult => ({ ...failure(error), error, raw });
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return refuse("corrupt"); }
  const checked = validateWorkspace(value);
  if (!checked.ok) return refuse(checked.error === "newer-version" ? "newer-version" : "corrupt");
  // A bucket holds its own owner's plans; one copied under another key is not shown.
  return sameOwner(checked.workspace.owner, owner) ? { ok: true, workspace: checked.workspace, raw } : refuse("corrupt");
}

/** What stored text that does not read holds, as far as it can be counted: its plans, alts and watches, and how many
 *  of the plans and alts have notes. Null when it holds no list that can be counted. Nothing in it is checked. */
export function storedCounts(raw: string): { plans: number; alts: number; watches: number; notes: number } | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!isRecord(value) || ![value.plans, value.alts, value.watches].some(Array.isArray)) return null;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const [plans, alts, watches] = [list(value.plans), list(value.alts), list(value.watches)];
  const notes = [...plans, ...alts].filter((item) => isRecord(item) && typeof item.notes === "string" && item.notes.trim() !== "").length;
  return { plans: plans.length, alts: alts.length, watches: watches.length, notes };
}

const isQuota = (error: unknown) => error instanceof DOMException
  && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED" || error.code === 22);

/** Check one bucket and store the whole of it in one write. */
/** Whether an alt has nothing version 1 cannot hold: no version 2 detail, and typed here. */
const plainAlt = (a: LocalAlt) => a.realm === null && a.classSlug === null && a.faction === null && a.level === null
  && a.professions.length === 0 && a.provenance.source === "manual" && a.provenance.fileRecordAt === null && a.provenance.fileDetails.length === 0;

/**
 * A bucket as it is stored. One stored in version 1 stays version 1 while every alt is plain, its alts written back
 * with version 1's fields, so its stored text and its backup keep their size and older pages can still read it. It
 * moves to version 2 once an alt holds a version 2 detail, and a version 2 bucket stays version 2.
 */
export function storedForm(workspace: PlayerWorkspace): PlayerWorkspace | (Omit<PlayerWorkspace, "alts"> & { alts: V1Alt[] }) {
  if (workspace.version === 1 && workspace.alts.every(plainAlt)) {
    return { ...workspace, alts: workspace.alts.map(({ id, name, planIds, notes, updatedAt }) => ({ id, name, planIds, notes, updatedAt })) };
  }
  return { ...workspace, version: 2 };
}

/** How many bytes a version 1 bucket would take once an alt needs version 2, when that is more than a device keeps;
 *  null when it is stored in version 2 or would fit. Version 2 spells out each alt's details, so the same alts take
 *  more room. */
export function newFormatOverflow(workspace: PlayerWorkspace): number | null {
  if (workspace.version !== 1) return null;
  const size = bytes(JSON.stringify({ ...workspace, version: 2 }));
  return size > WORKSPACE_LIMITS.bytes ? size : null;
}

/** A bucket as it would be stored, or why it cannot be: checked against the format and the limits as stored. */
function storable(workspace: PlayerWorkspace): { ok: true; doc: ReturnType<typeof storedForm> } | Failure {
  const doc = storedForm(workspace);
  const checked = validateWorkspace(doc);
  if (checked.ok) return { ok: true, doc };
  if (checked.error === "over-limit" && workspace.version === 1 && doc.version === 2) return failure("format-room");
  return failure(checked.error === "over-limit" ? "over-limit" : "invalid");
}

function store(storage: DeviceStorage | null, workspace: PlayerWorkspace): WriteResult {
  const checked = storable(workspace);
  if (!checked.ok) return checked;
  try {
    if (!storage) throw new Error("No storage");
    storage.setItem(bucketKey(workspace.owner), JSON.stringify(checked.doc));
    return { ok: true, workspace: { ...workspace, version: checked.doc.version } };
  } catch (error) {
    return failure(isQuota(error) ? "full" : "unavailable");
  }
}

/** The owner's bucket as stored now, `change` made to it, then stored. Nothing is stored unless every step works.
 *  The alt planner (lib/alt-workspace.ts, lib/alt-import.ts) changes alts through it too. */
export function update(storage: DeviceStorage | null, owner: Owner, change: (workspace: PlayerWorkspace) => PlayerWorkspace | Failure): WriteResult {
  const read = readWorkspace(storage, owner);
  if (!read.ok) return failure(read.error);
  const next = change(read.workspace);
  return "error" in next ? next : store(storage, next);
}

const replace = (workspace: PlayerWorkspace, plan: LocalPlan): PlayerWorkspace =>
  ({ ...workspace, plans: workspace.plans.map((p) => (p.id === plan.id ? plan : p)) });

export interface PlanInput {
  /** The plan to update; left out or null, a new plan. */
  id?: string | null;
  name: string;
  notes: string;
  classSlug: string;
  /** Each set's share code and spend order token as the page has them; set 1 needs a code. */
  codes: [string | null, string | null];
  orders: [string | null, string | null];
}

export type PlanResult = ({ ok: true; workspace: PlayerWorkspace; plan: LocalPlan }) | Failure;

function nameAndNotes(input: { name: string; notes: string }): { name: string; notes: string } | Failure {
  const name = clean(input.name, false);
  if (!name || length(name) > WORKSPACE_LIMITS.name) return failure("invalid", `Give the plan a name of 1 to ${WORKSPACE_LIMITS.name} characters.`);
  const notes = clean(input.notes, true);
  if (length(notes) > WORKSPACE_LIMITS.notes) return failure("invalid", `Notes can be up to ${WORKSPACE_LIMITS.notes.toLocaleString("en-US")} characters.`);
  return { name, notes };
}

function planFields(input: PlanInput): Omit<LocalPlan, "id" | "updatedAt" | "boundTo"> | Failure {
  const text = nameAndNotes(input);
  if ("error" in text) return text;
  const [code, code2] = input.codes;
  if (!code) return failure("invalid", "Spend a point in set 1 to save this plan.");
  const classSlug = codeClass(code);
  if (!classSlug || classSlug !== input.classSlug) return failure("invalid", "That share code is not valid.");
  if (code2 !== null && codeClass(code2) !== classSlug) return failure("invalid", "Both talent sets must be for the same class.");
  // An order without its set's code has nothing to order; links leave it out too.
  const [order, order2] = [input.orders[0], code2 === null ? null : input.orders[1]];
  if (!isToken(order) || !isToken(order2)) return failure("invalid", "A spend order is not one a link can carry.");
  return { name: text.name, classSlug, code, code2, order, order2, notes: text.notes };
}

/** A new plan, or with `input.id` that plan updated in place. */
export function savePlan(storage: DeviceStorage | null, owner: Owner, input: PlanInput, now = new Date()): PlanResult {
  const fields = planFields(input);
  if ("error" in fields) return fields;
  let plan: LocalPlan | undefined;
  const result = update(storage, owner, (workspace) => {
    if (!input.id) {
      plan = { id: crypto.randomUUID(), ...fields, updatedAt: now.toISOString(), boundTo: null };
      return { ...workspace, plans: [...workspace.plans, plan] };
    }
    const old = workspace.plans.find((p) => p.id === input.id);
    if (!old) return failure("missing");
    if (old.classSlug !== fields.classSlug) return failure("invalid", "That plan is for another class, so it was not changed.");
    plan = { ...old, ...fields, updatedAt: now.toISOString() };
    return replace(workspace, plan);
  });
  return result.ok ? { ...result, plan: plan! } : result;
}

/** A new name and notes; the talents and orders stay. */
export function editPlan(storage: DeviceStorage | null, owner: Owner, id: string, edit: { name: string; notes: string }, now = new Date()): PlanResult {
  const text = nameAndNotes(edit);
  if ("error" in text) return text;
  let plan: LocalPlan | undefined;
  const result = update(storage, owner, (workspace) => {
    const old = workspace.plans.find((p) => p.id === id);
    if (!old) return failure("missing");
    plan = { ...old, ...text, updatedAt: now.toISOString() };
    return replace(workspace, plan);
  });
  return result.ok ? { ...result, plan: plan! } : result;
}

/** "<name> (copy)", cut to stay within the name limit, as the account's Duplicate names it. */
function copyName(name: string): string {
  const suffix = " (copy)";
  return Array.from(name).slice(0, WORKSPACE_LIMITS.name - suffix.length).join("").trimEnd() + suffix;
}

/** A second plan with the same talents, orders and notes. It is new on this device, so it is bound to no account. */
export function copyPlan(storage: DeviceStorage | null, owner: Owner, id: string, now = new Date()): PlanResult {
  let plan: LocalPlan | undefined;
  const result = update(storage, owner, (workspace) => {
    const old = workspace.plans.find((p) => p.id === id);
    if (!old) return failure("missing");
    plan = { ...old, id: crypto.randomUUID(), name: copyName(old.name), updatedAt: now.toISOString(), boundTo: null };
    return { ...workspace, plans: [...workspace.plans, plan] };
  });
  return result.ok ? { ...result, plan: plan! } : result;
}

/** Deletes a plan, unless an alt or a watch still names it. */
export function deletePlan(storage: DeviceStorage | null, owner: Owner, id: string): WriteResult {
  return update(storage, owner, (workspace) => {
    if (!workspace.plans.some((p) => p.id === id)) return failure("missing");
    if (workspace.alts.some((a) => a.planIds.includes(id)) || workspace.watches.some((w) => w.planId === id)) return failure("referenced");
    return { ...workspace, plans: workspace.plans.filter((p) => p.id !== id) };
  });
}

// Transfers: signed-out plans saved to an account (components/workspace/TransferPlans.tsx).

/** Signed-out plans that go to an account together: a plan, every other plan of the alts that use it, and so on, so no
 *  alt is left naming a plan its bucket no longer holds. A plan no alt uses is a group of its own. Groups, their plans
 *  and their alts come in the bucket's order. */
export interface PlanGroup { planIds: string[]; altIds: string[] }

export function planGroups(workspace: PlayerWorkspace): PlanGroup[] {
  const parent = new Map(workspace.plans.map((p) => [p.id, p.id]));
  const root = (id: string): string => { let r = id; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  for (const alt of workspace.alts) {
    const [first, ...rest] = alt.planIds;
    for (const id of rest) parent.set(root(id), root(first));
  }
  const groups = new Map<string, PlanGroup>();
  for (const plan of workspace.plans) {
    const key = root(plan.id);
    if (!groups.has(key)) groups.set(key, { planIds: [], altIds: [] });
    groups.get(key)!.planIds.push(plan.id);
  }
  for (const alt of workspace.alts) if (alt.planIds.length > 0) groups.get(root(alt.planIds[0]))!.altIds.push(alt.id);
  return [...groups.values()];
}

/**
 * How a signed-out plan stands with the account a transfer is for. `saved`: the account's bucket holds it, bound to
 * the account, and the copy here is the same or older, so the account's copy is the one kept and nothing is sent
 * again. `changed`: it is bound there, and the copy here was changed after, so sending it again would make a second
 * build. `elsewhere`: this browser holds it bound to another account (boundElsewhere).
 */
export type Standing = { kind: "new" } | { kind: "saved" | "changed"; at: string } | { kind: "elsewhere" };

const content = (plan: LocalPlan) => fields({ ...plan, boundTo: null }, PLAN_KEYS);

export function transferStanding(plan: LocalPlan, account: PlayerWorkspace, elsewhere: Set<string>): Standing {
  const theirs = account.plans.find((p) => p.id === plan.id && p.boundTo !== null);
  if (theirs?.boundTo) {
    const kept = content(plan) === content(theirs) || Date.parse(plan.updatedAt) <= Date.parse(theirs.updatedAt);
    return { kind: kept ? "saved" : "changed", at: theirs.boundTo.at };
  }
  return elsewhere.has(plan.id) ? { kind: "elsewhere" } : { kind: "new" };
}

const ACCOUNT_KEY = `${KEY}:account:`;

/** Which of these plans this browser holds bound to an account other than `owner`: saved to it by a transfer from
 *  here, with a copy left signed out. Only the plans' ids are looked at, and nothing of that account is shown. */
export function boundElsewhere(storage: DeviceStorage | null, owner: Owner, planIds: string[]): Set<string> {
  const wanted = new Set(planIds);
  const found = new Set<string>();
  try {
    for (let i = 0; storage?.key && i < (storage.length ?? 0); i++) {
      const key = storage.key(i);
      const userId = key?.startsWith(ACCOUNT_KEY) ? key.slice(ACCOUNT_KEY.length) : null;
      if (!validId(userId) || (owner.kind === "account" && owner.userId === userId)) continue;
      const read = readWorkspace(storage, { kind: "account", userId });
      if (read.ok) for (const p of read.workspace.plans) if (p.boundTo && wanted.has(p.id)) found.add(p.id);
    }
  } catch {
    // A browser that refuses its key list has nothing more to find.
  }
  return found;
}

/** The account's bucket with these plans in it, bound to the account. A plan it holds bound already keeps its copy. */
function withBound(account: PlayerWorkspace, plans: LocalPlan[], boundTo: Binding): PlayerWorkspace {
  const held = new Set(account.plans.filter((p) => p.boundTo !== null).map((p) => p.id));
  const ids = new Set(plans.map((p) => p.id));
  return {
    ...account,
    plans: [...account.plans.filter((p) => held.has(p.id) || !ids.has(p.id)), ...plans.filter((p) => !held.has(p.id)).map((p) => ({ ...p, boundTo }))],
  };
}

/**
 * What moves out of the signed-out bucket into the account's: of the groups holding any of `ids`, each whose plans the
 * account's bucket all holds as saved (transferStanding), with the alts that use them, every detail kept, and the
 * watches on them. The account's copy of a plan, alt or watch it holds already is kept, and a group with an alt
 * changed here after the account's copy stays.
 */
function settle(signedOut: PlayerWorkspace, account: PlayerWorkspace, ids: Set<string>) {
  const plans = new Map(signedOut.plans.map((p) => [p.id, p]));
  const alts = new Map(signedOut.alts.map((a) => [a.id, a]));
  const theirAlts = new Map(account.alts.map((a) => [a.id, a]));
  const altKept = (alt: LocalAlt) => {
    const theirs = theirAlts.get(alt.id);
    return !theirs || whole(theirs) === whole(alt) || Date.parse(alt.updatedAt) <= Date.parse(theirs.updatedAt);
  };
  const going = planGroups(signedOut).filter((g) => g.planIds.some((id) => ids.has(id))
    && g.planIds.every((id) => transferStanding(plans.get(id)!, account, new Set()).kind === "saved")
    && g.altIds.every((id) => altKept(alts.get(id)!)));
  const planIds = new Set(going.flatMap((g) => g.planIds));
  const altIds = new Set(going.flatMap((g) => g.altIds));
  const watched = new Set(account.watches.map((w) => w.planId));
  return {
    moved: planIds.size,
    account: {
      ...account,
      alts: [...account.alts, ...signedOut.alts.filter((a) => altIds.has(a.id) && !theirAlts.has(a.id))],
      watches: [...account.watches, ...signedOut.watches.filter((w) => planIds.has(w.planId) && !watched.has(w.planId))],
    },
    signedOut: {
      ...signedOut,
      plans: signedOut.plans.filter((p) => !planIds.has(p.id)),
      alts: signedOut.alts.filter((a) => !altIds.has(a.id)),
      watches: signedOut.watches.filter((w) => !planIds.has(w.planId)),
    },
  };
}

/** Stores the account's bucket, then the signed-out one when anything left it: if the second write fails, a plan is in
 *  both buckets, never in neither. */
function commit(storage: DeviceStorage | null, next: ReturnType<typeof settle>): { ok: true; moved: number } | Failure {
  const first = store(storage, next.account);
  if (!first.ok) return first;
  if (next.moved === 0) return { ok: true, moved: 0 };
  return store(storage, next.signedOut).ok ? { ok: true, moved: next.moved } : failure("left-signed-out");
}

/** A transfer of device plans to an account, as it was sent: the account, and which plans. */
export interface TransferRequest { owner: Owner; planIds: string[] }

/** What the transfer reports once it is over: the account the plans were saved to, and which ones. */
export type TransferResult = { ok: true; userId: string; planIds: string[] } | { ok: false };

/**
 * Once a transfer reports that it saved every plan it was sent, those plans are the account's: its bucket keeps them,
 * bound to it (a plan it holds bound already keeps the account's copy), and they move out of the signed-out bucket
 * with the alts and watches that go with them (settle). A plan an alt uses stays signed out as well until every plan
 * of that alt is the account's, so the alt never names a plan its bucket lacks, and a transfer that stops part way has
 * a record of what the account has. Anything less binds nothing: a failed result, one that confirms only some of the
 * plans or others than were sent, or an answer for another account than the transfer was sent for. `bound` counts the
 * plans sent that were signed out. This is the browser's own record: the transfer reads it to send no plan twice, and
 * none to a second account.
 */
export function bindTransferred(storage: DeviceStorage | null, sent: TransferRequest, result: TransferResult, now = new Date()): { ok: true; bound: number } | Failure {
  if (!result.ok) return failure("not-transferred");
  const { owner } = sent;
  if (owner.kind !== "account" || owner.userId !== result.userId) return failure("other-owner");
  const ids = new Set(sent.planIds);
  const confirmed = new Set(result.planIds);
  if (confirmed.size !== ids.size || [...ids].some((id) => !confirmed.has(id))) return failure("incomplete");
  const signedOut = readWorkspace(storage, ANONYMOUS);
  if (!signedOut.ok) return failure(signedOut.error);
  const account = readWorkspace(storage, owner);
  if (!account.ok) return failure(account.error);
  const sending = signedOut.workspace.plans.filter((p) => ids.has(p.id));
  if (sending.length === 0) return { ok: true, bound: 0 };
  const into = withBound(account.workspace, sending, { userId: result.userId, at: now.toISOString() });
  const done = commit(storage, settle(signedOut.workspace, into, ids));
  return done.ok ? { ok: true, bound: sending.length } : done;
}

/** For plans a transfer has nothing to send for, as the account's bucket holds them already: moves them out of the
 *  signed-out bucket with what goes with them, as bindTransferred does once a plan is saved. */
export function settleTransferred(storage: DeviceStorage | null, owner: Owner, planIds: string[]): { ok: true; moved: number } | Failure {
  if (owner.kind !== "account") return failure("other-owner");
  const signedOut = readWorkspace(storage, ANONYMOUS);
  if (!signedOut.ok) return failure(signedOut.error);
  const account = readWorkspace(storage, owner);
  if (!account.ok) return failure(account.error);
  const next = settle(signedOut.workspace, account.workspace, new Set(planIds));
  return next.moved === 0 ? { ok: true, moved: 0 } : commit(storage, next);
}

/** Why the account's bucket could not take these signed-out plans and what goes with them once the account has them,
 *  or null when it can: its limits and its size, as it would be stored. */
export function transferRoom(signedOut: PlayerWorkspace, account: PlayerWorkspace, planIds: string[]): Failure | null {
  if (account.owner.kind !== "account") return failure("other-owner");
  const ids = new Set(planIds);
  const into = withBound(account, signedOut.plans.filter((p) => ids.has(p.id)), { userId: account.owner.userId, at: new Date().toISOString() });
  const checked = storable(settle(signedOut, into, ids).account);
  return checked.ok ? null : checked;
}

// Backups.

export type ImportError = FormatError | "too-large" | "other-owner";

const IMPORT_MESSAGES: Record<ImportError, string> = {
  "too-large": "That file is over 1 MiB, larger than a backup of a device's plans can be. Nothing was changed.",
  malformed: "That file is not a backup of plans from this site, or it is damaged. Nothing was changed.",
  "newer-version": "That backup was made by a newer version of Everloot. Reload the page and try again. Nothing was changed.",
  "over-limit": `Restoring that backup would pass what this device keeps: ${WORKSPACE_LIMITS.plans} plans and ${WORKSPACE_LIMITS.alts} alts, all within 1 MiB. Nothing was changed.`,
  "bad-reference": "That backup is damaged: something in it names a plan it does not hold. Nothing was changed.",
  "other-owner": "That backup belongs to a different account. Nothing was changed.",
};

/** For a page that checks a file's size before reading it. */
export const BACKUP_TOO_LARGE = IMPORT_MESSAGES["too-large"];

export interface ImportPreview {
  /** The bucket the preview was made from, as stored then: applyImport writes only while it is still that. */
  base: string;
  /** The bucket once restored. */
  result: PlayerWorkspace;
  /** Plans the backup adds, brings back newer, leaves because this device's copy is newer, and has the same. */
  added: number;
  updated: number;
  kept: number;
  unchanged: number;
  /** Alts and watches it adds or brings back newer. */
  others: number;
  /** A line per restored set whose spend order this version cannot read. Its talents are restored all the same. */
  warnings: string[];
}

export type PreviewResult = { ok: true; preview: ImportPreview } | { ok: false; error: ImportError; message: string };

/** The fields of an item in one fixed order, to compare two copies whatever order their keys came in. */
const fields = <T extends object>(item: T, keys: readonly string[]) => JSON.stringify(keys.map((k) => (item as Record<string, unknown>)[k]));
/** Every field of a value, keys sorted at every level: an alt is compared whole, the fields this version does not
 *  use included. */
const whole = (value: unknown) => JSON.stringify(value, (_key, v: unknown) => (isRecord(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));

/** This device's items with a backup's merged in by id: a new one is added, a newer one replaces this device's
 *  copy (through `pick`), and an older or equally old one leaves it as it is. `same` says two copies are alike. */
function merge<T extends { id: string }>(here: T[], backup: T[], same: (item: T) => string, time: (item: T) => string, pick = (_mine: T, theirs: T) => theirs) {
  const byId = new Map(here.map((item) => [item.id, item]));
  const counts = { added: 0, updated: 0, kept: 0, unchanged: 0 };
  const restored: T[] = [];
  for (const theirs of backup) {
    const mine = byId.get(theirs.id);
    if (!mine) {
      byId.set(theirs.id, theirs);
      counts.added++;
      restored.push(theirs);
    } else if (same(mine) === same(theirs)) {
      counts.unchanged++;
    } else if (Date.parse(time(theirs)) > Date.parse(time(mine))) {
      const next = pick(mine, theirs);
      byId.set(theirs.id, next);
      counts.updated++;
      restored.push(next);
    } else {
      counts.kept++;
    }
  }
  return { items: [...byId.values()], counts, restored };
}

function ownerRefusal(backup: Owner, here: Owner): string {
  if (here.kind === "anonymous") return "That backup holds an account's plans. Sign in to that account to restore it. Nothing was changed.";
  if (backup.kind === "anonymous") return "That backup holds plans saved while signed out. Sign out to restore them. Nothing was changed.";
  return IMPORT_MESSAGES["other-owner"];
}

/** Why a restored set's order opens as unknown, or null when it reads (or there is none to read). */
function orderWarning(plan: LocalPlan, set: 1 | 2): string | null {
  const [code, token] = set === 1 ? [plan.code, plan.order] : [plan.code2, plan.order2];
  if (code === null || token === null) return null;
  const state = orderState(code, token);
  if (state.known) return null;
  const why = state.reason === "newer-version" ? "was made by a newer version of Everloot" : "cannot be read here";
  return `${plan.name}: set ${set}'s spend order ${why}, so it opens as unknown. Its talents are restored.`;
}

/** What restoring `text` into `current` would do, without changing anything. */
export function previewImport(text: string, current: PlayerWorkspace): PreviewResult {
  const refuse = (error: ImportError, message = IMPORT_MESSAGES[error]): PreviewResult => ({ ok: false, error, message });
  // A string's UTF-8 length is at least its length in code units, so the cheap test goes first.
  if (text.length > WORKSPACE_LIMITS.bytes || bytes(text) > WORKSPACE_LIMITS.bytes) return refuse("too-large");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return refuse("malformed"); }
  const checked = validateWorkspace(value);
  if (!checked.ok) return refuse(checked.error);
  const backup = checked.workspace;
  if (!sameOwner(backup.owner, current.owner)) return refuse("other-owner", ownerRefusal(backup.owner, current.owner));
  // The restored bucket is in the newer of the two versions, so no version 2 field is lost. Both were read as
  // version 2 (a version 1 alt with its new details unknown), so their alts go together.
  const version = backup.version > current.version ? backup.version : current.version;
  // A restore never takes a binding away: this device's binding stays on the copy the backup brings back.
  const plans = merge(current.plans, backup.plans, (p) => fields(p, PLAN_KEYS), (p) => p.updatedAt, (mine, theirs) => ({ ...theirs, boundTo: mine.boundTo ?? theirs.boundTo }));
  const alts = merge(current.alts, backup.alts, whole, (a) => a.updatedAt);
  const watches = merge(current.watches, backup.watches, (w) => fields(w, WATCH_KEYS), (w) => w.addedAt);
  const result = { ...current, version, plans: plans.items, alts: alts.items, watches: watches.items };
  // Checked as it would be stored, a version 1 bucket in version 1's form and size (storedForm). The preview keeps
  // the alts as this version reads them.
  const merged = validateWorkspace(storedForm(result));
  if (!merged.ok) return refuse(merged.error);
  return {
    ok: true,
    preview: {
      base: JSON.stringify(current), result, ...plans.counts,
      others: alts.counts.added + alts.counts.updated + watches.counts.added + watches.counts.updated,
      warnings: plans.restored.flatMap((p) => [orderWarning(p, 1), orderWarning(p, 2)].filter((w): w is string => w !== null)),
    },
  };
}

/** Restores what a preview showed, into the bucket it was made for, only while that bucket is as it was then. */
export function applyImport(storage: DeviceStorage | null, owner: Owner, preview: ImportPreview): WriteResult {
  // After an account switch, a preview made for the last account is not applied to this one.
  if (!sameOwner(preview.result.owner, owner)) return failure("other-owner");
  const read = readWorkspace(storage, owner);
  if (!read.ok) return failure(read.error);
  if (JSON.stringify(read.workspace) !== preview.base) return failure("changed");
  return store(storage, preview.result);
}

/** The bucket as a backup file: its stored text, binding and all. Only this bucket, never another owner's. */
export function exportBackup(workspace: PlayerWorkspace, now = new Date()): { ok: true; text: string; fileName: string } | Failure {
  const text = JSON.stringify(storedForm(workspace));
  if (bytes(text) > WORKSPACE_LIMITS.bytes) return failure("over-limit");
  return { ok: true, text, fileName: `everloot-plans-${now.toISOString().slice(0, 10)}.json` };
}

// The account, and plans that arrive as text.

export type OwnerLookup = { ok: true; owner: Owner } | { ok: false };

/** Who is signed in, from the same /api/auth/me the header asks. Only the account's stable id is used. */
export async function lookupOwner(fetcher: typeof fetch = fetch): Promise<OwnerLookup> {
  try {
    const response = await fetcher("/api/auth/me", { cache: "no-store" });
    if (!response.ok) return { ok: false };
    const { user } = await response.json() as { user?: { id?: unknown } | null };
    if (user === null) return { ok: true, owner: ANONYMOUS };
    return validId(user?.id) ? { ok: true, owner: { kind: "account", userId: user.id } } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** A set's spend order as its token reads against its own code. Whether each point could be spent there is the
 *  calculator's check, against the tree, when the plan opens. */
export type OrderState = { known: true; origin: OrderOrigin } | { known: false; reason: OrderError | "none" };

export function orderState(code: string, token: string | null): OrderState {
  if (token === null) return { known: false, reason: "none" };
  const decoded = decodeBuild(code);
  if (!decoded.ok) return { known: false, reason: "malformed" };
  const order = decodeOrder(token, decoded.build.ranks);
  return order.ok ? { known: true, origin: order.origin } : { known: false, reason: order.error };
}

export type PlanText =
  | { ok: true; classSlug: string; codes: [string, string | null]; orders: [string | null, string | null] }
  | { ok: false; message: string };

const NOT_A_PLAN = "That is not a talent link or a share code. Copy the link from the talent calculator and paste it here.";

const segment = (s: string | undefined) => {
  if (!s || s === "-") return null;
  try { return decodeURIComponent(s); } catch { return s; }
};

/** The plan in pasted text: the calculator's address (#plan= and the rest), a build link's /b/<code>/<code> path
 *  with any orders in its fragment, or a bare share code. Each order goes with its own set's code, as it came. */
export function readPlanText(text: string): PlanText {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, message: "Paste a talent link or a share code first." };
  let codes: [string | null, string | null] = [trimmed, null];
  let orders: [string | null, string | null] = [null, null];
  const path = /\/b\/([^/?#\s]+)(?:\/([^/?#\s]+))?/.exec(trimmed);
  if (/[#&]plan2?=/.test(trimmed)) {
    const hash = readPlanHash(trimmed);
    codes = [hash.first, hash.second];
    orders = [hash.firstOrder ?? null, hash.secondOrder ?? null];
  } else if (path) {
    codes = [segment(path[1]), segment(path[2])];
    const fragment = trimmed.indexOf("#");
    const hash = readPlanHash(fragment < 0 ? "" : trimmed.slice(fragment));
    orders = [hash.firstOrder ?? null, hash.secondOrder ?? null];
  }
  const [first, second] = codes;
  if (!first) return { ok: false, message: second ? "That link has no first talent set. Open it in the calculator, spend a point in set 1 and copy the link again." : NOT_A_PLAN };
  const classSlug = codeClass(first);
  if (!classSlug) return { ok: false, message: NOT_A_PLAN };
  if (second !== null && codeClass(second) !== classSlug) return { ok: false, message: codeClass(second) ? "Both talent sets must be for the same class." : NOT_A_PLAN };
  return { ok: true, classSlug, codes: [first, second], orders: [orders[0], second === null ? null : orders[1]] };
}
