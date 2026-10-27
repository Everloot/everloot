import {
  ALT_PROFESSIONS, WORKSPACE_LIMITS, clean, update,
  type DeviceStorage, type Faction, type Failure, type FileDetail, type ImportPreview, type LocalAlt, type Owner, type PlayerWorkspace,
  type WriteError, type WriteResult,
} from "./player-workspace";
import { TALENT_CLASSES, type TalentClassSlug } from "./talents/catalogs";

// The alt planner's own changes to the PlayerWorkspace (lib/player-workspace.ts): alts added, edited and deleted by
// hand, in the same bucket as the plans and through the same checked writes. None of it needs the addon's file;
// reading one is lib/alt-import.ts. Nothing here is sent anywhere.

/** Characters as the workspace counts them. */
const chars = (s: string) => Array.from(s).length;

/** What a change says when it does not happen, in the alt pages' words (the workspace's own messages talk of plans). */
const MESSAGES: Partial<Record<WriteError, string>> = {
  unavailable: "This browser is not letting Everloot keep anything on this device (private browsing or blocked site data), so alts cannot be saved here.",
  corrupt: "The alts and plans stored on this device could not be read. They are kept as they are, and nothing is saved over them.",
  "newer-version": "The alts on this device were saved by a newer version of Everloot. Reload the page to open them. Nothing here changes them.",
  full: "This browser's storage is full, so nothing was saved. The alts on this device are as they were.",
  "over-limit": `That is more than this device keeps: ${WORKSPACE_LIMITS.alts} alts, each using up to ${WORKSPACE_LIMITS.altPlans} plans, all within a 1 MiB backup. Nothing was changed.`,
  invalid: "That alt is not valid, so nothing was saved.",
  missing: "That alt is no longer on this device. It may have been deleted in another tab.",
  changed: "The alts on this device changed since the preview. Choose the backup again to see what it would do now.",
  "other-owner": "Who is signed in here changed since the preview, so nothing was changed.",
};

/** A failure as the alt pages say it. */
export const altFailure = (error: WriteError, message = MESSAGES[error] ?? MESSAGES.invalid!): Failure => ({ ok: false, error, message });

/** The workspace's update, with its failures said in the alt pages' words; a change's own failure keeps its words, and
 *  so does one these pages have no words of their own for. */
export function changeAlts(storage: DeviceStorage | null, owner: Owner, change: (workspace: PlayerWorkspace) => PlayerWorkspace | Failure): WriteResult {
  let own: Failure | null = null;
  const result = update(storage, owner, (workspace) => {
    const next = change(workspace);
    if ("error" in next) own = next;
    return next;
  });
  return result.ok ? result : own ?? (MESSAGES[result.error] ? altFailure(result.error) : result);
}

/** A character's name in any case. */
export const nameKey = (name: string) => name.normalize("NFC").toLowerCase();

/** One key per character: its name in any case, on its realm however the realm's spaces and hyphens are written
 *  ("Moon Guard", "moon-guard"), as the account reads a realm (linkRealmKey in lib/character-links.ts). */
export const altKey = (name: string, realm: string) =>
  `${nameKey(name)}\n${realm.normalize("NFC").toLowerCase().replace(/’/g, "'").replace(/[\s-]+/g, " ").trim()}`;

/** "Thrall (Moon Guard)", or "Thrall" while its realm is not set. */
export const altLabel = (alt: { name: string; realm: string | null }) => (alt.realm ? `${alt.name} (${alt.realm})` : alt.name);

/** The details a file can give, as the pages name them. */
export const DETAIL_WORDS: Record<FileDetail, string> = { classSlug: "class", level: "level", faction: "faction" };
const FACTION_NAMES: Record<Faction, string> = { alliance: "Alliance", horde: "Horde" };
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A detail's value as the pages show it: "Shaman", "24", "Horde". */
export const detailValue = (detail: FileDetail, value: string | number | null): string =>
  value === null ? "not set" : detail === "classSlug" ? titleCase(String(value)) : detail === "faction" ? FACTION_NAMES[value as Faction] : String(value);

/** "Shaman · Level 24 · Horde": the details known, in that order; empty when none is. */
export const detailsLine = (alt: { classSlug: string | null; level: number | null; faction: Faction | null }) =>
  [alt.classSlug ? titleCase(alt.classSlug) : "", alt.level !== null ? `Level ${alt.level}` : "", alt.faction ? FACTION_NAMES[alt.faction] : ""]
    .filter(Boolean).join(" · ");

/** The other alt that is this character, when its realm is known: one character is one alt. */
const twinOf = (alts: LocalAlt[], alt: { id?: string | null; name: string; realm: string | null }) => {
  const realm = alt.realm;
  return realm === null ? undefined : alts.find((a) => a.id !== alt.id && a.realm !== null && altKey(a.name, a.realm) === altKey(alt.name, realm));
};

export interface AltInput {
  /** The alt to change; left out or null, a new alt. */
  id?: string | null;
  name: string;
  /** Blank while not known. */
  realm: string;
  /** Null or blank while not known. */
  classSlug: string | null;
  faction: string | null;
  level: number | null;
  professions: string[];
  notes: string;
  /** Plans of this bucket the alt uses. */
  planIds: string[];
  /** For an edit, the alt as the edit began: a change made to it since, in another tab, is not written over. */
  base?: LocalAlt | null;
}

/** The fields of an alt that a change elsewhere can touch, in the order an alt holds them. */
export const ALT_FIELDS = ["name", "realm", "classSlug", "faction", "level", "professions", "notes", "planIds", "provenance"] as const;
export type AltField = (typeof ALT_FIELDS)[number];

/** How the pages name an alt's fields. */
export const FIELD_WORDS: Record<AltField, string> = {
  name: "name", realm: "realm", classSlug: "class", faction: "faction", level: "level", professions: "professions",
  notes: "notes", planIds: "plans", provenance: "record of where its details came from",
};

/** A refused edit of an alt changed elsewhere carries the alt as it is now and what changed. */
export type AltResult = { ok: true; workspace: PlayerWorkspace; alt: LocalAlt } | (Failure & { current?: LocalAlt; changed?: AltField[] });

const invalid = (message: string) => altFailure("invalid", message);

/** The alt's details as typed, as plain text within the limits, or why they cannot be kept. Nothing is cut. */
function details(input: AltInput): Omit<LocalAlt, "id" | "provenance" | "updatedAt"> | Failure {
  const name = clean(input.name, false);
  if (!name || chars(name) > WORKSPACE_LIMITS.name) return invalid(`Give the alt a name of 1 to ${WORKSPACE_LIMITS.name} characters.`);
  const realm = clean(input.realm, false);
  if (chars(realm) > WORKSPACE_LIMITS.realm) return invalid(`A realm name can be up to ${WORKSPACE_LIMITS.realm} characters.`);
  const classSlug = input.classSlug || null;
  if (classSlug !== null && !(TALENT_CLASSES as readonly string[]).includes(classSlug)) return invalid("Choose the alt's class from the list, or leave it unknown.");
  const faction = input.faction || null;
  if (faction !== null && faction !== "alliance" && faction !== "horde") return invalid("Choose Alliance or Horde, or leave the faction unknown.");
  const { level } = input;
  if (level !== null && !(Number.isInteger(level) && level >= 1 && level <= WORKSPACE_LIMITS.level)) {
    return invalid(`A level is a whole number from 1 to ${WORKSPACE_LIMITS.level}, or left blank.`);
  }
  if (!input.professions.every((p) => (ALT_PROFESSIONS as readonly string[]).includes(p))) return invalid("Choose professions from the list.");
  const notes = clean(input.notes, true);
  if (chars(notes) > WORKSPACE_LIMITS.notes) return invalid(`Notes can be up to ${WORKSPACE_LIMITS.notes.toLocaleString("en-US")} characters.`);
  const planIds = [...new Set(input.planIds)];
  if (planIds.length > WORKSPACE_LIMITS.altPlans) return invalid(`An alt can use up to ${WORKSPACE_LIMITS.altPlans} plans.`);
  return {
    name, realm: realm || null, classSlug: classSlug as TalentClassSlug | null, faction, level,
    professions: ALT_PROFESSIONS.filter((p) => input.professions.includes(p)), notes, planIds,
  };
}

/**
 * A new alt, or with `input.id` that alt changed in place. It keeps how it came; a detail the player changes from
 * a file's value is the player's from then on, so a later file does not change it back. An edit made against an
 * older copy (`input.base`) than the one stored now is refused whole, with what changed, so nothing set in another
 * tab is written over.
 */
export function saveAlt(storage: DeviceStorage | null, owner: Owner, input: AltInput, now = new Date()): AltResult {
  const fields = details(input);
  if ("error" in fields) return fields;
  let saved: LocalAlt | undefined;
  let conflict: (Failure & { current: LocalAlt; changed: AltField[] }) | undefined;
  const result = changeAlts(storage, owner, (workspace) => {
    const old = input.id ? workspace.alts.find((a) => a.id === input.id) : undefined;
    if (input.id && !old) return altFailure("missing");
    const base = input.base;
    const changed = old && base ? ALT_FIELDS.filter((k) => JSON.stringify(old[k]) !== JSON.stringify(base[k])) : [];
    if (old && changed.length > 0) {
      const words = listOf(changed.map((k) => FIELD_WORDS[k]));
      conflict = { ...altFailure("changed", `${old.name} was changed somewhere else while you were editing it (its ${words}), so nothing was saved.`), current: old, changed };
      return conflict;
    }
    if (!fields.planIds.every((id) => workspace.plans.some((p) => p.id === id))) {
      return invalid("A plan chosen for this alt is no longer on this device. It may have been deleted in another tab.");
    }
    // An edit that keeps who the alt is (its name and its known realm) is not checked for a twin, so an alt a restore
    // left here twice can still be edited; a new alt, or one that becomes another character, is.
    const sameCharacter = old && old.realm !== null && fields.realm !== null && altKey(old.name, old.realm) === altKey(fields.name, fields.realm);
    const twin = sameCharacter ? undefined : twinOf(workspace.alts, { id: old?.id, ...fields });
    if (twin) return invalid(`${altLabel(twin)} is already one of your alts here.`);
    const alt: LocalAlt = {
      id: old?.id ?? crypto.randomUUID(), ...fields,
      provenance: old
        ? { ...old.provenance, fileDetails: old.provenance.fileDetails.filter((d) => old[d] === fields[d]) }
        : { source: "manual", fileRecordAt: null, fileDetails: [] },
      updatedAt: now.toISOString(),
    };
    saved = alt;
    return { ...workspace, alts: old ? workspace.alts.map((a) => (a.id === alt.id ? alt : a)) : [...workspace.alts, alt] };
  });
  return result.ok ? { ...result, alt: saved! } : conflict ?? result;
}

/** Deletes an alt. Its plans stay. */
export function deleteAlt(storage: DeviceStorage | null, owner: Owner, id: string): WriteResult {
  return changeAlts(storage, owner, (workspace) => (workspace.alts.some((a) => a.id === id)
    ? { ...workspace, alts: workspace.alts.filter((a) => a.id !== id) }
    : altFailure("missing")));
}

/** "a", "a and b", "a, b and c". */
export const listOf = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/**
 * What restoring a backup (previewImport) does to this device's alts, alt by alt: each it adds, saying so when the
 * same character is already here as another alt, and each it replaces with the backup's newer copy, with what that
 * changes, notes included.
 */
export function restoreLines(current: PlayerWorkspace, preview: ImportPreview): string[] {
  const here = new Map(current.alts.map((a) => [a.id, a]));
  const adds: string[] = [];
  const replaces: string[] = [];
  for (const alt of preview.result.alts) {
    const mine = here.get(alt.id);
    if (!mine) {
      const twin = twinOf(current.alts, alt);
      adds.push(`Adds ${altLabel(alt)}.${twin ? ` ${altLabel(twin)} is already here as another alt, so it would be here twice.` : ""}`);
      continue;
    }
    const changed = ALT_FIELDS.filter((k) => JSON.stringify(mine[k]) !== JSON.stringify(alt[k]));
    if (changed.length > 0) replaces.push(`Replaces ${altLabel(mine)} with the backup's newer copy, which changes its ${listOf(changed.map((k) => FIELD_WORDS[k]))}.`);
  }
  return [...adds, ...replaces];
}
